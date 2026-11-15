// The deadline reminders that should exist right now, and their words in the UI language. Native code
// stores the result sealed and only posts it; times stay local wall-clock strings so a zone change or reboot
// re-schedules them correctly on the device.
import type { ReminderEntry, ReminderSyncPayload } from '../../native/reminders';
import type { AppState, ApplicationRecord } from '../../store/appStateStore';
import { addDays, wallToEpoch } from './dates';
import { displayName, nativeSafeId } from './records';

export interface PlannedReminder {
  id: string;
  recordId: string;
  kind: 'd1' | 'd0';
  /** Wall clock 'YYYY-MM-DDTHH:MM'. */
  at: string;
  end: string;
}

/** A reminder stays in the plan up to this long after it came due (ReminderMath.LATE_POST_MS on the native side):
 *  an inexact alarm can arrive ten minutes late, Doze later still, and a sync in between must not cancel it. Native
 *  posts such an entry once if it is still stored and drops it if its alarm already fired, so nothing shows twice. */
export const REMINDER_LATE_MS = 6 * 60 * 60 * 1000;
export const DAY_OF_LEAD_MIN = 120;
export const REMINDER_TEXT_MAX = 120;

type Translate = (key: string, params?: Record<string, string | number>) => string;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const fromMinutes = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function planReminders(state: AppState, now: number, timeZone: string): PlannedReminder[] {
  const { time, dayBefore, dayOf } = state.reminders;
  const planned: { p: PlannedReminder; instant: number }[] = [];
  for (const r of state.applications) {
    if (!r.remind || !r.deadline || (r.status !== 'wish' && r.status !== 'filling')) continue;
    // Native code rejects the whole sync for one id it cannot take; such a record gets no reminder instead.
    if (!nativeSafeId(r.id)) continue;
    const { date, time: due } = r.deadline;
    const end = `${date}T${due ?? '23:59'}`;
    if (wallToEpoch(date, due ?? '23:59', timeZone) <= now) continue;
    const candidates: { kind: 'd1' | 'd0'; date: string; time: string }[] = [];
    if (dayBefore) candidates.push({ kind: 'd1', date: addDays(date, -1), time });
    if (dayOf) {
      if (!due) candidates.push({ kind: 'd0', date, time });
      else {
        const lead = toMinutes(due) - DAY_OF_LEAD_MIN;
        if (lead >= 0) candidates.push({ kind: 'd0', date, time: fromMinutes(Math.min(toMinutes(time), lead)) });
      }
    }
    for (const c of candidates) {
      const instant = wallToEpoch(c.date, c.time, timeZone);
      if (instant < now - REMINDER_LATE_MS) continue;
      planned.push({ p: { id: `${r.id}:${c.kind}`, recordId: r.id, kind: c.kind, at: `${c.date}T${c.time}`, end }, instant });
    }
  }
  return planned.sort((a, b) => a.instant - b.instant).map(({ p }) => p);
}

function cut(value: string, max: number = REMINDER_TEXT_MAX): string {
  if (value.length <= max) return value;
  let t = value.slice(0, max);
  const last = t.charCodeAt(t.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  return t;
}

export function reminderEntries(plan: readonly PlannedReminder[], records: readonly ApplicationRecord[], t: Translate): ReminderEntry[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const entries: ReminderEntry[] = [];
  for (const p of plan) {
    const r = byId.get(p.recordId);
    if (!r) continue;
    const name = displayName(r);
    const what = r.position || r.host;
    const title = t(p.kind === 'd1' ? 'm.notif.dayBefore' : 'm.notif.dayOf', { name });
    const text = r.deadline?.time ? t('m.notif.bodyAt', { what, time: r.deadline.time }) : t('m.notif.body', { what });
    entries.push({ id: p.id, recordId: p.recordId, at: p.at, end: p.end, title: cut(title), text: cut(text) });
  }
  return entries;
}

/** Everything `RemindersPlugin.sync` takes, in one language. */
export function reminderPayload(plan: readonly PlannedReminder[], records: readonly ApplicationRecord[], t: Translate): ReminderSyncPayload {
  return {
    channel: { name: t('m.notif.channel'), description: t('m.notif.channelText') },
    publicText: t('m.notif.public'),
    openPageLabel: t('m.notif.openPage'),
    entries: reminderEntries(plan, records, t),
  };
}
