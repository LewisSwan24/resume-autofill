// Application records (网申记录): the pure reducers. `applications` stays ordered by openedAt, newest
// first. Status is the person's: the only automatic move is 想投 → 填写中 on the first fill.
import { DEMO_ORIGIN } from '../../browser/model/constants';
import { cleanTitle, sameSite } from '../../browser/model/recentTitle';
import {
  APPLICATIONS_MAX,
  HISTORY_MAX,
  UNTOUCHED_MAX,
  type AppState,
  type ApplicationRecord,
  type ApplicationStatus,
  type Deadline,
  type FillEntry,
} from '../../store/appStateStore';
import { recentKey } from '../../store/recentPages';
import { guessCompany } from './guessCompany';

/** The link without its #fragment: two hash routes of one page are one record. */
export const recordKey = (url: string): string => recentKey(url);

export const displayName = (r: ApplicationRecord): string => r.company || r.host;

/** What Android accepts as a record id (IncomingIntents.validRecordId): reminders and shortcuts carry it. */
const NATIVE_RECORD_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The id can travel to native code. One that cannot (hand-edited or foreign export) would make the plugin reject
 *  the whole reminder or shortcut sync, so callers leave such a record out and import gives it a new id. */
export function nativeSafeId(id: string): boolean {
  return NATIVE_RECORD_ID.test(id);
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Nobody worked on it: 想投, no fill, no deadline, no notes, company still guessed, no position. */
export function isUntouched(r: ApplicationRecord): boolean {
  return r.status === 'wish' && r.history.length === 0 && !r.deadline && r.notes === '' && r.companyGuessed && r.position === '';
}

function recordable(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== DEMO_ORIGIN;
  } catch {
    return false;
  }
}

const byOpenedDesc = (a: ApplicationRecord, b: ApplicationRecord) => b.openedAt - a.openedAt;

function oldest(records: readonly ApplicationRecord[], which: (r: ApplicationRecord) => boolean): ApplicationRecord | undefined {
  let found: ApplicationRecord | undefined;
  for (const r of records) if (which(r) && (found === undefined || r.openedAt < found.openedAt)) found = r;
  return found;
}

/** At most 30 untouched records (oldest out) and 500 in all (oldest 结束 first, then the oldest). */
export function prune(state: AppState): AppState {
  let list = state.applications;
  let untouched = list.filter(isUntouched).length;
  while (untouched > UNTOUCHED_MAX) {
    const drop = oldest(list, isUntouched);
    list = list.filter((r) => r !== drop);
    untouched -= 1;
  }
  while (list.length > APPLICATIONS_MAX) {
    const drop = oldest(list, (r) => r.status === 'closed') ?? oldest(list, () => true);
    list = list.filter((r) => r !== drop);
  }
  return list === state.applications ? state : { ...state, applications: list };
}

/** Cut to `max` UTF-16 units without splitting a surrogate pair. */
function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  let t = value.slice(0, max);
  const last = t.charCodeAt(t.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  return t;
}

/** A given title, cleaned; nothing when absent or blank. */
const titleOf = (title: string | undefined) => (title === undefined ? undefined : cleanTitle(title) || undefined);

function newRecord(id: string, page: { url: string; host: string; title?: string }, now: number): ApplicationRecord {
  return {
    id,
    url: page.url,
    host: page.host,
    ...(titleOf(page.title) !== undefined ? { title: titleOf(page.title) } : {}),
    company: guessCompany(page.title, page.host),
    companyGuessed: true,
    position: '',
    status: 'wish',
    statusAt: now,
    remind: false,
    notes: '',
    createdAt: now,
    openedAt: now,
    updatedAt: now,
    history: [],
  };
}

