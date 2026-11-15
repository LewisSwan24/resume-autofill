// Contract of the native AppShortcuts plugin (AppShortcutsPlugin.java): the dynamic "last application" launcher
// shortcut and pinned shortcuts per record. Shortcuts carry a record id only, never a URL.
// createFakeShortcuts() is the stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

/** id is 'last-application' (dynamic) or `app-${recordId}` (pinned). */
export interface ShortcutItem { id: string; recordId: string; shortLabel: string; longLabel: string }

export interface AppShortcutsPlugin {
  sync(o: { dynamic: ShortcutItem[]; liveRecordIds: string[]; disabledMessage: string }): Promise<void>;
  canPin(): Promise<{ supported: boolean }>;
  requestPin(o: ShortcutItem): Promise<{ requested: boolean }>;
  clearAll(): Promise<void>;
}

export const SHORTCUTS_METHODS = ['sync', 'canPin', 'requestPin', 'clearAll'] as const;
export const SHORTCUTS_EVENTS = [] as const;

/** The real plugin (only on a phone). */
export function createNativeShortcuts(): AppShortcutsPlugin {
  return registerPlugin<AppShortcutsPlugin>('AppShortcuts');
}

// ---------------------------------------------------------------- fake for tests

export type FakeShortcuts = AppShortcutsPlugin & { calls: { method: string; args: unknown }[] };

export function createFakeShortcuts(init: { canPin?: boolean } = {}): FakeShortcuts {
  const supported = init.canPin ?? true;
  const fake: FakeShortcuts = {
    calls: [],
    async sync(o) {
      fake.calls.push({ method: 'sync', args: o });
    },
    async canPin() {
      fake.calls.push({ method: 'canPin', args: undefined });
      return { supported };
    },
    async requestPin(o) {
      fake.calls.push({ method: 'requestPin', args: o });
      return { requested: supported };
    },
    async clearAll() {
      fake.calls.push({ method: 'clearAll', args: undefined });
    },
  };
  return fake;
}
