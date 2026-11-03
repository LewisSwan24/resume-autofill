// Pure, immutable edits of resumes and profiles. Nothing here touches storage or the DOM.
import {
  ResumeSchema,
  type Locale,
  type Profile,
  type Resume,
} from '../schema';
import { newEntry, type ArrayModuleName, type EntryOf } from './modules';

// ------------------------------------------------------------------ paths

export type PathSegment = string | number;

/** `a.b[0].c` / `a.b.0.c` → `['a','b',0,'c']`. */
export function parsePath(path: string | readonly PathSegment[]): PathSegment[] {
  if (typeof path !== 'string') return [...path];
  return path
    .split(/[.[\]]/)
    .filter((s) => s !== '')
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

export function getByPath(source: unknown, path: string | readonly PathSegment[]): unknown {
  let node: unknown = source;
  for (const seg of parsePath(path)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<PathSegment, unknown>)[seg];
  }
  return node;
}

/**
 * Return a copy of `source` with `value` at `path`. Containers along the path are cloned (arrays stay
 * arrays), missing ones are created (arrays for numeric segments, objects otherwise); `source` is never mutated.
 */
export function setByPath<T>(source: T, path: string | readonly PathSegment[], value: unknown): T {
  const segments = parsePath(path);
  if (segments.length === 0) return value as T;
  const [head, ...rest] = segments as [PathSegment, ...PathSegment[]];
  const base: unknown = source;
  const container: Record<PathSegment, unknown> | unknown[] = Array.isArray(base)
    ? [...base]
    : typeof base === 'object' && base !== null
      ? { ...(base as Record<string, unknown>) }
      : typeof head === 'number'
        ? []
        : {};
  const child = (container as Record<PathSegment, unknown>)[head];
  (container as Record<PathSegment, unknown>)[head] = rest.length === 0 ? value : setByPath(child, rest, value);
  return container as T;
}

// ------------------------------------------------------------------ repeatable entries

function withList<M extends ArrayModuleName>(
  resume: Resume,
  module: M,
  edit: (list: EntryOf<M>[]) => EntryOf<M>[],
): Resume {
  const list = resume[module] as EntryOf<M>[];
  return { ...resume, [module]: edit([...list]) } as Resume;
}

/** Append a new (default) entry, or the given one. */
export function addEntry<M extends ArrayModuleName>(resume: Resume, module: M, entry?: EntryOf<M>): Resume {
  return withList(resume, module, (list) => [...list, entry ?? newEntry(module)]);
}

/** Remove entry `index`; out-of-range indexes leave the resume unchanged. */
export function removeEntry(resume: Resume, module: ArrayModuleName, index: number): Resume {
  const list = resume[module] as unknown[];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return resume;
  return withList(resume, module, (l) => l.filter((_, i) => i !== index));
}

/** Move entry `index` by `delta` (−1 up, +1 down). Moves that fall off either end are no-ops. */
export function moveEntry(resume: Resume, module: ArrayModuleName, index: number, delta: -1 | 1): Resume {
  const list = resume[module] as unknown[];
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return resume;
  return withList(resume, module, (l) => {
    const copy = [...l];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item!);
    return copy;
  });
}

// ------------------------------------------------------------------ "至今 / Present"

/**
 * Toggle the "Present" checkbox of an entry that has `endDate` + `current`.
 * Checked → `endDate = null, current = true`. Unchecked → `current = false, endDate = ''`.
 */
export function toggleCurrent<T extends { endDate: string | null; current: boolean }>(entry: T, checked: boolean): T {
  return checked ? { ...entry, current: true, endDate: null } : { ...entry, current: false, endDate: entry.endDate ?? '' };
}

/** Set an end date; choosing a real date clears the "Present" flag. */
export function setEndDate<T extends { endDate: string | null; current: boolean }>(entry: T, value: string): T {
  return { ...entry, endDate: value, current: false };
}

// ------------------------------------------------------------------ resumes in a profile

const fallbackId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const newResumeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : fallbackId();

