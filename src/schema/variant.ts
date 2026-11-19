// Non-destructive resume variant resolution & materialization.
//
// A variant (`variantOf` set) stores only what differs from its base ("variant can override"):
// - scalar fields (basics, contact, work rights, job intention, emergency contact, diversity, self
//   introduction, hobbies): a variant value wins when it is set, i.e. not empty ('', null, []) and not
//   the schema default of an empty resume (so `+86` or `prefer_not_to_say` never override by accident);
// - repeatable sections (VARIANT_SECTIONS and customAnswers): when the variant has entries of its own
//   they replace the base list, otherwise the base list minus the entries hidden in `variantMeta`;
//   a section in `hiddenSections` is empty either way;
// - attachment slots: a slot set on the variant wins;
// - overlay: `customSummary` beats every self introduction, `targetRole` leads the positions,
//   `highlightedSkills` move to the front.
// A variant of a variant stacks: its base is the base's own materialized view.
import {
  ResumeSchema,
  VARIANT_SECTIONS,
  type Profile,
  type Resume,
  type VariantMeta,
  type VariantSection,
} from './resume';

export interface VariantDiffSummary {
  baseResumeId: string;
  baseTitle: string;
  targetRole?: string;
  summaryChanged: boolean;
  hiddenSections: VariantSection[];
  hiddenCounts: Partial<Record<VariantSection, number>>;
}

type Json = Record<string, unknown>;

/** Repeatable lists a variant either replaces whole or inherits. */
const LIST_KEYS = [...VARIANT_SECTIONS, 'customAnswers'] as const;
/** Object/scalar fields merged key by key. */
const MERGED_KEYS = [
  'basics',
  'contact',
  'workRights',
  'jobIntention',
  'emergencyContact',
  'diversity',
  'selfIntroduction',
  'hobbies',
  'attachments',
] as const;

/** An empty resume: a value equal to its default at the same path is "not set". */
const DEFAULTS: Resume = ResumeSchema.parse({ id: '_', title: '', locale: 'zh-CN' });

const isPlainObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function isUnset(value: unknown, defaultValue: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).every((k) => isUnset(value[k], isPlainObject(defaultValue) ? defaultValue[k] : undefined));
  return Object.is(value, defaultValue);
}

function overlayValue(baseValue: unknown, ownValue: unknown, defaultValue: unknown): unknown {
  if (isPlainObject(baseValue) || isPlainObject(ownValue)) {
    const b = isPlainObject(baseValue) ? baseValue : {};
    const o = isPlainObject(ownValue) ? ownValue : {};
    const d = isPlainObject(defaultValue) ? defaultValue : {};
    const out: Json = {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(o)])) {
      const merged = overlayValue(b[key], o[key], d[key]);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }
  return isUnset(ownValue, defaultValue) ? baseValue : ownValue;
}

function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Json)[part];
  }
  return cursor;
}

// ------------------------------------------------------------------ entry ids

