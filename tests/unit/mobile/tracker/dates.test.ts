// Wall clock ↔ instant, calendar days, deadline badges and date formats.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  deadlineBadge,
  deadlineEnd,
  formatDate,
  formatDateTime,
  localDate,
  wallToEpoch,
} from '../../../../mobile/app/src/tracker/model/dates';

// Shared with ReminderMathTest.java (Java's LocalDateTime.atZone(zone).toInstant()).
const FIXTURES: [string, string, string][] = [
  ['Asia/Shanghai', '2026-11-20T09:00', '2026-11-20T01:00:00Z'],
  ['America/New_York', '2026-03-08T02:30', '2026-03-08T07:30:00Z'],
  ['America/New_York', '2026-11-01T01:30', '2026-11-01T05:30:00Z'],
  ['Europe/London', '2026-07-01T00:00', '2026-06-30T23:00:00Z'],
  ['UTC', '2026-12-31T23:59', '2026-12-31T23:59:00Z'],
];

const SH = 'Asia/Shanghai';
const at = (iso: string) => Date.parse(iso);

describe('dates', () => {
  it.each(FIXTURES)('wallToEpoch %s %s → %s', (zone, wall, instant) => {
    const [date, time] = wall.split('T') as [string, string];
    expect(new Date(wallToEpoch(date, time, zone)).toISOString()).toBe(instant.replace('Z', '.000Z'));
  });

  it('localDate near midnight in two zones', () => {
    const t = at('2026-11-19T16:30:00Z');
    expect(localDate(t, SH)).toBe('2026-11-20');
    expect(localDate(t, 'America/New_York')).toBe('2026-11-19');
    expect(localDate(at('2026-11-19T15:59:59Z'), SH)).toBe('2026-11-19');
  });

  it('daysBetween across a month and a DST change', () => {
    expect(daysBetween('2026-11-28', '2026-12-03')).toBe(5);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-03-09', '2026-03-07')).toBe(-2);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('deadlineEnd is the time given, else the last millisecond of the day', () => {
    expect(deadlineEnd({ date: '2026-11-20', time: '18:00' }, SH)).toBe(at('2026-11-20T10:00:00Z'));
    expect(deadlineEnd({ date: '2026-11-20' }, SH)).toBe(at('2026-11-20T15:59:59.999Z'));
  });

  it('formatDate zh and en, this year and another year', () => {
    const now = at('2026-11-15T04:00:00Z');
    expect(formatDate('2026-11-20', 'zh', now, SH)).toBe('11月20日');
    expect(formatDate('2026-11-20', 'en', now, SH)).toBe('20 Nov');
    expect(formatDate('2027-01-05', 'zh', now, SH)).toBe('2027年1月5日');
    expect(formatDate('2027-01-05', 'en', now, SH)).toBe('5 Jan 2027');
  });

  it('formatDateTime in the zone given', () => {
    const t = at('2026-11-14T12:31:00Z');
    expect(formatDateTime(t, 'zh', SH)).toBe('11月14日 20:31');
    expect(formatDateTime(t, 'en', SH)).toBe('14 Nov, 20:31');
    expect(formatDateTime(t, 'en', 'UTC')).toBe('14 Nov, 12:31');
  });
});

describe('deadlineBadge', () => {
  const now = at('2026-11-15T04:00:00Z'); // 12:00 in Shanghai
  const badge = (date: string, time?: string, status: 'wish' | 'filling' | 'submitted' | 'closed' = 'wish', n = now) =>
    deadlineBadge({ date, ...(time ? { time } : {}) }, status, n, SH, 'zh');

  it('badge for −1, 0, 0 with time, 0 after the time, 1, 2, 13, 14 days', () => {
    expect(badge('2026-11-14')).toEqual({ key: 'm.deadline.passed', urgency: 'passed' });
    expect(badge('2026-11-15')).toEqual({ key: 'm.deadline.today', urgency: 'today' });
    expect(badge('2026-11-15', '18:00', 'filling')).toEqual({ key: 'm.deadline.todayAt', params: { time: '18:00' }, urgency: 'today' });
    expect(badge('2026-11-15', '11:00')).toEqual({ key: 'm.deadline.passed', urgency: 'passed' });
    expect(badge('2026-11-16')).toEqual({ key: 'm.deadline.tomorrow', urgency: 'soon' });
    expect(badge('2026-11-17')).toEqual({ key: 'm.deadline.days', params: { n: 2 }, urgency: 'later' });
    expect(badge('2026-11-28')).toEqual({ key: 'm.deadline.days', params: { n: 13 }, urgency: 'later' });
    expect(badge('2026-11-29')).toEqual({ key: 'm.deadline.on', params: { date: '11月29日' }, urgency: 'later' });
  });

  it('other statuses show the plain date', () => {
    expect(badge('2026-11-15', undefined, 'submitted')).toEqual({ key: 'm.deadline.plain', params: { date: '11月15日' }, urgency: 'plain' });
    expect(badge('2026-11-01', undefined, 'closed')).toEqual({ key: 'm.deadline.plain', params: { date: '11月1日' }, urgency: 'plain' });
    expect(deadlineBadge({ date: '2026-11-29' }, 'interview', now, SH, 'en')).toEqual({
      key: 'm.deadline.plain',
      params: { date: '29 Nov' },
      urgency: 'plain',
    });
  });
});
