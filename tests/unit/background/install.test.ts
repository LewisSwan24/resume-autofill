import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { registerBackground } from '../../../src/background';

beforeEach(() => {
  fakeBrowser.reset();
  // Not implemented by the fake browser; registerBackground calls it first.
  vi.spyOn(fakeBrowser.sidePanel, 'setPanelBehavior').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** URLs of the tabs the background asked to open. */
const openedTabs = () => vi.spyOn(fakeBrowser.tabs, 'create');
const urlsOf = (spy: ReturnType<typeof openedTabs>) => spy.mock.calls.map(([props]) => props.url);

describe('background – first install', () => {
  it('opens the welcome page once, on a fresh install', async () => {
    const create = openedTabs();
    registerBackground();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(() => expect(urlsOf(create)).toEqual([browser.runtime.getURL('/welcome.html')]));
  });

  it('does not open it again on an update or a browser update', async () => {
    const create = openedTabs();
    registerBackground();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.9' });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(urlsOf(create)).toEqual([]);
  });
});