const fallbackEntryId = () => `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const newEntryId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : fallbackEntryId();

/** Give every entry of every repeatable section an `id` (entries that have one keep it). */
export function ensureEntryIds(resume: Resume): Resume {
  let changed = false;
  const next = { ...resume } as Json;
  for (const section of VARIANT_SECTIONS) {
    const list = resume[section] as { id?: string }[];
    if (list.every((e) => e.id)) continue;
    changed = true;
    next[section] = list.map((e) => (e.id ? e : { ...e, id: newEntryId() }));
  }
  return changed ? (next as Resume) : resume;
}

/**
 * Turn legacy positional `hiddenIndices` (positions in `view`'s lists) into `hiddenIds`. Every entry
 * of `view` that is referenced must already have an id (see `ensureEntryIds`).
 */
export function hiddenIndicesToIds(meta: VariantMeta, view: Resume): VariantMeta {
  const { hiddenIndices, ...rest } = meta;
  if (!hiddenIndices) return meta;
  const hiddenIds: Record<string, string[]> = { ...(meta.hiddenIds ?? {}) };
  for (const [section, indices] of Object.entries(hiddenIndices)) {
    if (!(VARIANT_SECTIONS as readonly string[]).includes(section)) continue;
    const list = view[section as VariantSection] as { id?: string }[];
    const ids = indices.map((i) => list[i]?.id).filter((id): id is string => !!id);
    if (ids.length > 0) hiddenIds[section] = [...new Set([...(hiddenIds[section] ?? []), ...ids])];
  }
  return Object.keys(hiddenIds).length > 0 ? { ...rest, hiddenIds } : rest;
}

// ------------------------------------------------------------------ chain resolution

function resolveBaseChain(resume: Resume, byId: ReadonlyMap<string, Resume>): Resume | null {
  if (!resume.variantOf) return null;
  const visited = new Set<string>([resume.id]);
  let cursorId: string | undefined = resume.variantOf;
  let resolved: Resume | null = null;
  while (cursorId) {
    if (visited.has(cursorId)) {
      // Break circular inheritance cleanly rather than hanging or throwing during fill/render.
      return resolved;
    }
    visited.add(cursorId);
    const candidate = byId.get(cursorId);
    if (!candidate) return resolved;
    resolved = candidate;
    cursorId = candidate.variantOf;
  }
  return resolved;
}

function filterSection<T>(
  own: readonly T[],
  inherited: readonly T[],
  section: VariantSection,
  overlay: VariantMeta | undefined,
): T[] {
  if (overlay?.hiddenSections?.includes(section)) return [];
  if (own.length > 0) return own.slice();
  const hiddenIds = new Set(overlay?.hiddenIds?.[section] ?? []);
  const hiddenIndices = new Set(overlay?.hiddenIndices?.[section] ?? []);
  if (hiddenIds.size === 0 && hiddenIndices.size === 0) return inherited.slice();
  return inherited.filter((entry, index) => {
    const id = (entry as { id?: string }).id;
    return !(id && hiddenIds.has(id)) && !hiddenIndices.has(index);
  });
}

function applyOverlay(base: Resume, variant: Resume): Resume {
  const overlay = variant.variantMeta;
  const out = { ...base } as Json;
  for (const key of MERGED_KEYS) out[key] = overlayValue(base[key], variant[key], DEFAULTS[key]);
  for (const section of VARIANT_SECTIONS) {
    out[section] = filterSection(variant[section] as unknown[], base[section] as unknown[], section, overlay);
  }
  out.customAnswers = variant.customAnswers.length > 0 ? variant.customAnswers : base.customAnswers;

  const merged = out as Resume;
  const skillsFilter =
    overlay?.highlightedSkills && overlay.highlightedSkills.length > 0 && !overlay.hiddenSections?.includes('skills')
      ? new Set(overlay.highlightedSkills.map((s) => s.toLowerCase()))
      : null;
  const skills = skillsFilter
    ? [
        ...merged.skills.filter((s) => skillsFilter.has(s.name.toLowerCase())),
        ...merged.skills.filter((s) => !skillsFilter.has(s.name.toLowerCase())),
      ]
    : merged.skills;
  const role = overlay?.targetRole?.trim();
  const positions = role
    ? [role, ...merged.jobIntention.positions.filter((p) => p !== role)]
    : merged.jobIntention.positions;
  const targetSummary = overlay?.customSummary?.trim();

  const { linkedResumeId: _baseLink, ...rest } = merged;
  return {
    ...rest,
    ...(variant.linkedResumeId ? { linkedResumeId: variant.linkedResumeId } : {}),
    id: variant.id,
    title: variant.title,
    locale: variant.locale,
    variantOf: variant.variantOf,
    variantMeta: variant.variantMeta,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
    jobIntention: { ...merged.jobIntention, positions },
    selfIntroduction: targetSummary ? targetSummary : merged.selfIntroduction,
    skills,
  };
}

function materializeIn(resume: Resume, byId: ReadonlyMap<string, Resume>, visiting: Set<string>): Resume {
  if (!resume.variantOf) return resume;
  const parent = byId.get(resume.variantOf);
  if (!parent) return resume;
  visiting.add(resume.id);
  // A cycle: treat the parent as a root rather than recursing forever.
  const parentView = visiting.has(parent.id) ? parent : materializeIn(parent, byId, visiting);
  return applyOverlay(parentView, resume);
}

/**
 * Materialize a resume into an actionable full view:
 * - If `resume.variantOf` points to a base resume, inherit non-destructively (rules at the top of the file).
 * - Handles circular references and dangling parent references safely without throwing.
 */
export function materializeResume(resume: Resume, allResumes: readonly Resume[]): Resume {
  if (!resume.variantOf) return resume;
  return materializeIn(resume, new Map(allResumes.map((r) => [r.id, r])), new Set());
}

/** What a variant inherits from: its base's materialized view. Null for a standalone resume or a dangling link. */
export function variantParentView(resume: Resume, allResumes: readonly Resume[]): Resume | null {
  if (!resume.variantOf) return null;
  const byId = new Map(allResumes.map((r) => [r.id, r]));
  const parent = byId.get(resume.variantOf);
  if (!parent || parent.id === resume.id) return null;
  return materializeIn(parent, byId, new Set([resume.id]));
}

/**
 * The base value a variant shows at `path` (e.g. `basics.givenName`, `attachments.resumeFileId`) because it
 * has none of its own. Undefined when the resume is not a variant, has its own value, or the base has none.
 */
export function inheritedValue(resume: Resume, allResumes: readonly Resume[], path: string): unknown {
  const parent = variantParentView(resume, allResumes);
  if (!parent) return undefined;
  if (!isUnset(readPath(resume, path), readPath(DEFAULTS, path))) return undefined;
  const value = readPath(parent, path);
  return isUnset(value, readPath(DEFAULTS, path)) ? undefined : value;
}

/** True when `resume` is a variant holding its own value at `path` (which then beats the base). */
export function isVariantOverride(resume: Resume, path: string): boolean {
  return Boolean(resume.variantOf) && !isUnset(readPath(resume, path), readPath(DEFAULTS, path));
}

/** Drop the variant's own value at `path` (back to the empty default) so the base value shows through again. */
export function clearVariantOverride(resume: Resume, path: string): Resume {
  const parts = path.split('.');
  const clearIn = (source: unknown, depth: number): unknown => {
    const node = isPlainObject(source) ? source : {};
    const key = parts[depth]!;
    if (depth < parts.length - 1) return { ...node, [key]: clearIn(node[key], depth + 1) };
    const fallback = readPath(DEFAULTS, path);
    if (fallback === undefined) {
      const { [key]: _dropped, ...rest } = node;
      return rest;
    }
    return { ...node, [key]: structuredClone(fallback) };
  };
  return clearIn(resume, 0) as Resume;
}

/** The entries a variant shows in `section` while it has none of its own (base list minus hidden ones). */
export function inheritedSection<S extends VariantSection | 'customAnswers'>(
  resume: Resume,
  allResumes: readonly Resume[],
  section: S,
): Resume[S] {
  const parent = variantParentView(resume, allResumes);
  if (!parent || (resume[section] as unknown[]).length > 0) return [] as unknown as Resume[S];
  if (section === 'customAnswers') return parent.customAnswers as Resume[S];
  return filterSection([], parent[section] as unknown[], section as VariantSection, resume.variantMeta) as Resume[S];
}

/**
 * Before `baseId` is deleted: every variant of it becomes a standalone resume holding its materialized
 * view, so its own overrides and everything it inherited survive. Other resumes are returned unchanged.
 */
export function promoteVariantsOf(resumes: readonly Resume[], baseId: string): Resume[] {
  return resumes.map((r) => {
    if (r.variantOf !== baseId || r.id === baseId) return r;
    const { variantOf: _v, ...standalone } = materializeResume(r, resumes);
    return standalone;
  });
}

/**
 * Read-time upgrade: legacy positional `hiddenIndices` become `hiddenIds`, keyed by the ids of the entries
 * they pointed at in the base as it is now (ids are given to those entries where missing).
 */
export function migrateHiddenIndices(profile: Profile): Profile {
  if (!profile.resumes.some((r) => r.variantMeta?.hiddenIndices)) return profile;
  const byId = new Map(profile.resumes.map((r) => [r.id, r]));
  for (const resume of profile.resumes) {
    const meta = resume.variantMeta;
    if (!meta?.hiddenIndices) continue;
    // Legacy indices pointed into the root of the chain.
    const root = resolveBaseChain(resume, byId);
    let nextMeta: VariantMeta;
    if (!root) {
      const { hiddenIndices: _dropped, ...rest } = meta;
      nextMeta = rest;
    } else {
      let updatedRoot = root;
      for (const [section, indices] of Object.entries(meta.hiddenIndices)) {
        if (!(VARIANT_SECTIONS as readonly string[]).includes(section)) continue;
        const list = updatedRoot[section as VariantSection] as { id?: string }[];
        if (!indices.some((i) => list[i] && !list[i]!.id)) continue;
        const wanted = new Set(indices);
        updatedRoot = {
          ...updatedRoot,
          [section]: list.map((e, i) => (wanted.has(i) && !e.id ? { ...e, id: newEntryId() } : e)),
        } as Resume;
      }
      byId.set(root.id, updatedRoot);
      nextMeta = hiddenIndicesToIds(meta, updatedRoot);
    }
    byId.set(resume.id, { ...(byId.get(resume.id) ?? resume), variantMeta: nextMeta });
  }
  return { ...profile, resumes: profile.resumes.map((r) => byId.get(r.id) ?? r) };
}

/** Summarise differences between a variant and its resolved base resume for display in UI. */
export function computeVariantDiff(variant: Resume, allResumes: readonly Resume[]): VariantDiffSummary | null {
  if (!variant.variantOf) return null;
  const byId = new Map(allResumes.map((r) => [r.id, r]));
  const base = resolveBaseChain(variant, byId);
  if (!base) return null;
  const overlay = variant.variantMeta;
  const hiddenSections = (overlay?.hiddenSections ?? []).filter((s): s is VariantSection =>
    (VARIANT_SECTIONS as readonly string[]).includes(s),
  );
  const hiddenCounts: Partial<Record<VariantSection, number>> = {};
  for (const section of VARIANT_SECTIONS) {
    const count = (overlay?.hiddenIds?.[section]?.length ?? 0) + (overlay?.hiddenIndices?.[section]?.length ?? 0);
    if (count > 0) hiddenCounts[section] = count;
  }
  const summaryChanged = Boolean(overlay?.customSummary && overlay.customSummary.trim() !== base.selfIntroduction.trim());
  return {
    baseResumeId: base.id,
    baseTitle: base.title,
    targetRole: overlay?.targetRole,
    summaryChanged,
    hiddenSections,
    hiddenCounts,
  };
}

/** Detect whether linking `candidateParentId` from `resumeId` would create a cycle. */
export function wouldCreateVariantCycle(
  resumeId: string,
  candidateParentId: string,
  allResumes: readonly Resume[],
): boolean {
  if (resumeId === candidateParentId) return true;
  const byId = new Map(allResumes.map((r) => [r.id, r]));
  const seen = new Set<string>([resumeId]);
  let cursor: string | undefined = candidateParentId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.variantOf;
  }
  return false;
}
