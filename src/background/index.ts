// Background wiring: listeners are registered synchronously (required for MV3 service workers).
import { browser } from 'wxt/browser';
import { seedSamplesIfEmpty } from './seed';
import { createRouter, type BgSender } from './router';
import { clearTabState } from './tabState';
import { clearWizardSession, handleWizardNavigation } from './wizardSession';
import { WELCOME_PAGE, openExtensionPage } from '../ui/pages';

export * from './fill';
export * from './frames';
export * from './merge';
export * from './relay';
export * from './router';
export * from './seed';
export * from './tabState';
export * from './wizardSession';

export function registerBackground(): void {
  // Clicking the toolbar action opens the side panel.
  browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch(() => {
    /* side panel API unavailable (e.g. unsupported browser); ignore */
  });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void seedSamplesIfEmpty().catch(() => undefined);
    // Once, on a fresh install: what the extension does and where to start. Updates open nothing.
    openExtensionPage(WELCOME_PAGE);
  });

  const router = createRouter();
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: BgSender, sendResponse: (response?: unknown) => void) =>
      router(message, sender, sendResponse),
  );

  // A new document in the top frame invalidates the scan counts and the old report,
  // while preserving same-origin wizard continuity across multi-step ATS page redirects.
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    void clearTabState(details.tabId).catch(() => undefined);
    void handleWizardNavigation(details.tabId, details.url).catch(() => undefined);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearTabState(tabId).catch(() => undefined);
    void clearWizardSession(tabId).catch(() => undefined);
  });
}