/** A new empty resume. `en-AU` resumes default to the +61 phone code. */
export function createResume(input: { title: string; locale: Locale; id?: string; now?: number }): Resume {
  const now = input.now ?? Date.now();
  const resume = ResumeSchema.parse({
    id: input.id ?? newResumeId(),
    title: input.title,
    locale: input.locale,
    createdAt: now,
    updatedAt: now,
  });
  return input.locale === 'en-AU' ? { ...resume, contact: { ...resume.contact, phoneCountryCode: '+61' } } : resume;
}

/** Deep copy with a new id and title; the link to another resume and timestamps are reset. */
export function duplicateResume(source: Resume, input: { title: string; id?: string; now?: number }): Resume {
  const now = input.now ?? Date.now();
  const { linkedResumeId: _link, ...rest } = structuredClone(source);
  return { ...rest, id: input.id ?? newResumeId(), title: input.title, createdAt: now, updatedAt: now };
}

export function addResume(profile: Profile, resume: Resume, options: { activate?: boolean } = {}): Profile {
  return {
    ...profile,
    resumes: [...profile.resumes, resume],
    activeResumeId: options.activate || profile.activeResumeId === null ? resume.id : profile.activeResumeId,
  };
}

/** Replace the resume with this id by `edit(resume)`. Unknown ids leave the profile unchanged. */
export function updateResume(profile: Profile, id: string, edit: (resume: Resume) => Resume): Profile {
  if (!profile.resumes.some((r) => r.id === id)) return profile;
  return { ...profile, resumes: profile.resumes.map((r) => (r.id === id ? edit(r) : r)) };
}

/** Remove a resume, drop links pointing at it and move `activeResumeId` to the first remaining one. */
export function removeResume(profile: Profile, id: string): Profile {
  if (!profile.resumes.some((r) => r.id === id)) return profile;
  const resumes = profile.resumes
    .filter((r) => r.id !== id)
    .map((r) => {
      if (r.linkedResumeId !== id) return r;
      const { linkedResumeId: _link, ...rest } = r;
      return rest;
    });
  const activeResumeId = profile.activeResumeId === id ? (resumes[0]?.id ?? null) : profile.activeResumeId;
  return { ...profile, resumes, activeResumeId };
}

export function setActive(profile: Profile, id: string): Profile {
  return profile.resumes.some((r) => r.id === id) ? { ...profile, activeResumeId: id } : profile;
}

/** Link `id` to another resume (`null` clears the link). Self-links and unknown targets are ignored. */
export function setLinkedResume(profile: Profile, id: string, linkedId: string | null): Profile {
  if (linkedId !== null && (linkedId === id || !profile.resumes.some((r) => r.id === linkedId))) return profile;
  return updateResume(profile, id, (r) => {
    const { linkedResumeId: _link, ...rest } = r;
    return linkedId === null ? rest : { ...rest, linkedResumeId: linkedId };
  });
}

// ------------------------------------------------------------------ attachments

export const ATTACHMENT_SLOTS = ['resumeFileId', 'photoFileId', 'transcriptFileId'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];

/** Set (string) or clear (`null`) an attachment id. */
export function setAttachment(resume: Resume, slot: AttachmentSlot, fileId: string | null): Resume {
  const { [slot]: _old, ...rest } = resume.attachments;
  return { ...resume, attachments: fileId === null ? rest : { ...rest, [slot]: fileId } };
}

/** Every attachment file id referenced by any resume in the profile. */
export function referencedFileIds(profile: Profile): Set<string> {
  const ids = new Set<string>();
  for (const r of profile.resumes) {
    for (const slot of ATTACHMENT_SLOTS) {
      const id = r.attachments[slot];
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Drop attachment ids that are not in `existing` (e.g. after importing a JSON exported elsewhere). */
export function pruneMissingAttachments(profile: Profile, existing: ReadonlySet<string>): Profile {
  return {
    ...profile,
    resumes: profile.resumes.map((r) => {
      let next = r;
      for (const slot of ATTACHMENT_SLOTS) {
        const id = r.attachments[slot];
        if (id && !existing.has(id)) next = setAttachment(next, slot, null);
      }
      return next;
    }),
  };
}