/** Every non-demo http(s) page the person opens creates or bumps a record (on top). */
export function upsertOnOpen(
  state: AppState,
  page: { url: string; host: string; title?: string },
  now: number,
  newId: () => string = randomId,
): { state: AppState; id: string | null } {
  if (!recordable(page.url)) return { state, id: null };
  const key = recordKey(page.url);
  const existing = state.applications.find((r) => recordKey(r.url) === key);
  let record: ApplicationRecord;
  if (existing) {
    const title = titleOf(page.title) ?? existing.title;
    record = {
      ...existing,
      url: page.url,
      host: page.host,
      ...(title !== undefined ? { title } : {}),
      company: existing.companyGuessed ? guessCompany(title, page.host) : existing.company,
      openedAt: now,
      updatedAt: now,
    };
  } else {
    record = newRecord(newId(), page, now);
  }
  const rest = state.applications.filter((r) => r !== existing);
  return { state: prune({ ...state, applications: [record, ...rest] }), id: record.id };
}

/** Add by hand (3.14). A listed link returns that record unchanged. */
export function addManual(
  state: AppState,
  page: { url: string; host: string; company: string; position: string },
  now: number,
  newId: () => string = randomId,
): { state: AppState; id: string; existed: boolean } {
  const key = recordKey(page.url);
  const existing = state.applications.find((r) => recordKey(r.url) === key);
  if (existing) return { state, id: existing.id, existed: true };
  const company = cut(page.company.trim(), 80);
  const record: ApplicationRecord = {
    ...newRecord(newId(), { url: page.url, host: page.host }, now),
    company,
    companyGuessed: company === '',
    position: cut(page.position.trim(), 80),
  };
  return { state: prune({ ...state, applications: [record, ...state.applications] }), id: record.id, existed: false };
}

function patchRecord(state: AppState, id: string, change: (r: ApplicationRecord) => ApplicationRecord): AppState {
  const index = state.applications.findIndex((r) => r.id === id);
  if (index === -1) return state;
  const before = state.applications[index]!;
  const after = change(before);
  if (after === before) return state;
  const applications = state.applications.slice();
  applications[index] = after;
  return { ...state, applications };
}

/** The page's title once it loads (same rules as updateRecentTitle); refreshes a guessed company. */
export function updateRecordTitle(state: AppState, id: string, title: string, pageHost: string): AppState {
  return patchRecord(state, id, (r) => {
    if (!sameSite(r.host, pageHost)) return r;
    const clean = cleanTitle(title);
    if (!clean || clean === 'about:blank' || clean === r.host || clean === pageHost || clean === r.url) return r;
    if (clean === r.title) return r;
    return { ...r, title: clean, company: r.companyGuessed ? guessCompany(clean, r.host) : r.company };
  });
}

const FIELD_MAX = { company: 80, position: 80, notes: 1000 } as const;

export function editRecord(
  state: AppState,
  id: string,
  patch: Partial<Pick<ApplicationRecord, 'company' | 'position' | 'notes'>>,
  now: number,
): AppState {
  return patchRecord(state, id, (r) => {
    const next = { ...r };
    let changed = false;
    for (const field of ['company', 'position', 'notes'] as const) {
      const value = patch[field];
      if (value === undefined) continue;
      const clean = cut(value.trim(), FIELD_MAX[field]);
      if (clean === r[field]) continue;
      next[field] = clean;
      changed = true;
      if (field === 'company') next.companyGuessed = false;
    }
    if (!changed) return r;
    next.updatedAt = now;
    return next;
  });
}

export function setStatus(state: AppState, id: string, status: ApplicationStatus, now: number): AppState {
  return patchRecord(state, id, (r) => (r.status === status ? r : { ...r, status, statusAt: now, updatedAt: now }));
}

const sameDeadline = (a: Deadline | undefined, b: Deadline | null) =>
  (a === undefined && b === null) || (a !== undefined && b !== null && a.date === b.date && a.time === b.time);

/** null removes the deadline and the reminder; a first deadline takes reminders.defaultOn. */
export function setDeadline(state: AppState, id: string, deadline: Deadline | null, now: number): AppState {
  return patchRecord(state, id, (r) => {
    if (sameDeadline(r.deadline, deadline)) return r;
    if (deadline === null) {
      const { deadline: _gone, ...rest } = r;
      return { ...rest, remind: false, updatedAt: now };
    }
    const clean: Deadline = { date: deadline.date, ...(deadline.time ? { time: deadline.time } : {}) };
    return { ...r, deadline: clean, remind: r.deadline ? r.remind : state.reminders.defaultOn, updatedAt: now };
  });
}

