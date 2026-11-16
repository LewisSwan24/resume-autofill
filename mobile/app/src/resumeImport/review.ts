// The review of what was read, as plain data: its defaults, every change the person makes, and what is derived from it.
// Lives in memory only; nothing here is stored.
import { createResume, MODULES, type ModuleName } from '../../../../src/editor';
import type { TextLine } from '../../../../src/import/extract/types';
import type { Certainty, Draft, DraftField } from '../../../../src/import/parse';
import { titleFromFileName } from '../../../../src/import/parse/clean';
import { ResumeSchema, type Locale, type Profile, type Resume } from '../../../../src/schema';
import { describePath } from './paths';
import type { DetectedLanguage, ImportFile, ImportKind, ImportSource, ReadSuccess } from './types';

export interface ReviewItem {
  /** Draft path as read (`education.1.school`). Unique; the item's id. */
  path: string;
  module: ModuleName;
  entry: number | null;
  /** Current value, edited or not. */
  value: string;
  /** Value as read. */
  read: string;
  certainty: Certainty;
  line: number;
  keep: boolean;
  hidden: boolean;
}

export type ReviewTarget = { kind: 'new'; locale: Locale; title: string } | { kind: 'merge'; resumeId: string };

export interface ReviewState {
  file: { name: string; kind: ImportKind; source: ImportSource; size: number; pages: number; stored?: { fileId: string; resumeId: string } };
  lines: TextLine[];
  items: ReviewItem[];
  /** Entry keys `${module}.${entry}` left out. */
  dropped: string[];
  target: ReviewTarget;
  /** Draft paths whose value replaces a different existing one (merge only). */
  overwrite: string[];
  /** Store the PDF as the target's resume attachment. Always false for Word and for source 'attachment'. */
  attachPdf: boolean;
  language: DetectedLanguage;
  onlyCheck: boolean;
  /** The first state, for isDirty. */
  initial: { items: ReviewItem[]; dropped: string[] };
  /**
   * Not in the pinned shape, and optional: the resumes that already hold a resume PDF when the review opened, so a
   * target switch can work out attachPdf again without the profile.
   */
  resumesWithPdf?: string[];
}

export type ReviewAction =
  | { type: 'edit'; path: string; value: string }
  | { type: 'keep'; path: string; keep: boolean }
  | { type: 'dropEntry'; key: string }
  | { type: 'restoreEntry'; key: string }
  | { type: 'target'; target: ReviewTarget }
  | { type: 'overwrite'; path: string; on: boolean }
  | { type: 'attachPdf'; on: boolean }
  | { type: 'onlyCheck'; on: boolean };

export interface ReviewGroup {
  /** `basics`, or `education.1` for an entry. */
  key: string;
  module: ModuleName;
  entry: number | null;
  /** Visible items only (hidden excluded; onlyCheck applied). */
  items: ReviewItem[];
  dropped: boolean;
}

// ---------------------------------------------------------------- helpers

const entryKey = (item: Pick<ReviewItem, 'module' | 'entry'>): string => (item.entry === null ? item.module : `${item.module}.${item.entry}`);
const MODULE_ORDER = new Map(MODULES.map((m, i) => [m.module, i]));

