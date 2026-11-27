// The recorder's way into Chrome: the debugger for the tab's network, scripting for its frames and session storage.
// Both permissions come only with a recorder build (src/capture/build.ts).
import { browser } from 'wxt/browser';
import type { RecorderApi } from '../../src/capture/recorder';

const PROTOCOL = '1.3';

export const chromeRecorderApi: RecorderApi = {
  attach: (tabId) => browser.debugger.attach({ tabId }, PROTOCOL),
  detach: (tabId) => browser.debugger.detach({ tabId }),
  send: (tabId, method, params) => browser.debugger.sendCommand({ tabId }, method, params as Record<string, unknown> | undefined),
  onEvent(listener) {
    const l = (source: { tabId?: number }, method: string, params?: object) => listener(source, method, params);
    browser.debugger.onEvent.addListener(l);
    return () => browser.debugger.onEvent.removeListener(l);
  },
  onDetach(listener) {
    const l = (source: { tabId?: number }, reason: string) => listener(source, reason);
    browser.debugger.onDetach.addListener(l);
    return () => browser.debugger.onDetach.removeListener(l);
  },
  reload: (tabId) => browser.tabs.reload(tabId),
  async runInTop(tabId, func) {
    const [first] = await browser.scripting.executeScript({ target: { tabId }, func });
    return first!.result as ReturnType<typeof func>;
  },
  async runInFrames(tabId, func) {
    const results = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func });
    return results.map((r) => ({ frameId: r.frameId, result: r.result as ReturnType<typeof func> }));
  },
  async frames(tabId) {
    const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [];
    return frames.map((f) => ({ frameId: f.frameId, parentFrameId: f.parentFrameId, url: f.url }));
  },
};
