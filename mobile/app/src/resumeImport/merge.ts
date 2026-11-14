// The reviewed draft into the profile: as a new resume, or merged into an existing one, filling only what is empty
// unless the person chose to replace a value. And the way back.
import {
  addResume,
  getByPath,
  MODULES,
  removeResume,
  setActive,
  setAttachment,
  setByPath,
  updateResume,
  type ArrayModuleName,
  type ModuleMeta,
} from '../../../../src/editor';
import { toSimplified } from '../../../../src/dictionary/normalize';
import { draftToResume, refusedPaths } from '../../../../src/import/draft';
import type { Draft, DraftField } from '../../../../src/import/parse';
import { ResumeSchema, type Locale, type Profile, type Resume } from '../../../../src/schema';
import { describePath } from './paths';
import { toDraft, type ReviewState } from './review';

export type ChangeKind = 'fill' | 'same' | 'conflict';
export interface PlannedChange {
  /** Draft path (the review's item id). */
  path: string;
  /** Path in the target resume. */
  target: string;
  kind: ChangeKind;
  incoming: string;
  existing: string;
}
export interface PlannedEntry {
  key: string; // draft entry key, e.g. 'work.0'
  module: ArrayModuleName;
  /** Index of the existing entry it merges into, or null when it is appended. */
  matchIndex: number | null;
  /** entrySummary of the matched entry, for 合并到已有的「…」. */
  matchLabel: string;
}
export interface MergePlan {
  changes: PlannedChange[];
  entries: PlannedEntry[];
  counts: { fill: number; overwrite: number; keepExisting: number; same: number; added: number };
  /** Values that will be written: fill + overwrite + every non-empty field of appended entries. */
  willWrite: number;
}

export type BuildResult =
  | { ok: true; profile: Profile; resumeId: string; before: Resume | null; previousActiveId: string | null }
  | { ok: false; refused: string[]; problem?: 'invalid' | 'target_gone' };

/** What makes two entries the same one: the school, the company, the project, the skill. */
const MATCH_KEY: Partial<Record<ArrayModuleName, string>> = { education: 'school', work: 'company', projects: 'name', skills: 'name' };
const HIDDEN = new Set(['current', 'kind']);

// ---------------------------------------------------------------- values

const asText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(asText).join(', ');
  return String(v);
};
const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const normal = (v: unknown): string => toSimplified(asText(v).trim().replace(/\s+/g, ' ')).toLowerCase();

