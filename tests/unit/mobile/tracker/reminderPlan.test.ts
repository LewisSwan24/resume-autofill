// Which deadline reminders exist and what they say.
import { describe, expect, it } from 'vitest';
import { mt } from '../../../../mobile/app/src/i18n';
import {
  ApplicationRecordSchema,
  defaultAppState,
  type AppState,
  type ApplicationRecord,
  type ReminderSettings,
} from '../../../../mobile/app/src/store/appStateStore';
import { wallToEpoch } from '../../../../mobile/app/src/tracker/model/dates';
import { planReminders, reminderEntries, reminderPayload } from '../../../../mobile/app/src/tracker/model/reminderPlan';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-15T04:00:00Z'); // 12:00 in Shanghai

const rec = (o: Partial<ApplicationRecord> & { id: string }): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    url: `https://jobs.example.com/${o.id}`,
    host: 'jobs.example.com',
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    remind: true,
    deadline: { date: '2026-11-20' },
    ...o,
  });

const state = (records: ApplicationRecord[], reminders: Partial<ReminderSettings> = {}): AppState =>
  defaultAppState({ applications: records, reminders: { time: '09:00', dayBefore: true, dayOf: true, defaultOn: false, ...reminders } });

const plain = (plan: ReturnType<typeof planReminders>) => plan.map((p) => `${p.id} ${p.at} ${p.end}`);

