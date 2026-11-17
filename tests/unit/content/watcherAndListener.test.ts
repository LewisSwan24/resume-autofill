import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameHandlers } from '../../../src/content/handlers';
import { createContentListener } from '../../../src/content/listener';
import { createScanWatcher } from '../../../src/content/watcher';
import { applyHighlights, clearHighlights } from '../../../src/fill/highlight';

describe('content listener', () => {
  let handlers: { [K in keyof FrameHandlers]: ReturnType<typeof vi.fn> };
  let listener: ReturnType<typeof createContentListener>;
  let respond: Mock<(response?: unknown) => void>;
  const bg = () => ({ id: browser.runtime.id });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const fillMsg = { type: 'frame:fill', runId: 'r', resume: { id: 'x' }, files: {} };

  beforeEach(() => {
    fakeBrowser.reset();
    handlers = {
      needs: vi.fn().mockReturnValue({ fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] }),
      preview: vi.fn().mockReturnValue({ url: '', items: [], cardDemand: [], unresolvedCount: 0 }),
      fill: vi.fn().mockResolvedValue({ fields: [] }),
      focus: vi.fn().mockReturnValue(true),
      apply: vi.fn().mockResolvedValue({ fieldId: 'c1' }),
      isBusy: vi.fn().mockReturnValue(false),
    };
    listener = createContentListener(handlers as unknown as FrameHandlers);
    respond = vi.fn<(response?: unknown) => void>();
  });

  it('frame:needs answers with the frame needs and never fills', async () => {
    expect(listener({ type: 'frame:needs' }, bg(), respond)).toBe(true);
    await flush();
    expect(respond).toHaveBeenCalledWith({ fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] });
    expect(handlers.needs).toHaveBeenCalledTimes(1);
    expect(handlers.fill).not.toHaveBeenCalled();
  });

  it('frame:needs answers undefined when the scan throws, and only obeys the background', async () => {
    handlers.needs.mockImplementation(() => {
      throw new Error('scan failed');
    });
    expect(listener({ type: 'frame:needs' }, bg(), respond)).toBe(true);
    await flush();
    expect(respond).toHaveBeenCalledWith(undefined);

    handlers.needs.mockClear();
    respond.mockClear();
    expect(listener({ type: 'frame:needs' }, { id: 'evil' }, respond)).toBe(false);
    expect(listener({ type: 'frame:needs' }, {}, respond)).toBe(false);
    expect(listener({ type: 'frame:needs' }, { id: browser.runtime.id, tab: { id: 1 } }, respond)).toBe(false);
    expect(handlers.needs).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('runs frame:fill and answers with the report', async () => {
    expect(listener(fillMsg, bg(), respond)).toBe(true);
    await flush();
    expect(handlers.fill).toHaveBeenCalledWith({ resume: { id: 'x' }, files: {} });
    expect(respond).toHaveBeenCalledWith({ fields: [] });
  });

  it('answers undefined when the run fails, so the background does not wait for the timeout', async () => {
    handlers.fill.mockRejectedValue(new Error('x'));
    listener(fillMsg, bg(), respond);
    await flush();
    expect(respond).toHaveBeenCalledWith(undefined);
  });

  it('handles frame:focus and frame:apply (only string text / optionLabel are forwarded)', async () => {
    expect(listener({ type: 'frame:focus', fieldId: 'c3' }, bg(), respond)).toBe(false);
    expect(handlers.focus).toHaveBeenCalledWith('c3');

    expect(listener({ type: 'frame:apply', fieldId: 'c1', optionLabel: 'Male', text: 5 }, bg(), respond)).toBe(true);
    await flush();
    expect(handlers.apply).toHaveBeenCalledWith({ fieldId: 'c1', optionLabel: 'Male' });
    expect(respond).toHaveBeenCalledWith({ fieldId: 'c1' });
  });

  it('ignores the FAB-only messages and everything unrelated', () => {
    expect(listener({ type: 'scan:total', total: 3 }, bg(), respond)).toBe(false);
    expect(listener({ type: 'report:updated', tabId: 1, report: { fields: [] } }, bg(), respond)).toBe(false);
    expect(listener({ type: 'fill:request' }, bg(), respond)).toBe(false);
    expect(listener({ type: 'unknown' }, bg(), respond)).toBe(false);
    expect(listener(undefined, bg(), respond)).toBe(false);
    expect(respond).not.toHaveBeenCalled();
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
  });

  it('only obeys the background: foreign ids and anything carrying sender.tab are ignored', () => {
    expect(listener(fillMsg, { id: 'evil' }, respond)).toBe(false);
    expect(listener(fillMsg, {}, respond)).toBe(false);
    expect(listener(fillMsg, { id: browser.runtime.id, tab: { id: 1 } }, respond)).toBe(false);
    expect(listener({ type: 'frame:apply', fieldId: 'c1', text: 'x' }, { id: browser.runtime.id, tab: { id: 1 } }, respond)).toBe(false);
    expect(handlers.fill).not.toHaveBeenCalled();
    expect(handlers.apply).not.toHaveBeenCalled();
  });

  it('rejects malformed frame:fill payloads', () => {
    expect(listener({ type: 'frame:fill', runId: 'r', files: {} }, bg(), respond)).toBe(false);
    expect(listener({ type: 'frame:fill', runId: 'r', resume: {}, files: null }, bg(), respond)).toBe(false);
    expect(handlers.fill).not.toHaveBeenCalled();
  });
});

