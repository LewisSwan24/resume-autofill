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
    fillOne: vi.fn().mockResolvedValue(field),
    retry: vi.fn().mockResolvedValue({ ok: true }),
    recordScan: vi.fn().mockResolvedValue(5),
    pushTotal: vi.fn().mockResolvedValue(undefined),
    currentTotal: vi.fn().mockResolvedValue(7),
    openSidePanel: vi.fn(),
    openOptions: vi.fn(),
    frameAlive: vi.fn(),
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

describe('frame:alive', () => {
  it('passes on that a content script is still filling, with its tab and frame', () => {
    expect(route({ type: 'frame:alive' }, contentSender(11, 4), respond)).toBe(false);
    expect(deps.frameAlive).toHaveBeenCalledWith(11, 4);
  });

  it('ignores an extension page and a sender without a tab', () => {
    route({ type: 'frame:alive' }, pageInTabSender(), respond);
    route({ type: 'frame:alive' }, { id: id() }, respond);
    expect(deps.frameAlive).not.toHaveBeenCalled();
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

describe('field:fill and fill:retry (side panel)', () => {
  it('relays one box by a key from extension pages and answers with the row', async () => {
    expect(route({ type: 'field:fill', tabId: 8, frameId: 2, fieldId: 'c4', fieldKey: 'contact.email' }, pageSender(), respond)).toBe(true);
    await flush();
    expect(deps.fillOne).toHaveBeenCalledWith({ tabId: 8, frameId: 2, fieldId: 'c4', fieldKey: 'contact.email' });
    expect(respond).toHaveBeenCalledWith(field);
  });

  it('retries a tab from extension pages', async () => {
    expect(route({ type: 'fill:retry', tabId: 8 }, pageSender(), respond)).toBe(true);
    await flush();
    expect(deps.retry).toHaveBeenCalledWith(8);
    expect(respond).toHaveBeenCalledWith({ ok: true });
  });

  it('is not available to content scripts, and rejects malformed payloads', () => {
    expect(route({ type: 'field:fill', tabId: 8, frameId: 0, fieldId: 'c4', fieldKey: 'contact.email' }, contentSender(), respond)).toBe(false);
    expect(route({ type: 'fill:retry', tabId: 8 }, contentSender(), respond)).toBe(false);
    expect(route({ type: 'field:fill', tabId: 8, frameId: 0, fieldId: 'c4', fieldKey: 5 }, pageSender(), respond)).toBe(false);
    expect(route({ type: 'fill:retry', tabId: -1 }, pageSender(), respond)).toBe(false);
    expect(deps.fillOne).not.toHaveBeenCalled();
    expect(deps.retry).not.toHaveBeenCalled();
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
    expect(deps.openOptions).toHaveBeenCalledWith(null);
  });

  it('opens the options page at the input of a field the page asks about', () => {
    route({ type: 'ui:openOptions', fieldKey: 'education.gpa', source: 'education[1].gpa' }, contentSender(), respond);
    expect(deps.openOptions).toHaveBeenCalledWith({ module: 'education', entry: 1, field: 'gpa' });
  });

  it('just opens the options page for a field it cannot place or a malformed one', () => {
    for (const extra of [{ fieldKey: 'nope.thing' }, { fieldKey: 5 }, { fieldKey: 'contact.email', source: 7 }, { fieldKey: 'x'.repeat(300) }]) {
      deps.openOptions.mockClear();
      route({ type: 'ui:openOptions', ...extra } as never, contentSender(), respond);
      expect(deps.openOptions, JSON.stringify(extra).slice(0, 60)).toHaveBeenCalledWith(null);
    }
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

describe('defaultRouterDeps.openOptions', () => {
  it('leaves the jump request for the options page before opening it', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    defaultRouterDeps.openOptions({ module: 'contact', field: 'email' });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const stored = await fakeBrowser.storage.session.get('profile:focus');
    expect(stored['profile:focus']).toMatchObject({ target: { module: 'contact', field: 'email' } });
  });

  it('without a target only opens it', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    defaultRouterDeps.openOptions(null);
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(await fakeBrowser.storage.session.get('profile:focus')).toEqual({});
  });
});

describe('wizard auto-advance', () => {
  it('starts from the FAB (its own tab) or the side panel (a named tab) and answers right away', async () => {
    const start = vi.fn().mockResolvedValue({ ok: true });
    route = createRouter({ ...(deps as unknown as RouterDeps), autoAdvance: start });
    expect(route({ type: 'wizard:autoAdvance' }, contentSender(11, 0), respond)).toBe(true);
    await flush();
    expect(start).toHaveBeenCalledWith(11);
    expect(respond).toHaveBeenCalledWith({ ok: true });

    expect(route({ type: 'wizard:autoAdvance', tabId: 5 }, pageSender(), respond)).toBe(true);
    await flush();
    expect(start).toHaveBeenLastCalledWith(5);
  });

  it("answers the FAB with the step's action across every frame, so it can offer to advance a form in an iframe", async () => {
    const stepAction = vi.fn().mockResolvedValue('next');
    route = createRouter({ ...(deps as unknown as RouterDeps), stepAction });
    expect(route({ type: 'wizard:stepAction' }, contentSender(11, 0), respond)).toBe(true);
    await flush();
    expect(stepAction).toHaveBeenCalledWith(11);
    expect(respond).toHaveBeenCalledWith({ action: 'next' });
    // Only the FAB's own frame asks.
    expect(route({ type: 'wizard:stepAction' }, contentSender(11, 4), respond)).toBe(false);
  });

  it('only takes a start from the top frame of a page', () => {
    const start = vi.fn().mockResolvedValue({ ok: true });
    route = createRouter({ ...(deps as unknown as RouterDeps), autoAdvance: start });
    expect(route({ type: 'wizard:autoAdvance' }, contentSender(11, 3), respond)).toBe(false);
    expect(route({ type: 'wizard:autoAdvance', tabId: 'x' }, pageSender(), respond)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('stops a run, and resetting the wizard stops it too', () => {
    const stop = vi.fn();
    route = createRouter({ ...(deps as unknown as RouterDeps), stopAdvance: stop });
    expect(route({ type: 'wizard:stopAdvance' }, contentSender(11, 0), respond)).toBe(false);
    expect(stop).toHaveBeenCalledWith(11);
    route({ type: 'wizard:stopAdvance', tabId: 6 }, pageSender(), respond);
    expect(stop).toHaveBeenLastCalledWith(6);
    route({ type: 'wizard:clear', tabId: 8 }, pageSender(), respond);
    expect(stop).toHaveBeenLastCalledWith(8);
  });
});
