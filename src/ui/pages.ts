// The extension's own pages, opened the same way from every surface: the profile editor (the options page), the help
// page and the welcome page. Extension pages only; content scripts go through the background (`ui:openOptions`).
import { browser } from 'wxt/browser';
import type { ProfileTarget } from '../editor/fieldTarget';

export const HELP_PAGE = '/help.html';
export const WELCOME_PAGE = '/welcome.html';
export type ExtensionPage = typeof HELP_PAGE | typeof WELCOME_PAGE;

/** Open the profile editor; Chrome focuses its tab when it is already open. */
export function openProfilePage(): void {
  browser.runtime.openOptionsPage().catch(() => undefined);
}

/**
 * One-shot request in session storage: the profile page jumps to this input, then deletes it. Storage, not a URL
 * hash, so it also reaches a profile page that is already open (and `openOptionsPage` takes no URL). `at` makes two
 * requests for the same input two changes.
 */
export const PROFILE_FOCUS_KEY = 'profile:focus';
export interface ProfileFocusRequest {
  target: ProfileTarget;
  at: number;
}

/** Open the profile editor at one input; without a target, just open it. */
export function openProfileAt(target: ProfileTarget | null): void {
  if (!target) return openProfilePage();
  const request: ProfileFocusRequest = { target, at: Date.now() };
  browser.storage.session.set({ [PROFILE_FOCUS_KEY]: request }).then(openProfilePage, openProfilePage);
}

/** Open one of the extension's pages in a new tab. */
export function openExtensionPage(page: ExtensionPage): void {
  browser.tabs.create({ url: browser.runtime.getURL(page) }).catch(() => undefined);
}
