// Dates of the tracker. Deadlines are local wall-clock strings ('2026-11-20', '18:00'); they become
// instants only here, in the device's zone, with the same rules as Java's LocalDateTime.atZone(zone).toInstant()
// (a time in a spring-forward gap moves later by the gap; a time that happens twice takes the earlier offset).
import type { Language } from '../../../../../src/i18n';
import type { MobileKey } from '../../i18n';
import type { ApplicationStatus, Deadline } from '../../store/appStateStore';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The device's zone, else UTC. */
export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallOf(epoch: number, timeZone: string): Wall {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(epoch))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

/** Zone offset (ms) in effect at an instant: wall time read as UTC minus the instant. */
function offsetAt(epoch: number, timeZone: string): number {
  const floored = Math.floor(epoch / 1000) * 1000;
  const w = wallOf(floored, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - floored;
}

function ymd(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function wallToEpoch(date: string, time: string, timeZone: string): number {
  const [y, m, d] = ymd(date);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetAt(asUtc - 14 * HOUR_MS, timeZone);
  const after = offsetAt(asUtc + 14 * HOUR_MS, timeZone);
  const valid = [...new Set([before, after])].map((o) => asUtc - o).filter((t) => offsetAt(t, timeZone) === asUtc - t);
  if (valid.length > 0) return Math.min(...valid); // an overlap takes the earlier instant (the earlier offset)
  return asUtc - before; // a gap: shifted later by its length
}

export function localDate(epoch: number, timeZone: string): string {
  const w = wallOf(epoch, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function localTime(epoch: number, timeZone: string): string {
  const w = wallOf(epoch, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = ymd(date);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [a, b, c] = ymd(from);
  const [x, y, z] = ymd(to);
  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / DAY_MS);
}

/** The last moment of a deadline: its time, else 23:59:59.999 of its day. */
export function deadlineEnd(d: Deadline, timeZone: string): number {
  return d.time ? wallToEpoch(d.date, d.time, timeZone) : wallToEpoch(d.date, '23:59', timeZone) + 59_999;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 11月20日 / 20 Nov; another year than now's: 2027年1月5日 / 5 Jan 2027. */
export function formatDate(date: string, language: Language, now: number, timeZone: string): string {
  const [y, m, d] = ymd(date);
  const thisYear = Number(localDate(now, timeZone).slice(0, 4)) === y;
  if (language === 'zh') return thisYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  return thisYear ? `${d} ${EN_MONTHS[m - 1]}` : `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/** 11月14日 20:31 / 14 Nov, 20:31. */
export function formatDateTime(epoch: number, language: Language, timeZone: string): string {
  const w = wallOf(epoch, timeZone);
  const time = `${pad(w.hour)}:${pad(w.minute)}`;
  return language === 'zh' ? `${w.month}月${w.day}日 ${time}` : `${w.day} ${EN_MONTHS[w.month - 1]}, ${time}`;
}

export type DeadlineUrgency = 'passed' | 'today' | 'soon' | 'later' | 'plain';

export interface DeadlineBadge {
  key: MobileKey | (string & {});
  params?: Record<string, string | number>;
  urgency: DeadlineUrgency;
}

/** What a deadline says on a row (3.10): urgent wording only while the application is still open (想投/填写中). */
export function deadlineBadge(d: Deadline, status: ApplicationStatus, now: number, timeZone: string, language: Language): DeadlineBadge {
  if (status !== 'wish' && status !== 'filling')
    return { key: 'm.deadline.plain', params: { date: formatDate(d.date, language, now, timeZone) }, urgency: 'plain' };
  const days = daysBetween(localDate(now, timeZone), d.date);
  if (days < 0 || (days === 0 && now > deadlineEnd(d, timeZone))) return { key: 'm.deadline.passed', urgency: 'passed' };
  if (days === 0) return d.time ? { key: 'm.deadline.todayAt', params: { time: d.time }, urgency: 'today' } : { key: 'm.deadline.today', urgency: 'today' };
  if (days === 1) return { key: 'm.deadline.tomorrow', urgency: 'soon' };
  if (days <= 13) return { key: 'm.deadline.days', params: { n: days }, urgency: 'later' };
  return { key: 'm.deadline.on', params: { date: formatDate(d.date, language, now, timeZone) }, urgency: 'later' };
}
