// The extension's own pages, opened the same way from every surface: the profile editor (the options page), the help
// page and the welcome page. Extension pages only; content scripts go through the background (`ui:openOptions`).
import { browser } from 'wxt/browser';

export const HELP_PAGE = '/help.html';
export const WELCOME_PAGE = '/welcome.html';
export type ExtensionPage = typeof HELP_PAGE | typeof WELCOME_PAGE;

/** Open the profile editor; Chrome focuses its tab when it is already open. */
export function openProfilePage(): void {
  browser.runtime.openOptionsPage().catch(() => undefined);
}

/** Open one of the extension's pages in a new tab. */
export function openExtensionPage(page: ExtensionPage): void {
  browser.tabs.create({ url: browser.runtime.getURL(page) }).catch(() => undefined);
}
