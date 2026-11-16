// Contract of the native Reminders plugin (RemindersPlugin.java): notification permission, and the sealed list of
// deadline reminders that native code schedules with inexact alarms. Every word in a payload is rendered here in the
// UI language; native code only stores and posts it. createFakeReminders() is the stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

export type NotifPermission = 'granted' | 'denied' | 'prompt';

/** `at` and `end` are local wall-clock times 'YYYY-MM-DDTHH:MM'; `id` is `${recordId}:d0` or `${recordId}:d1`. */
export interface ReminderEntry { id: string; recordId: string; at: string; end: string; title: string; text: string }

export interface ReminderSyncPayload {
  channel: { name: string; description: string };
  publicText: string;
  openPageLabel: string;
  entries: ReminderEntry[];
}

export interface RemindersPlugin {
  status(): Promise<{ permission: NotifPermission; enabled: boolean; channelBlocked: boolean }>;
  requestPermission(): Promise<{ permission: NotifPermission }>;
  openSettings(): Promise<{ opened: boolean }>;
  sync(o: ReminderSyncPayload): Promise<{ scheduled: number }>;
  clear(): Promise<void>;
}

export const REMINDERS_METHODS = ['status', 'requestPermission', 'openSettings', 'sync', 'clear'] as const;
export const REMINDERS_EVENTS = [] as const;

/** Limits the native side enforces on sync (it rejects with a constant message past them). */
export const REMINDERS_MAX_ENTRIES = 1000;
export const REMINDERS_MAX_TEXT = 200;

/** The real plugin (only on a phone). */
export function createNativeReminders(): RemindersPlugin {
  return registerPlugin<RemindersPlugin>('Reminders');
}

// ---------------------------------------------------------------- fake for tests

export type FakeReminders = RemindersPlugin & {
  synced: ReminderSyncPayload[];
  calls: { method: string; args: unknown }[];
  permission: NotifPermission;
  enabled: boolean;
};

export function createFakeReminders(
  init: { permission?: NotifPermission; enabled?: boolean; answer?: NotifPermission; failSync?: boolean } = {},
): FakeReminders {
  const permission = init.permission ?? 'prompt';
  const fake: FakeReminders = {
    synced: [],
    calls: [],
    permission,
    enabled: init.enabled ?? permission === 'granted',
    async status() {
      fake.calls.push({ method: 'status', args: undefined });
      return { permission: fake.permission, enabled: fake.enabled, channelBlocked: false };
    },
    async requestPermission() {
      fake.calls.push({ method: 'requestPermission', args: undefined });
      if (fake.permission === 'prompt') {
        fake.permission = init.answer ?? 'granted';
        fake.enabled = fake.permission === 'granted';
      }
      return { permission: fake.permission };
    },
    async openSettings() {
      fake.calls.push({ method: 'openSettings', args: undefined });
      return { opened: true };
    },
    async sync(o) {
      fake.calls.push({ method: 'sync', args: o });
      if (init.failSync) throw new Error('sync_failed');
      fake.synced.push(o);
      return { scheduled: o.entries.length };
    },
    async clear() {
      fake.calls.push({ method: 'clear', args: undefined });
    },
  };
  return fake;
}