describe('planReminders', () => {
  it('both reminders at 09:00 in Shanghai', () => {
    expect(planReminders(state([rec({ id: 'a' })]), NOW, SH)).toEqual([
      { id: 'a:d1', recordId: 'a', kind: 'd1', at: '2026-11-19T09:00', end: '2026-11-20T23:59' },
      { id: 'a:d0', recordId: 'a', kind: 'd0', at: '2026-11-20T09:00', end: '2026-11-20T23:59' },
    ]);
  });

  it('only the day before', () => {
    expect(plain(planReminders(state([rec({ id: 'a' })], { dayOf: false }), NOW, SH))).toEqual(['a:d1 2026-11-19T09:00 2026-11-20T23:59']);
  });

  it('only on the day', () => {
    expect(plain(planReminders(state([rec({ id: 'a' })], { dayBefore: false }), NOW, SH))).toEqual(['a:d0 2026-11-20T09:00 2026-11-20T23:59']);
  });

  it('deadline 18:00 with reminder 20:00 moves the day-of reminder to 16:00', () => {
    const plan = planReminders(state([rec({ id: 'a', deadline: { date: '2026-11-20', time: '18:00' } })], { time: '20:00' }), NOW, SH);
    expect(plain(plan)).toEqual(['a:d1 2026-11-19T20:00 2026-11-20T18:00', 'a:d0 2026-11-20T16:00 2026-11-20T18:00']);
    const early = planReminders(state([rec({ id: 'a', deadline: { date: '2026-11-20', time: '18:00' } })]), NOW, SH);
    expect(plain(early)[1]).toBe('a:d0 2026-11-20T09:00 2026-11-20T18:00');
  });

  it('deadline 01:00 has no day-of reminder', () => {
    const plan = planReminders(state([rec({ id: 'a', deadline: { date: '2026-11-20', time: '01:00' } })]), NOW, SH);
    expect(plain(plan)).toEqual(['a:d1 2026-11-19T09:00 2026-11-20T01:00']);
    const two = planReminders(state([rec({ id: 'a', deadline: { date: '2026-11-20', time: '02:00' } })]), NOW, SH);
    expect(plain(two)[1]).toBe('a:d0 2026-11-20T00:00 2026-11-20T02:00');
  });

  it('a day-before reminder more than 6 h past is dropped and the day-of kept', () => {
    const plan = planReminders(state([rec({ id: 'a', deadline: { date: '2026-11-16' } })], { time: '05:00' }), NOW, SH);
    expect(plain(plan)).toEqual(['a:d0 2026-11-16T05:00 2026-11-16T23:59']);
  });

  it('a reminder that came due less than 6 h ago stays planned (its alarm may not have fired yet); older ones go', () => {
    // A sync at 09:03 must not cancel the 09:00 alarm that setWindow or Doze delayed.
    // Native posts such an entry once if it is still stored, and drops it if it was already delivered.
    const s = state([rec({ id: 'a', deadline: { date: '2026-11-16' } })], { dayBefore: false });
    const at = wallToEpoch('2026-11-16', '09:00', SH);
    expect(plain(planReminders(s, at - 30_000, SH))).toEqual(['a:d0 2026-11-16T09:00 2026-11-16T23:59']);
    expect(plain(planReminders(s, at + 3 * 60_000, SH))).toEqual(['a:d0 2026-11-16T09:00 2026-11-16T23:59']);
    expect(planReminders(s, at + 6 * 3_600_000, SH)).toHaveLength(1);
    expect(planReminders(s, at + 6 * 3_600_000 + 1, SH)).toEqual([]);
  });

  it('a due reminder whose deadline has passed is not planned', () => {
    const s = state([rec({ id: 'a', deadline: { date: '2026-11-16', time: '12:00' } })], { dayBefore: false, time: '09:00' });
    const end = wallToEpoch('2026-11-16', '12:00', SH);
    expect(planReminders(s, end - 1, SH)).toHaveLength(1);
    expect(planReminders(s, end, SH)).toEqual([]);
  });

  it('no reminder when off, without a deadline, or when 已提交 / 面试 / 结束', () => {
    const records = [
      rec({ id: 'off', remind: false }),
      rec({ id: 'nodate', deadline: undefined }),
      rec({ id: 's', status: 'submitted' }),
      rec({ id: 'i', status: 'interview' }),
      rec({ id: 'c', status: 'closed' }),
      rec({ id: 'f', status: 'filling' }),
    ];
    expect(planReminders(state(records), NOW, SH).map((p) => p.recordId)).toEqual(['f', 'f']);
  });

  it('a record whose id Android would refuse gets no entry, so the others still sync', () => {
    const s = state([rec({ id: 'x.y', deadline: { date: '2026-11-17' } }), rec({ id: 'ok', deadline: { date: '2026-11-18' } })]);
    const payload = reminderPayload(planReminders(s, NOW, SH), s.applications, (k) => k);
    expect(payload.entries.map((e) => e.id)).toEqual(['ok:d1', 'ok:d0']);
  });

  it('sorted by instant across records', () => {
    const records = [rec({ id: 'late', deadline: { date: '2026-11-22' } }), rec({ id: 'soon', deadline: { date: '2026-11-17' } })];
    expect(planReminders(state(records), NOW, SH).map((p) => p.id)).toEqual(['soon:d1', 'soon:d0', 'late:d1', 'late:d0']);
  });

  it('New York DST day keeps 09:00 local', () => {
    const ny = 'America/New_York';
    const now = Date.parse('2026-11-01T00:00:00Z');
    const plan = planReminders(state([rec({ id: 'a', deadline: { date: '2026-11-02' } })]), now, ny);
    expect(plain(plan)).toEqual(['a:d1 2026-11-01T09:00 2026-11-02T23:59', 'a:d0 2026-11-02T09:00 2026-11-02T23:59']);
    expect(new Date(wallToEpoch('2026-11-01', '09:00', ny)).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(new Date(wallToEpoch('2026-10-31', '09:00', ny)).toISOString()).toBe('2026-10-31T13:00:00.000Z');
  });

  it('planning again after a reminder time passed drops it (reboot rescheduling is idempotent)', () => {
    const s = state([rec({ id: 'a' })]);
    const first = planReminders(s, NOW, SH);
    const later = wallToEpoch('2026-11-19', '09:00', SH) + 6 * 3_600_000 + 1000;
    const again = planReminders(s, later, SH);
    expect(again).toEqual(first.slice(1));
    expect(planReminders(s, later, SH)).toEqual(again);
  });
});

describe('reminderEntries', () => {
  const zh = (k: string, p?: Record<string, string | number>) => mt('zh', k, p);
  const en = (k: string, p?: Record<string, string | number>) => mt('en', k, p);

  it('texts in zh and en: titles, body with position and time, host when no position, cut to 120', () => {
    const records = [
      rec({ id: 'a', company: '示例科技', position: '产品经理', deadline: { date: '2026-11-20', time: '18:00' } }),
      rec({ id: 'b', company: '', deadline: { date: '2026-11-21' } }),
      { ...rec({ id: 'c', deadline: { date: '2026-11-22' } }), company: '示'.repeat(130) }, // longer than the schema allows
    ];
    const s = { ...state([]), applications: records };
    const plan = planReminders(s, NOW, SH);
    const zhEntries = reminderEntries(plan, s.applications, zh);
    expect(zhEntries.slice(0, 2)).toEqual([
      { id: 'a:d1', recordId: 'a', at: '2026-11-19T09:00', end: '2026-11-20T18:00', title: '明天截止：示例科技', text: '产品经理，18:00 截止' },
      { id: 'a:d0', recordId: 'a', at: '2026-11-20T09:00', end: '2026-11-20T18:00', title: '今天截止：示例科技', text: '产品经理，18:00 截止' },
    ]);
    expect(zhEntries[2]).toMatchObject({ id: 'b:d1', title: '明天截止：jobs.example.com', text: 'jobs.example.com' });
    expect(zhEntries[4]!.title).toHaveLength(120);
    const enEntries = reminderEntries(plan, s.applications, en);
    expect(enEntries[0]).toMatchObject({ title: 'Due tomorrow: 示例科技', text: '产品经理, closes at 18:00' });
    expect(enEntries[1]!.title).toBe('Due today: 示例科技');
  });

  it('the sync payload carries the channel, the lock-screen text and the action label', () => {
    const s = state([rec({ id: 'a', company: '示例科技' })]);
    const payload = reminderPayload(planReminders(s, NOW, SH), s.applications, zh);
    expect(payload.channel).toEqual({ name: '网申截止提醒', description: '截止日期前一天和当天提醒你' });
    expect(payload.publicText).toBe('有一个网申快截止了');
    expect(payload.openPageLabel).toBe('打开网申页面');
    expect(payload.entries).toHaveLength(2);
  });
});
