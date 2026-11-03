// Background wiring: listeners are registered synchronously (required for MV3 service workers).
import { browser } from 'wxt/browser';
import { seedSamplesIfEmpty } from './seed';
import { createRouter, type BgSender } from './router';
import { clearTabState } from './tabState';

export * from './fill';
export * from './frames';
export * from './merge';
export * from './relay';
export * from './router';
export * from './seed';
export * from './tabState';

export function registerBackground(): void {
  // Clicking the toolbar action opens the side panel.
  browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch(() => {
    /* side panel API unavailable (e.g. unsupported browser); ignore */
  });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void seedSamplesIfEmpty().catch(() => undefined);
  });

  const router = createRouter();
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: BgSender, sendResponse: (response?: unknown) => void) =>
      router(message, sender, sendResponse),
  );

  // A new document in the top frame invalidates the scan counts and the old report.
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) void clearTabState(details.tabId).catch(() => undefined);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearTabState(tabId).catch(() => undefined);
  });
}
