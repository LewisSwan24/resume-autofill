// Keeps the resume keyboard's file (files/keyboard.enc) in step with the profile.
// While the keyboard is enabled in system settings and 「在输入法里显示简历」 is on, the projection is written one
// second after the last change; an unchanged payload is not sent again. Otherwise, or when no resume has anything to
// show, the file is cleared: once per transition, and once at the first known status, so a stale file from an
// earlier session goes too. Nothing is sent while anything is still unknown, nor while delete-all runs (suspended).
// A failed call sets lastError and is retried on the next input change. Same pattern as useReminderSync.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../../../../src/i18n';
import type { Profile } from '../../../../src/schema';
import type { ResumeKeyboardPlugin } from '../native/resumeKeyboard';
import type { AppState } from '../store/appStateStore';
import { KeyboardDataTooLarge, buildKeyboardData } from './projection';

export const KEYBOARD_SYNC_DEBOUNCE_MS = 1000;

/** What the file should hold: the payload JSON, or CLEARED. */
const CLEARED = 'cleared';

type Target = { kind: 'none' } | { kind: 'tooLarge' } | { kind: 'send'; key: string };

export function useKeyboardSync(o: {
  native: ResumeKeyboardPlugin | null;
  /** Null while loading or unreadable: nothing is sent. */
  profile: Profile | null;
  /** Null while loading or read-only: nothing is sent. */
  appState: AppState | null;
  language: Language;
  /** useKeyboardStatus().status?.enabled; null = not known yet: nothing is sent. */
  enabled: boolean | null;
  /** True while delete-all runs: cancels the pending write and sends nothing. */
  suspended?: boolean;
  debounceMs?: number;
}): { lastError: boolean } {
  const { native, profile, appState, language, enabled, suspended = false, debounceMs = KEYBOARD_SYNC_DEBOUNCE_MS } = o;
  const [lastError, setLastError] = useState(false);
  /** What the plugin last accepted (payload JSON or CLEARED); null when unknown or after a failure. */
  const lastSent = useRef<string | null>(null);
  /** Bumped by every call, so a reply that comes back after a newer call does not overwrite lastSent. */
  const seq = useRef(0);

  // A new object on every input change, so a failed call is retried on the next change even when the payload is
  // the same; the effect itself dedupes by JSON.
  const target = useMemo((): Target => {
    if (!native || !profile || !appState || enabled === null) return { kind: 'none' };
    if (enabled !== true || !appState.keyboard.show) return { kind: 'send', key: CLEARED };
    try {
      const data = buildKeyboardData(profile, { language, fillLanguage: appState.fillLanguage, hidden: appState.keyboard.hidden });
      return { kind: 'send', key: data === null ? CLEARED : JSON.stringify(data) };
    } catch (error) {
      if (error instanceof KeyboardDataTooLarge) return { kind: 'tooLarge' };
      throw error;
    }
  }, [native, profile, appState, language, enabled]);

  useEffect(() => {
    if (!native || suspended) return;
    if (target.kind === 'tooLarge') {
      setLastError(true);
      return;
    }
    if (target.kind !== 'send' || target.key === lastSent.current) return;
    const { key } = target;
    const settle = (call: number, ok: boolean) => {
      if (call !== seq.current) return;
      lastSent.current = ok ? key : null;
      setLastError(!ok);
    };

    if (key === CLEARED) {
      // Removing data is never delayed. Marked at once, so a re-render before the reply does not clear twice.
      const call = ++seq.current;
      lastSent.current = CLEARED;
      native.clearData().then(
        () => settle(call, true),
        () => settle(call, false),
      );
      return;
    }

    const timer = setTimeout(() => {
      if (key === lastSent.current) return;
      const call = ++seq.current;
      native.writeData({ data: key }).then(
        () => settle(call, true),
        () => settle(call, false),
      );
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [native, target, suspended, debounceMs]);

  return { lastError };
}
