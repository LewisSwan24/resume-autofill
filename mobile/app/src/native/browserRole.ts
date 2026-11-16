// Contract of the native BrowserRole plugin (BrowserRolePlugin.java): whether the app holds the browser role, the
// system dialog to ask for it, the default-apps settings, and 「用系统浏览器打开」 in another browser.
// createFakeBrowserRole() is the stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

export interface BrowserRolePlugin {
  state(): Promise<{ available: boolean; held: boolean }>;
  request(): Promise<{ held: boolean }>;
  openDefaultAppsSettings(): Promise<{ opened: boolean }>;
  openInOtherBrowser(o: { url: string; title: string }): Promise<{ opened: boolean; reason?: 'none' | 'bad_url' }>;
}

export const BROWSER_ROLE_METHODS = ['state', 'request', 'openDefaultAppsSettings', 'openInOtherBrowser'] as const;
export const BROWSER_ROLE_EVENTS = [] as const;

/** Longest URL openInOtherBrowser accepts. */
export const BROWSER_ROLE_MAX_URL = 2048;

/** The real plugin (only on a phone). */
export function createNativeBrowserRole(): BrowserRolePlugin {
  return registerPlugin<BrowserRolePlugin>('BrowserRole');
}

// ---------------------------------------------------------------- fake for tests

export type FakeBrowserRole = BrowserRolePlugin & {
  calls: { method: string; args: unknown }[];
  available: boolean;
  held: boolean;
  others: number;
};

export function createFakeBrowserRole(init: { available?: boolean; held?: boolean; others?: number } = {}): FakeBrowserRole {
  const fake: FakeBrowserRole = {
    calls: [],
    available: init.available ?? true,
    held: init.held ?? false,
    others: init.others ?? 0,
    async state() {
      fake.calls.push({ method: 'state', args: undefined });
      return { available: fake.available, held: fake.held };
    },
    async request() {
      fake.calls.push({ method: 'request', args: undefined });
      if (fake.available) fake.held = true;
      return { held: fake.held };
    },
    async openDefaultAppsSettings() {
      fake.calls.push({ method: 'openDefaultAppsSettings', args: undefined });
      return { opened: true };
    },
    async openInOtherBrowser(o) {
      fake.calls.push({ method: 'openInOtherBrowser', args: o });
      if (!/^https?:\/\//i.test(o.url) || o.url.length > BROWSER_ROLE_MAX_URL) return { opened: false, reason: 'bad_url' };
      if (fake.others === 0) return { opened: false, reason: 'none' };
      return { opened: true };
    },
  };
  return fake;
}
