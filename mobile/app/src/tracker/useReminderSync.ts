// Keeps the phone's deadline reminders in step with app state: one second after the last change,
// the plan is rendered in the UI language and handed to the native plugin, which seals and schedules it. An
// unchanged payload is not sent again; a failed sync is retried on the next change and reported through lastError.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../../../../src/i18n';
import { mt } from '../i18n';
import type { RemindersPlugin } from '../native/reminders';
import type { AppState } from '../store/appStateStore';
import { defaultTimeZone } from './model/dates';
import { planReminders, reminderPayload } from './model/reminderPlan';

export const REMINDER_SYNC_DEBOUNCE_MS = 1000;

export function useReminderSync(o: {
  native: RemindersPlugin | null;
  appState: AppState | null;
  language: Language;
  now?: () => number;
  timeZone?: string;
  debounceMs?: number;
}): { lastError: boolean } {
  const { native, appState, language, debounceMs = REMINDER_SYNC_DEBOUNCE_MS } = o;
  const zone = o.timeZone ?? defaultTimeZone();
  const nowRef = useRef(o.now ?? Date.now);
  nowRef.current = o.now ?? Date.now;
  const [lastError, setLastError] = useState(false);
  /** The payload the plugin last accepted (JSON), so an unchanged plan is not sent twice. */
  const lastSent = useRef<string | null>(null);

  const payload = useMemo(() => {
    if (!native || !appState) return null;
    const plan = planReminders(appState, nowRef.current(), zone);
    return reminderPayload(plan, appState.applications, (key, params) => mt(language, key, params));
  }, [native, appState, language, zone]);

  useEffect(() => {
    if (!native || !payload) return;
    const key = JSON.stringify(payload);
    if (key === lastSent.current) return;
    let live = true;
    const timer = setTimeout(() => {
      native.sync(payload).then(
        () => {
          lastSent.current = key;
          if (live) setLastError(false);
        },
        () => {
          lastSent.current = null;
          if (live) setLastError(true);
        },
      );
    }, debounceMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [native, payload, debounceMs]);

  return { lastError };
}