describe('scan watcher', () => {
  let scan: Mock<() => void>;
  let busy = false;
  const mutate = async () => {
    document.body.appendChild(document.createElement('input'));
    await Promise.resolve(); // let MutationObserver deliver
  };
  const make = (extra: { debounceMs?: number; maxWaitMs?: number } = {}) =>
    createScanWatcher({ doc: document, scan, isBusy: () => busy, ...extra });

  beforeEach(() => {
    vi.useFakeTimers();
    scan = vi.fn<() => void>();
    busy = false;
    document.body.innerHTML = '<div id="a"></div>';
  });
  afterEach(() => {
    clearHighlights();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('debounces bursts of mutations into one scan after 800 ms of quiet', async () => {
    const w = make();
    w.start();
    await mutate();
    await vi.advanceTimersByTimeAsync(500);
    await mutate();
    await vi.advanceTimersByTimeAsync(799);
    expect(scan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('still scans under constant noise once maxWait is reached', async () => {
    const w = make({ debounceMs: 800, maxWaitMs: 2000 });
    w.start();
    for (let i = 0; i < 6; i++) {
      await mutate();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(1);
    w.stop();
  });

  it('ignores highlight writes made by us (discardOwnWrites) but reacts to the page changing style', async () => {
    const w = make();
    w.start();
    const el = document.getElementById('a')!;

    applyHighlights([{ el, outcome: 'filled' }]);
    w.discardOwnWrites();
    await vi.advanceTimersByTimeAsync(2000);
    expect(scan).not.toHaveBeenCalled();

    clearHighlights();
    w.discardOwnWrites();
    await vi.advanceTimersByTimeAsync(2000);
    expect(scan).not.toHaveBeenCalled();

    el.style.display = 'none'; // the page toggles visibility: a real change
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    expect(scan).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('skips scans while busy and scans after schedule() once idle', async () => {
    const w = make();
    w.start();
    busy = true;
    await mutate();
    await vi.advanceTimersByTimeAsync(2000);
    expect(scan).not.toHaveBeenCalled();

    busy = false;
    w.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(scan).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('a scan that fires while busy is dropped (the end of the fill reschedules)', async () => {
    const w = make();
    w.start();
    await mutate();
    busy = true;
    await vi.advanceTimersByTimeAsync(900);
    expect(scan).not.toHaveBeenCalled();
    w.stop();
  });

  it('stop() cancels pending scans and disconnects', async () => {
    const w = make();
    w.start();
    await mutate();
    w.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await mutate();
    await vi.advanceTimersByTimeAsync(2000);
    expect(scan).not.toHaveBeenCalled();
  });
});
