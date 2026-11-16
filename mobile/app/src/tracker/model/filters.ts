// The 网申 list's status filter, search and sort, and Home's two short sections. Pure.
import type { ApplicationRecord, ApplicationStatus } from '../../store/appStateStore';
import { daysBetween, deadlineEnd, localDate } from './dates';

export const STATUSES: readonly ApplicationStatus[] = ['wish', 'filling', 'submitted', 'interview', 'closed'];
export type StatusFilter = 'all' | ApplicationStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', ...STATUSES];
export type TrackerSort = 'opened' | 'deadline';
export interface TrackerNav {
  filter: StatusFilter;
  query: string;
  sort: TrackerSort;
}

export const HOME_SECTION_MAX = 3;
export const HOME_DUE_DAYS = 14;

export const normalize = (s: string): string => s.normalize('NFKC').toLowerCase();

/** Every whitespace-separated term occurs in the company, position, host, title or notes. */
export function matchesQuery(r: ApplicationRecord, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [r.company, r.position, r.host, r.title ?? '', r.notes].map(normalize);
  return terms.every((term) => haystack.some((field) => field.includes(term)));
}

const byOpenedDesc = (a: ApplicationRecord, b: ApplicationRecord) => b.openedAt - a.openedAt;

export function filterRecords(records: readonly ApplicationRecord[], nav: TrackerNav, now: number, timeZone: string): ApplicationRecord[] {
  const shown = records.filter((r) => (nav.filter === 'all' || r.status === nav.filter) && matchesQuery(r, nav.query));
  if (nav.sort === 'opened') return shown.sort(byOpenedDesc);
  const ends = new Map(shown.map((r) => [r, r.deadline ? deadlineEnd(r.deadline, timeZone) : null]));
  const rank = (r: ApplicationRecord) => {
    const end = ends.get(r) ?? null;
    return end === null ? 2 : end >= now ? 0 : 1;
  };
  return shown.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return ends.get(a)! - ends.get(b)!;
    if (ra === 1) return ends.get(b)! - ends.get(a)!;
    return byOpenedDesc(a, b);
  });
}

export function countByStatus(records: readonly ApplicationRecord[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: records.length, wish: 0, filling: 0, submitted: 0, interview: 0, closed: 0 };
  for (const r of records) counts[r.status] += 1;
  return counts;
}

const open = (r: ApplicationRecord) => r.status === 'wish' || r.status === 'filling';

/** 快截止了: open records due within 14 days, soonest first; 正在填写: 填写中 not listed above, newest first. */
export function homeSections(
  records: readonly ApplicationRecord[],
  now: number,
  timeZone: string,
): { dueSoon: ApplicationRecord[]; inProgress: ApplicationRecord[]; total: number } {
  const today = localDate(now, timeZone);
  const dueSoon = records
    .filter((r) => open(r) && r.deadline && deadlineEnd(r.deadline, timeZone) >= now && daysBetween(today, r.deadline.date) <= HOME_DUE_DAYS)
    .map((r) => ({ r, end: deadlineEnd(r.deadline!, timeZone) }))
    .sort((a, b) => a.end - b.end)
    .slice(0, HOME_SECTION_MAX)
    .map(({ r }) => r);
  const listed = new Set(dueSoon);
  const inProgress = records
    .filter((r) => r.status === 'filling' && !listed.has(r))
    .sort(byOpenedDesc)
    .slice(0, HOME_SECTION_MAX);
  return { dueSoon, inProgress, total: records.length };
}