/** Position of an item within its module, in the editor's field order (then region parts in the order read). */
function fieldOrder(item: ReviewItem): number {
  const info = describePath(item.path);
  if (!info?.field) return Number.MAX_SAFE_INTEGER;
  return info.meta.fields.indexOf(info.field);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** Nothing filled in any module but attachments: what a fresh resume is, apart from who it is and when. */
export function isBlankResume(resume: Resume): boolean {
  const parsed = ResumeSchema.safeParse(resume);
  if (!parsed.success) return false;
  const fresh = createResume({ title: resume.title, locale: resume.locale, id: resume.id, now: resume.createdAt });
  const strip = (r: Resume) => {
    const { attachments: _a, createdAt: _c, updatedAt: _u, linkedResumeId: _l, ...rest } = r;
    // The phone code is set by the language, not by the person.
    return { ...rest, contact: { ...rest.contact, phoneCountryCode: '' } };
  };
  return sameValue(strip(parsed.data), strip(fresh));
}

function defaultAttach(state: Pick<ReviewState, 'file' | 'target' | 'resumesWithPdf'>): boolean {
  if (state.file.kind !== 'pdf' || state.file.source === 'attachment') return false;
  return state.target.kind === 'new' || !(state.resumesWithPdf ?? []).includes(state.target.resumeId);
}

const sameTarget = (a: ReviewTarget, b: ReviewTarget): boolean =>
  a.kind === 'new' ? b.kind === 'new' : b.kind === 'merge' && a.resumeId === b.resumeId;

// ---------------------------------------------------------------- state

export function initReview(read: ReadSuccess, file: ImportFile, profile: Profile | null, defaultTitle: (locale: Locale) => string): ReviewState {
  const items: ReviewItem[] = [];
  for (const f of read.draft.fields) {
    const info = describePath(f.path);
    if (!info) continue;
    items.push({ path: f.path, module: info.module, entry: info.entry, value: f.value, read: f.value, certainty: f.certainty, line: f.line, keep: true, hidden: info.hidden });
  }
  const resumes = profile?.resumes ?? [];
  const exists = (id: string | null | undefined): id is string => !!id && resumes.some((r) => r.id === id);
  const locale = read.language.locale;
  const fresh: ReviewTarget = { kind: 'new', locale, title: titleFromFileName(file.name) || defaultTitle(locale) };
  let target: ReviewTarget = fresh;
  if (file.source === 'attachment') {
    if (exists(file.stored?.resumeId)) target = { kind: 'merge', resumeId: file.stored.resumeId };
  } else {
    const active = resumes.find((r) => r.id === profile?.activeResumeId);
    if (active && isBlankResume(active)) target = { kind: 'merge', resumeId: active.id };
  }
  const state: ReviewState = {
    file: {
      name: file.name,
      kind: read.kind,
      source: file.source,
      size: file.bytes.byteLength,
      pages: read.pages,
      ...(file.stored ? { stored: { ...file.stored } } : {}),
    },
    lines: read.lines,
    items,
    dropped: [],
    target,
    overwrite: [],
    attachPdf: false,
    language: read.language,
    onlyCheck: false,
    initial: { items, dropped: [] },
    resumesWithPdf: resumes.filter((r) => r.attachments.resumeFileId).map((r) => r.id),
  };
  return { ...state, attachPdf: defaultAttach(state) };
}

export function reviewReduce(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'edit':
      return { ...state, items: state.items.map((i) => (i.path === action.path ? { ...i, value: action.value } : i)) };
    case 'keep':
      return { ...state, items: state.items.map((i) => (i.path === action.path ? { ...i, keep: action.keep } : i)) };
    case 'dropEntry':
      return state.dropped.includes(action.key) ? state : { ...state, dropped: [...state.dropped, action.key] };
    case 'restoreEntry':
      return { ...state, dropped: state.dropped.filter((k) => k !== action.key) };
    case 'target': {
      // A choice the person made stays; one that was only the default follows the new target.
      const followDefault = state.attachPdf === defaultAttach(state);
      const next = { ...state, target: action.target, overwrite: sameTarget(state.target, action.target) ? state.overwrite : [] };
      return followDefault ? { ...next, attachPdf: defaultAttach(next) } : next;
    }
    case 'overwrite': {
      const without = state.overwrite.filter((p) => p !== action.path);
      return { ...state, overwrite: action.on ? [...without, action.path] : without };
    }
    case 'attachPdf':
      return { ...state, attachPdf: action.on && state.file.kind === 'pdf' && state.file.source !== 'attachment' };
    case 'onlyCheck':
      return { ...state, onlyCheck: action.on };
  }
}

// ---------------------------------------------------------------- derived

export function groupsOf(state: ReviewState): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const item of state.items) {
    if (item.hidden) continue;
    const key = entryKey(item);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key, module: item.module, entry: item.entry, items: [], dropped: state.dropped.includes(key) }));
    group.items.push(item);
  }
  return [...groups.values()]
    .map((g) => {
      const items = g.items
        .map((item, i) => ({ item, i, order: fieldOrder(item) }))
        .sort((a, b) => a.order - b.order || a.i - b.i)
        .map((x) => x.item);
      return { ...g, items: state.onlyCheck ? items.filter((i) => i.certainty === 'check') : items };
    })
    .filter((g) => g.items.length > 0)
    .sort((a, b) => (MODULE_ORDER.get(a.module) ?? 0) - (MODULE_ORDER.get(b.module) ?? 0) || (a.entry ?? 0) - (b.entry ?? 0));
}

export function summaryOf(state: ReviewState): { recognised: number; toCheck: number; willWrite: number } {
  const visible = state.items.filter((i) => !i.hidden && !state.dropped.includes(entryKey(i)));
  return {
    recognised: visible.length,
    toCheck: visible.filter((i) => i.certainty === 'check' && i.keep).length,
    willWrite: visible.filter((i) => i.keep && i.value.trim() !== '').length,
  };
}

export function isDirty(state: ReviewState): boolean {
  const { items, dropped } = state.initial;
  if (dropped.length !== state.dropped.length || dropped.some((k) => !state.dropped.includes(k))) return true;
  if (items.length !== state.items.length) return true;
  return state.items.some((item, i) => item.value !== items[i]!.value || item.keep !== items[i]!.keep);
}

/** The draft to build from: kept items of kept entries, entries renumbered densely in order, locale from the target. */
export function toDraft(state: ReviewState): { draft: Draft; pathMap: Map<string, string> } {
  const kept = state.items.filter((i) => !state.dropped.includes(entryKey(i)) && (i.hidden || i.keep));
  // An entry goes in only with at least one field the person kept; its hidden fields follow it.
  const entries = new Map<string, number[]>();
  for (const item of kept) {
    if (item.entry === null || item.hidden) continue;
    const list = entries.get(item.module) ?? [];
    if (!list.includes(item.entry)) list.push(item.entry);
    entries.set(item.module, list);
  }
  for (const list of entries.values()) list.sort((a, b) => a - b);
  const fields: DraftField[] = [];
  const pathMap = new Map<string, string>();
  for (const item of kept) {
    let path = item.path;
    if (item.entry !== null) {
      const dense = entries.get(item.module)?.indexOf(item.entry) ?? -1;
      if (dense < 0) continue;
      const [first, , ...rest] = item.path.split('.');
      path = [first, String(dense), ...rest].join('.');
    }
    pathMap.set(item.path, path);
    fields.push({ path, value: item.value, certainty: item.certainty, line: item.line });
  }
  const locale = state.target.kind === 'new' ? state.target.locale : state.language.locale;
  return { draft: { locale, fields }, pathMap };
}