export function setRemind(state: AppState, id: string, on: boolean, now: number): AppState {
  return patchRecord(state, id, (r) => (r.remind === on ? r : { ...r, remind: on, updatedAt: now }));
}

export function deleteRecord(
  state: AppState,
  id: string,
): { state: AppState; removed: { record: ApplicationRecord; index: number } | null } {
  const index = state.applications.findIndex((r) => r.id === id);
  if (index === -1) return { state, removed: null };
  const record = state.applications[index]!;
  return { state: { ...state, applications: state.applications.filter((r) => r !== record) }, removed: { record, index } };
}

/** Undo a delete. A record for the same link opened since wins and the old one stays gone. */
export function restoreRecord(state: AppState, removed: { record: ApplicationRecord; index: number }): AppState {
  const key = recordKey(removed.record.url);
  if (state.applications.some((r) => recordKey(r.url) === key || r.id === removed.record.id)) return state;
  const applications = state.applications.slice();
  applications.splice(Math.min(removed.index, applications.length), 0, removed.record);
  applications.sort(byOpenedDesc); // stable
  return prune({ ...state, applications });
}

/** A finished fill: newest first, at most 20; 想投 becomes 填写中. */
export function recordFill(state: AppState, id: string, entry: FillEntry, now: number): AppState {
  return patchRecord(state, id, (r) => ({
    ...r,
    history: [entry, ...r.history].slice(0, HISTORY_MAX),
    ...(r.status === 'wish' ? { status: 'filling' as const, statusAt: now } : {}),
    updatedAt: now,
  }));
}

export function markFillUndone(state: AppState, id: string, at: number): AppState {
  return patchRecord(state, id, (r) => {
    if (!r.history.some((h) => h.at === at && !h.undone)) return r;
    return { ...r, history: r.history.map((h) => (h.at === at ? { ...h, undone: true } : h)) };
  });
}

function mergeHistories(primary: readonly FillEntry[], secondary: readonly FillEntry[]): FillEntry[] {
  const seen = new Set<number>();
  const all: FillEntry[] = [];
  for (const h of [...primary, ...secondary]) {
    if (seen.has(h.at)) continue;
    seen.add(h.at);
    all.push(h);
  }
  return all.sort((a, b) => b.at - a.at).slice(0, HISTORY_MAX);
}

/** Import (5.8): replace, or merge by link where the newer edit wins, my id is kept and histories are joined. */
export function mergeImported(
  state: AppState,
  incoming: readonly ApplicationRecord[],
  mode: 'merge' | 'replace',
  newId: () => string = randomId,
): { state: AppState; added: number; updated: number } {
  if (mode === 'replace') {
    const applications = incoming.map((r) => (nativeSafeId(r.id) ? r : { ...r, id: newId() })).sort(byOpenedDesc);
    return { state: prune({ ...state, applications }), added: incoming.length, updated: 0 };
  }
  const list = state.applications.slice();
  let added = 0;
  let updated = 0;
  for (const theirs of incoming) {
    const key = recordKey(theirs.url);
    const index = list.findIndex((r) => recordKey(r.url) === key);
    if (index === -1) {
      const taken = !nativeSafeId(theirs.id) || list.some((r) => r.id === theirs.id);
      list.push(taken ? { ...theirs, id: newId() } : theirs);
      added += 1;
      continue;
    }
    const mine = list[index]!;
    const newer = theirs.updatedAt > mine.updatedAt;
    const history = newer ? mergeHistories(theirs.history, mine.history) : mergeHistories(mine.history, theirs.history);
    const base = newer ? { ...theirs, id: mine.id } : mine;
    const historyChanged = history.length !== mine.history.length || history.some((h, i) => h !== mine.history[i]);
    if (!newer && !historyChanged) continue;
    list[index] = { ...base, history };
    updated += 1;
  }
  list.sort(byOpenedDesc);
  return { state: prune({ ...state, applications: list }), added, updated };
}
