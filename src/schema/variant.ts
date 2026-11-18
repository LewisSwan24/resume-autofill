// Non-destructive resume variant resolution & materialization.
import { VARIANT_SECTIONS, type Resume, type VariantMeta, type VariantSection } from './resume';

export interface VariantDiffSummary {
  baseResumeId: string;
  baseTitle: string;
  targetRole?: string;
  summaryChanged: boolean;
  hiddenSections: VariantSection[];
  hiddenCounts: Partial<Record<VariantSection, number>>;
}

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

function filterArraySection<T>(
  items: readonly T[],
  hiddenSections: ReadonlySet<VariantSection>,
  section: VariantSection,
  hiddenIndices: readonly number[] | undefined,
): T[] {
  if (hiddenSections.has(section)) return [];
  if (!hiddenIndices || hiddenIndices.length === 0) return items.slice();
  const skip = new Set(hiddenIndices);
  return items.filter((_, index) => !skip.has(index));
}

function applyOverlay(base: Resume, overlay: VariantMeta | undefined, variant: Resume): Resume {
  const hiddenSections = new Set<VariantSection>(overlay?.hiddenSections ?? []);
  const hiddenMap = overlay?.hiddenIndices ?? {};
  const targetSummary = overlay?.customSummary?.trim();
  const skillsFilter =
    overlay?.highlightedSkills && overlay.highlightedSkills.length > 0 && !hiddenSections.has('skills')
      ? new Set(overlay.highlightedSkills.map((s) => s.toLowerCase()))
      : null;

  const baseSkills = filterArraySection(base.skills, hiddenSections, 'skills', hiddenMap.skills);
  const orderedSkills = skillsFilter
    ? [
        ...baseSkills.filter((s) => skillsFilter.has(s.name.toLowerCase())),
        ...baseSkills.filter((s) => !skillsFilter.has(s.name.toLowerCase())),
      ]
    : baseSkills;

  const customPositions =
    overlay?.targetRole && overlay.targetRole.trim()
      ? [overlay.targetRole.trim(), ...base.jobIntention.positions.filter((p) => p !== overlay.targetRole?.trim())]
      : base.jobIntention.positions;

  return {
    ...base,
    id: variant.id,
    title: variant.title,
    locale: variant.locale,
    variantOf: variant.variantOf,
    variantMeta: variant.variantMeta,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
    jobIntention: {
      ...base.jobIntention,
      positions: customPositions,
    },
    selfIntroduction: targetSummary ? targetSummary : variant.selfIntroduction || base.selfIntroduction,
    education: filterArraySection(base.education, hiddenSections, 'education', hiddenMap.education),
    work: filterArraySection(base.work, hiddenSections, 'work', hiddenMap.work),
    projects: filterArraySection(base.projects, hiddenSections, 'projects', hiddenMap.projects),
    campus: filterArraySection(base.campus, hiddenSections, 'campus', hiddenMap.campus),
    awards: filterArraySection(base.awards, hiddenSections, 'awards', hiddenMap.awards),
    languages: filterArraySection(base.languages, hiddenSections, 'languages', hiddenMap.languages),
    certificates: filterArraySection(base.certificates, hiddenSections, 'certificates', hiddenMap.certificates),
    skills: orderedSkills,
    family: filterArraySection(base.family, hiddenSections, 'family', hiddenMap.family),
    referees: filterArraySection(base.referees, hiddenSections, 'referees', hiddenMap.referees),
    customAnswers: variant.customAnswers.length > 0 ? variant.customAnswers : base.customAnswers,
  };
}

/**
 * Materialize a resume into an actionable full view:
 * - If `resume.variantOf` points to a base resume, inherit non-destructively and apply `variantMeta`.
 * - Handles circular references and dangling parent references safely without throwing.
 */
export function materializeResume(resume: Resume, allResumes: readonly Resume[]): Resume {
  if (!resume.variantOf) return resume;
  const byId = new Map(allResumes.map((r) => [r.id, r]));
  const base = resolveBaseChain(resume, byId);
  if (!base) return resume;
  return applyOverlay(base, resume.variantMeta, resume);
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
    const count = overlay?.hiddenIndices?.[section]?.length ?? 0;
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
