import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createRouter, defaultRouterDeps, type BgSender, type RouterDeps } from '../../../src/background/router';
import type { FieldReport } from '../../../src/engine/types';

const field: FieldReport = { fieldId: 'c1', label: 'L', fieldKey: null, section: null, outcome: 'filled', confidence: 1 };

function makeDeps(): { [K in keyof RouterDeps]: ReturnType<typeof vi.fn> } {
  return {
    fill: vi.fn().mockResolvedValue({ ok: true }),
    focus: vi.fn().mockResolvedValue(undefined),
    apply: vi.fn().mockResolvedValue(field),
    recordScan: vi.fn().mockResolvedValue(5),
    pushTotal: vi.fn().mockResolvedValue(undefined),
    currentTotal: vi.fn().mockResolvedValue(7),
    openSidePanel: vi.fn(),
    openOptions: vi.fn(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let deps: ReturnType<typeof makeDeps>;
let route: ReturnType<typeof createRouter>;
let respond: Mock<(response?: unknown) => void>;

const id = () => browser.runtime.id;
const contentSender = (tabId = 11, frameId = 0): BgSender => ({ id: id(), tab: { id: tabId }, frameId, url: 'https://jobs.example/apply' });
const pageSender = (): BgSender => ({ id: id(), url: browser.runtime.getURL('') + 'sidepanel.html' });
const pageInTabSender = (): BgSender => ({ id: id(), tab: { id: 77 }, url: browser.runtime.getURL('') + 'sidepanel.html' });

beforeEach(() => {
  fakeBrowser.reset();
  deps = makeDeps();
  route = createRouter(deps as unknown as RouterDeps);
  respond = vi.fn<(response?: unknown) => void>();
});

describe('sender validation', () => {
  it('ignores foreign extension ids and unknown / malformed messages', () => {
    expect(route({ type: 'fill:request' }, { ...contentSender(), id: 'evil' }, respond)).toBe(false);
    expect(route({ type: 'nope' }, contentSender(), respond)).toBe(false);
    expect(route('fill:request', contentSender(), respond)).toBe(false);
    expect(route({ type: 'fill:request' }, undefined as never, respond)).toBe(false);
    expect(deps.fill).not.toHaveBeenCalled();
  });

  it('ignores messages meant for others (scan:total, frame:*, report:updated)', () => {
    for (const m of [{ type: 'scan:total', total: 1 }, { type: 'frame:focus', fieldId: 'c1' }, { type: 'report:updated', tabId: 1, report: {} }]) {
      expect(route(m, contentSender(), respond)).toBe(false);
    }
    expect(respond).not.toHaveBeenCalled();
  });

  it('does not let an extension page act as a content script (scan / fill / side panel need a real content script)', () => {
    expect(route({ type: 'fill:request' }, pageInTabSender(), respond)).toBe(false);
    expect(route({ type: 'scan:result', count: 1, url: 'u' }, pageInTabSender(), respond)).toBe(false);
    expect(route({ type: 'ui:openSidePanel' }, pageInTabSender(), respond)).toBe(false);
    expect(deps.fill).not.toHaveBeenCalled();
    expect(deps.openSidePanel).not.toHaveBeenCalled();
  });
});

describe('scan:result', () => {
  it('records the count for the sender frame and pushes the total to frame 0', async () => {
    expect(route({ type: 'scan:result', count: 3.9, url: 'u' }, contentSender(11, 4), respond)).toBe(false);
    await flush();
    expect(deps.recordScan).toHaveBeenCalledWith(11, 4, 3);
    expect(deps.pushTotal).toHaveBeenCalledWith(11, 5);
  });

  it('survives a missing FAB (push rejects) and ignores bad counts', async () => {
    deps.pushTotal.mockRejectedValue(new Error('no receiver'));
    route({ type: 'scan:result', count: 1, url: 'u' }, contentSender(), respond);
    route({ type: 'scan:result', count: -1, url: 'u' }, contentSender(), respond);
    route({ type: 'scan:result', count: 'many', url: 'u' }, contentSender(), respond);
    await flush();
    expect(deps.recordScan).toHaveBeenCalledTimes(1);
  });

  it('ignores senders without a tab', () => {
    route({ type: 'scan:result', count: 1, url: 'u' }, { id: id() }, respond);
    expect(deps.recordScan).not.toHaveBeenCalled();
  });
});

describe('fill:request', () => {
  it('fills the sender tab and responds asynchronously with the result', async () => {
    deps.fill.mockResolvedValue({ ok: false, error: 'no_resume' });
    expect(route({ type: 'fill:request' }, contentSender(21), respond)).toBe(true);
    await flush();
    expect(deps.fill).toHaveBeenCalledWith(21);
    expect(respond).toHaveBeenCalledWith({ ok: false, error: 'no_resume' });
  });

  it('turns a thrown error into { ok: false, error }', async () => {
    deps.fill.mockRejectedValue(new Error('boom'));
    route({ type: 'fill:request' }, contentSender(), respond);
    await flush();
    expect(respond).toHaveBeenCalledWith({ ok: false, error: 'boom' });
  });
});

describe('field:focus', () => {
  it('uses the sender tab for the FAB (message carries no tabId)', async () => {
    expect(route({ type: 'field:focus', frameId: 3, fieldId: 'c2' }, contentSender(31), respond)).toBe(false);
    expect(deps.focus).toHaveBeenCalledWith(31, 3, 'c2');
  });

  it('a content script cannot target another tab', () => {
    route({ type: 'field:focus', tabId: 99, frameId: 0, fieldId: 'c2' }, contentSender(31), respond);
    expect(deps.focus).toHaveBeenCalledWith(31, 0, 'c2');
  });

  it('uses message.tabId for extension pages, even when the page lives in a tab itself', () => {
    route({ type: 'field:focus', tabId: 42, frameId: 1, fieldId: 'c2' }, pageSender(), respond);
    route({ type: 'field:focus', tabId: 43, frameId: 1, fieldId: 'c2' }, pageInTabSender(), respond);
    expect(deps.focus.mock.calls).toEqual([[42, 1, 'c2'], [43, 1, 'c2']]);
  });

  it('ignores section rows, missing tab ids and bad frame ids', () => {
    route({ type: 'field:focus', frameId: 0, fieldId: 'section:work' }, contentSender(), respond);
    route({ type: 'field:focus', frameId: 0, fieldId: 'c1' }, pageSender(), respond); // page without tabId
    route({ type: 'field:focus', frameId: -1, fieldId: 'c1' }, contentSender(), respond);
    expect(deps.focus).not.toHaveBeenCalled();
  });

  it('swallows relay failures', async () => {
    deps.focus.mockRejectedValue(new Error('gone'));
    route({ type: 'field:focus', frameId: 0, fieldId: 'c1' }, contentSender(), respond);
    await flush();
  });
});

describe('field:apply', () => {
  it('relays from extension pages and responds with the updated field', async () => {
    const msg = { type: 'field:apply', tabId: 8, frameId: 2, fieldId: 'c1', optionLabel: 'Male' } as const;
    expect(route(msg, pageSender(), respond)).toBe(true);
    await flush();
    expect(deps.apply).toHaveBeenCalledWith({ tabId: 8, frameId: 2, fieldId: 'c1', optionLabel: 'Male' });
    expect(respond).toHaveBeenCalledWith(field);
  });

  it('is not available to content scripts', () => {
    expect(route({ type: 'field:apply', tabId: 8, frameId: 0, fieldId: 'c1', text: 'x' }, contentSender(), respond)).toBe(false);
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('answers undefined for section rows, null results and failures', async () => {
    route({ type: 'field:apply', tabId: 8, frameId: 0, fieldId: 'section:work', text: 'x' }, pageSender(), respond);
    deps.apply.mockResolvedValueOnce(null);
    route({ type: 'field:apply', tabId: 8, frameId: 0, fieldId: 'c1', text: 'x' }, pageSender(), respond);
    deps.apply.mockRejectedValueOnce(new Error('x'));
    route({ type: 'field:apply', tabId: 8, frameId: 0, fieldId: 'c1', text: 'y' }, pageSender(), respond);
    await flush();
    expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(respond.mock.calls).toEqual([[undefined], [undefined], [undefined]]);
  });

  it('rejects malformed payloads', () => {
    expect(route({ type: 'field:apply', tabId: '8', frameId: 0, fieldId: 'c1', text: 'x' }, pageSender(), respond)).toBe(false);
    expect(route({ type: 'field:apply', tabId: 8, frameId: 0, fieldId: 'c1', text: 5 }, pageSender(), respond)).toBe(false);
    expect(deps.apply).not.toHaveBeenCalled();
  });
});

describe('ui:*', () => {
  it('opens the side panel synchronously inside the handler (user gesture), for the sender tab', () => {
    let calledDuringHandler = false;
    deps.openSidePanel.mockImplementation(() => {
      calledDuringHandler = true;
    });
    route({ type: 'ui:openSidePanel' }, contentSender(55), respond);
    expect(calledDuringHandler).toBe(true);
    expect(deps.openSidePanel).toHaveBeenCalledWith(55);
  });

  it('default deps call browser.sidePanel.open({ tabId }) before any await', () => {
    const open = vi.fn().mockResolvedValue(undefined);
    (browser as unknown as { sidePanel: unknown }).sidePanel = { open };
    try {
      createRouter(defaultRouterDeps)({ type: 'ui:openSidePanel' }, contentSender(66), respond);
      expect(open).toHaveBeenCalledWith({ tabId: 66 });
    } finally {
      delete (browser as unknown as { sidePanel?: unknown }).sidePanel;
    }
  });

  it('opens the options page for content scripts and extension pages', () => {
    route({ type: 'ui:openOptions' }, contentSender(), respond);
    route({ type: 'ui:openOptions' }, pageSender(), respond);
    expect(deps.openOptions).toHaveBeenCalledTimes(2);
  });
});

describe('scan:query (FAB mounted after the first scan)', () => {
  it('re-pushes the stored tab total to frame 0', async () => {
    expect(route({ type: 'scan:query' }, contentSender(11, 0), respond)).toBe(false);
    await flush();
    expect(deps.currentTotal).toHaveBeenCalledWith(11);
    expect(deps.pushTotal).toHaveBeenCalledWith(11, 7);
  });

  it('pushes nothing when the tab was not scanned yet', async () => {
    deps.currentTotal.mockResolvedValueOnce(0);
    route({ type: 'scan:query' }, contentSender(11, 0), respond);
    await flush();
    expect(deps.pushTotal).not.toHaveBeenCalled();
  });

  it('ignores sub-frames and extension pages', async () => {
    route({ type: 'scan:query' }, contentSender(11, 3), respond);
    route({ type: 'scan:query' }, pageInTabSender(), respond);
    await flush();
    expect(deps.currentTotal).not.toHaveBeenCalled();
  });
});
