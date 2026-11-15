// Keeps the launcher's shortcuts in step with the records: the dynamic 继续：{company}, and pinned
// ones disabled for deleted records (re-enabled on undo). Sent 1 s after the last change, never twice for the same
// value; a failure is forgotten so the next change tries again.
import { useEffect, useMemo, useRef } from 'react';
import type { Language } from '../../../../src/i18n';
import { mt } from '../i18n';
import type { AppShortcutsPlugin } from '../native/appShortcuts';
import type { AppState } from '../store/appStateStore';
import { buildShortcutSync } from './shortcutList';

export interface UseShortcutSyncOptions {
  native: AppShortcutsPlugin | null;
  appState: AppState | null;
  language: Language;
  debounceMs?: number;
}

export function useShortcutSync({ native, appState, language, debounceMs = 1000 }: UseShortcutSyncOptions): void {
  const payload = useMemo(
    () => (appState ? JSON.stringify(buildShortcutSync(appState, (key, params) => mt(language, key, params))) : null),
    [appState, language],
  );
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!native || payload === null || payload === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = payload;
      native.sync(JSON.parse(payload) as ReturnType<typeof buildShortcutSync>).catch(() => {
        if (lastSent.current === payload) lastSent.current = null;
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [native, payload, debounceMs]);
}