/** First filled text field of an entry, as its card shows it (the same rule as ModuleScreen's entrySummary). */
function entrySummary(meta: ModuleMeta, entry: Record<string, unknown>): string {
  for (const field of meta.fields) {
    const v = entry[field.key];
    if (field.input === 'text' && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// ---------------------------------------------------------------- the incoming resume

interface IncomingField {
  /** Path as read: the review item's id. */
  path: string;
  /** Path in the incoming resume. */
  at: string;
  module: string;
  /** Entry index in the incoming resume, or null. */
  entry: number | null;
  /** The rest of the path inside its module or entry (`school`, `address.city`). */
  key: string;
  hidden: boolean;
  value: unknown;
}

interface Incoming {
  draft: Draft;
  /** Refused values, by path as read. */
  refused: string[];
  resume: Resume;
  fields: IncomingField[];
}

/**
 * The draft as the schema takes it: refused values out, entries left with nothing numbered away, and every value read
 * back from the built resume so dates and choices are in their stored form.
 */
function incomingOf(state: ReviewState, identity: { id: string; title: string; now?: number }): Incoming {
  const { draft, pathMap } = toDraft(state);
  const original = new Map([...pathMap].map(([from, to]) => [to, from]));
  const refusedDense = new Set(refusedPaths(draft, identity));
  const refused = [...refusedDense].map((p) => original.get(p) ?? p);

  const usable = draft.fields.filter((f) => f.value.trim() !== '' && !refusedDense.has(f.path));
  // Renumber once more: an entry whose visible values were all refused or empty is not an entry.
  const alive = new Map<string, number[]>();
  for (const f of usable) {
    const [module, index, last] = [f.path.split('.')[0]!, f.path.split('.')[1], f.path.split('.').pop()!];
    if (!/^\d+$/.test(index ?? '') || HIDDEN.has(last)) continue;
    const list = alive.get(module) ?? [];
    if (!list.includes(Number(index))) list.push(Number(index));
    alive.set(module, list);
  }
  for (const list of alive.values()) list.sort((a, b) => a - b);

  const kept: DraftField[] = [];
  const meta: Omit<IncomingField, 'value'>[] = [];
  for (const f of usable) {
    const parts = f.path.split('.');
    const info = describePath(f.path);
    let at = f.path;
    let entry: number | null = null;
    let key = parts.slice(1).join('.');
    if (info?.entry !== null && info?.entry !== undefined) {
      entry = alive.get(parts[0]!)?.indexOf(Number(parts[1])) ?? -1;
      if (entry < 0) continue;
      at = [parts[0], String(entry), ...parts.slice(2)].join('.');
      key = parts.slice(2).join('.');
    } else if (info?.module === 'about') {
      key = f.path;
    }
    kept.push({ ...f, path: at });
    meta.push({ path: original.get(f.path) ?? f.path, at, module: info?.module ?? parts[0]!, entry, key, hidden: info?.hidden ?? false });
  }
  const finalDraft: Draft = { locale: draft.locale, fields: kept };
  const resume = draftToResume(finalDraft, identity);
  return { draft, refused, resume, fields: meta.map((m) => ({ ...m, value: getByPath(resume, m.at) })) };
}

// ---------------------------------------------------------------- the plan

interface InternalPlan extends MergePlan {
  /** Writes in order: path in the target and the value, typed as stored. */
  writes: { target: string; value: unknown }[];
  /** Entries to append, whole, as the schema built them. */
  appended: { module: ArrayModuleName; entry: unknown }[];
}

function compare(path: string, target: string, incoming: unknown, existing: unknown): PlannedChange {
  const kind: ChangeKind = isEmptyValue(existing) ? 'fill' : normal(existing) === normal(incoming) ? 'same' : 'conflict';
  return { path, target, kind, incoming: asText(incoming), existing: asText(existing) };
}

function plan(state: ReviewState, target: Resume, incoming: Incoming): InternalPlan {
  const changes: PlannedChange[] = [];
  const entries: PlannedEntry[] = [];
  const writes: InternalPlan['writes'] = [];
  const appended: InternalPlan['appended'] = [];
  let appendedValues = 0;
  const written = (c: PlannedChange): boolean => c.kind === 'fill' || (c.kind === 'conflict' && state.overwrite.includes(c.path));
  const record = (c: PlannedChange, value: unknown): void => {
    changes.push(c);
    if (written(c)) writes.push({ target: c.target, value });
  };

  // Root fields and object modules.
  for (const f of incoming.fields) {
    if (f.entry !== null || f.hidden) continue;
    record(compare(f.path, f.at, f.value, getByPath(target, f.at)), f.value);
  }

  // Entries, in the order they were read.
  const groups = new Map<string, IncomingField[]>();
  for (const f of incoming.fields) {
    if (f.entry === null) continue;
    const k = `${f.module}.${f.entry}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const used = new Map<string, Set<number>>();
  for (const fields of groups.values()) {
    const first = fields[0]!;
    const module = first.module as ArrayModuleName;
    const meta = MODULES.find((m) => m.module === module)!;
    const key = first.path.split('.').slice(0, 2).join('.');
    const entry = (incoming.resume[module] as unknown[])[first.entry!] as Record<string, unknown>;
    const existingList = (target[module] as unknown[]).map((e) => e as Record<string, unknown>);
    const taken = used.get(module) ?? new Set<number>();
    used.set(module, taken);
    const matchKey = MATCH_KEY[module];
    let matchIndex: number | null = null;
    if (matchKey && !isEmptyValue(entry[matchKey])) {
      const found = existingList.findIndex((e, i) => {
        if (taken.has(i) || normal(e[matchKey]) !== normal(entry[matchKey])) return false;
        // The same place at another time is another entry.
        return isEmptyValue(e.startDate) || isEmptyValue(entry.startDate) || normal(e.startDate) === normal(entry.startDate);
      });
      if (found >= 0) matchIndex = found;
    }
    if (matchIndex === null) {
      entries.push({ key, module, matchIndex: null, matchLabel: '' });
      appended.push({ module, entry });
      appendedValues += fields.filter((f) => !f.hidden && !isEmptyValue(f.value)).length;
      continue;
    }
    taken.add(matchIndex);
    entries.push({ key, module, matchIndex, matchLabel: entrySummary(meta, existingList[matchIndex]!) });
    let endDateWritten = false;
    for (const f of fields) {
      if (f.hidden) continue;
      const at = `${module}.${matchIndex}.${f.key}`;
      const c = compare(f.path, at, f.value, getByPath(target, at));
      record(c, f.value);
      if (f.key === 'endDate' && written(c)) endDateWritten = true;
    }
    // Whether a job is current, and its kind, go with its end date.
    if (endDateWritten) {
      for (const f of fields) if (f.hidden) writes.push({ target: `${module}.${matchIndex}.${f.key}`, value: f.value });
    }
  }

  const counts = {
    fill: changes.filter((c) => c.kind === 'fill').length,
    overwrite: changes.filter((c) => c.kind === 'conflict' && state.overwrite.includes(c.path)).length,
    keepExisting: changes.filter((c) => c.kind === 'conflict' && !state.overwrite.includes(c.path)).length,
    same: changes.filter((c) => c.kind === 'same').length,
    added: entries.filter((e) => e.matchIndex === null).length,
  };
  return { changes, entries, counts, willWrite: counts.fill + counts.overwrite + appendedValues, writes, appended };
}

export function planMerge(state: ReviewState, target: Resume): MergePlan {
  const { changes, entries, counts, willWrite } = plan(state, target, incomingOf(state, { id: target.id, title: target.title }));
  return { changes, entries, counts, willWrite };
}

// ---------------------------------------------------------------- building

export function buildImport(
  state: ReviewState,
  profile: Profile,
  options: { newId: () => string; now: number; attachmentId: string | null; defaultTitle: (l: Locale) => string },
): BuildResult {
  const previousActiveId = profile.activeResumeId ?? null;

  if (state.target.kind === 'new') {
    const id = options.newId();
    const title = state.target.title.trim() || options.defaultTitle(state.target.locale);
    const { draft, pathMap } = toDraft(state);
    const original = new Map([...pathMap].map(([from, to]) => [to, from]));
    const refused = refusedPaths(draft, { id, title }).map((p) => original.get(p) ?? p);
    if (refused.length > 0) return { ok: false, refused };
    let resume = draftToResume(draft, { id, title, now: options.now });
    if (options.attachmentId) resume = setAttachment(resume, 'resumeFileId', options.attachmentId);
    // Only the resume built here is checked: another one may hold a value the editor keeps on screen while it saves a
    // repaired copy, and that is not this import's to refuse.
    if (!ResumeSchema.safeParse(resume).success) return { ok: false, refused: [], problem: 'invalid' };
    const next = addResume(profile, resume, { activate: true });
    return { ok: true, profile: next, resumeId: id, before: null, previousActiveId };
  }

  const targetId = state.target.resumeId;
  const target = profile.resumes.find((r) => r.id === targetId);
  if (!target) return { ok: false, refused: [], problem: 'target_gone' };
  const incoming = incomingOf(state, { id: target.id, title: target.title, now: options.now });
  if (incoming.refused.length > 0) return { ok: false, refused: incoming.refused };
  const p = plan(state, target, incoming);
  let merged: Resume = structuredClone(target);
  for (const w of p.writes) merged = setByPath(merged, w.target, w.value);
  for (const a of p.appended) merged = { ...merged, [a.module]: [...(merged[a.module] as unknown[]), a.entry] } as Resume;
  const parsed = ResumeSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, refused: [], problem: 'invalid' };
  merged = parsed.data;
  if (options.attachmentId) merged = setAttachment(merged, 'resumeFileId', options.attachmentId);
  merged = { ...merged, updatedAt: options.now };
  if (!ResumeSchema.safeParse(merged).success) return { ok: false, refused: [], problem: 'invalid' };
  const done = merged;
  const next = setActive(updateResume(profile, targetId, () => done), targetId);
  return { ok: true, profile: next, resumeId: targetId, before: target, previousActiveId };
}

export function undoImport(profile: Profile, done: { resumeId: string; before: Resume | null; previousActiveId: string | null }): Profile {
  const before = done.before;
  const restored = before === null ? removeResume(profile, done.resumeId) : updateResume(profile, done.resumeId, () => before);
  return done.previousActiveId ? setActive(restored, done.previousActiveId) : restored;
}
