// Contract of the native ResumeKeyboard plugin (ResumeKeyboardPlugin.java): whether the resume keyboard (an Android
// input method in this package, ResumeKeyboardService) is enabled and current, the system input-method settings and
// picker, and the sealed slim projection the keyboard reads (files/keyboard.enc). createFakeResumeKeyboard() is the
// stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

export interface KeyboardStatus {
  available: boolean; // the service is declared and InputMethodManager exists
  enabled: boolean; // in InputMethodManager.getEnabledInputMethodList()
  current: boolean; // Settings.Secure.DEFAULT_INPUT_METHOD equals our id
}

export interface ResumeKeyboardPlugin {
  status(): Promise<KeyboardStatus>;
  openInputMethodSettings(): Promise<{ opened: boolean }>; // Settings.ACTION_INPUT_METHOD_SETTINGS
  showPicker(): Promise<{ shown: boolean }>; // InputMethodManager.showInputMethodPicker()
  writeData(o: { data: string }): Promise<void>; // rejects TOO_LARGE | BAD_DATA | WRITE_FAILED
  clearData(): Promise<{ removed: boolean }>;
  addListener(event: 'stateChange', listener: (s: KeyboardStatus) => void): Promise<{ remove(): Promise<void> }>;
}

export const RESUME_KEYBOARD_METHODS = ['status', 'openInputMethodSettings', 'showPicker', 'writeData', 'clearData'] as const;
export const RESUME_KEYBOARD_EVENTS = ['stateChange'] as const;

/** Largest payload writeData accepts, in UTF-8 bytes (native rejects TOO_LARGE above it). */
export const RESUME_KEYBOARD_MAX_BYTES = 524288;

/** The input method id Android uses for the resume keyboard (ComponentName.flattenToShortString()). */
export const RESUME_KEYBOARD_ID = 'app.raf.dev/.keyboard.ResumeKeyboardService';

/** The real plugin (only on a phone). */
export function createNativeResumeKeyboard(): ResumeKeyboardPlugin {
  return registerPlugin<ResumeKeyboardPlugin>('ResumeKeyboard');
}

// ---------------------------------------------------------------- fake for tests

export type FakeResumeKeyboard = ResumeKeyboardPlugin & {
  calls: { method: string; args: unknown }[];
  state: KeyboardStatus;
  stored: string | null; // what writeData stored (tests only)
  failWrites: boolean;
  setState(next: Partial<KeyboardStatus>): void; // also fires 'stateChange'
};

/** A rejection shaped like Capacitor's: a constant code, no call data. */
function rejection(code: 'TOO_LARGE' | 'BAD_DATA' | 'WRITE_FAILED'): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export function createFakeResumeKeyboard(
  init: Partial<KeyboardStatus> & { stored?: string | null } = {},
): FakeResumeKeyboard {
  const listeners = new Set<(s: KeyboardStatus) => void>();
  const fake: FakeResumeKeyboard = {
    calls: [],
    state: { available: init.available ?? true, enabled: init.enabled ?? false, current: init.current ?? false },
    stored: init.stored ?? null,
    failWrites: false,
    async status() {
      fake.calls.push({ method: 'status', args: undefined });
      return { ...fake.state };
    },
    async openInputMethodSettings() {
      fake.calls.push({ method: 'openInputMethodSettings', args: undefined });
      return { opened: fake.state.available };
    },
    async showPicker() {
      fake.calls.push({ method: 'showPicker', args: undefined });
      return { shown: fake.state.available };
    },
    async writeData(o) {
      fake.calls.push({ method: 'writeData', args: o });
      if (new TextEncoder().encode(o.data).length > RESUME_KEYBOARD_MAX_BYTES) throw rejection('TOO_LARGE');
      if (fake.failWrites) throw rejection('WRITE_FAILED');
      fake.stored = o.data;
    },
    async clearData() {
      fake.calls.push({ method: 'clearData', args: undefined });
      const removed = fake.stored !== null;
      fake.stored = null;
      return { removed };
    },
    async addListener(_event, listener) {
      listeners.add(listener);
      return { remove: async () => void listeners.delete(listener) };
    },
    setState(next) {
      fake.state = { ...fake.state, ...next };
      for (const listener of [...listeners]) listener({ ...fake.state });
    },
  };
  return fake;
}
