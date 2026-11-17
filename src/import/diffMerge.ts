// Field-level and section-level 3-way diff merge between an existing resume and a newly imported draft.
import { ResumeSchema, type Resume } from '../schema';

export type ScalarMergeDecision = 'keep_existing' | 'use_incoming';
export type ArrayMergeDecision = 'keep_existing' | 'append_new' | 'replace_with_incoming';

export interface ScalarFieldDiff {
  id: string;
  label: string;
  existingValue: string;
  incomingValue: string;
  kind: 'same' | 'added' | 'changed' | 'missing_incoming';
  defaultDecision: ScalarMergeDecision;
}

export type MergeArraySection =
  | 'education'
  | 'work'
  | 'projects'
  | 'campus'
  | 'awards'
  | 'languages'
  | 'certificates'
  | 'skills'
  | 'customAnswers';

export interface ArraySectionDiff {
  section: MergeArraySection;
  existingCount: number;
  incomingCount: number;
  newItemCount: number;
  defaultDecision: ArrayMergeDecision;
}

export interface ResumeDiffPlan {
  scalars: ScalarFieldDiff[];
  arrays: ArraySectionDiff[];
}

interface ScalarSpec {
  id: string;
  label: string;
  get: (r: Resume) => string;
  set: (r: Resume, v: string) => void;
}

const SCALAR_SPECS: readonly ScalarSpec[] = [
  { id: 'basics.familyName', label: '姓 / Family Name', get: (r) => r.basics.familyName, set: (r, v) => { r.basics.familyName = v; } },
  { id: 'basics.givenName', label: '名 / Given Name', get: (r) => r.basics.givenName, set: (r, v) => { r.basics.givenName = v; } },
  { id: 'contact.email', label: '邮箱 / Email', get: (r) => r.contact.email, set: (r, v) => { r.contact.email = v; } },
  { id: 'contact.phone', label: '手机号 / Phone', get: (r) => r.contact.phone, set: (r, v) => { r.contact.phone = v; } },
  { id: 'contact.linkedin', label: 'LinkedIn', get: (r) => r.contact.linkedin, set: (r, v) => { r.contact.linkedin = v; } },
  { id: 'contact.github', label: 'GitHub', get: (r) => r.contact.github, set: (r, v) => { r.contact.github = v; } },
  { id: 'contact.address.city', label: '城市 / City', get: (r) => r.contact.address.city, set: (r, v) => { r.contact.address.city = v; } },
  { id: 'selfIntroduction', label: '个人简介 / Summary', get: (r) => r.selfIntroduction, set: (r, v) => { r.selfIntroduction = v; } },
];

const ARRAY_SECTIONS: readonly MergeArraySection[] = [
  'education',
  'work',
  'projects',
  'campus',
  'awards',
  'languages',
  'certificates',
  'skills',
  'customAnswers',
];

function itemSignature(section: MergeArraySection, item: unknown): string {
  if (typeof item !== 'object' || item === null) return String(item);
  const r = item as Record<string, unknown>;
  switch (section) {
    case 'education':
      return `${String(r.school ?? '').toLowerCase()}|${String(r.major ?? '').toLowerCase()}`;
    case 'work':
      return `${String(r.company ?? '').toLowerCase()}|${String(r.position ?? '').toLowerCase()}|${String(r.startDate ?? '')}`;
    case 'projects':
      return `${String(r.name ?? '').toLowerCase()}|${String(r.role ?? '').toLowerCase()}`;
    case 'skills':
      return String(r.name ?? '').trim().toLowerCase();
    case 'customAnswers':
      return String(r.question ?? '').trim().toLowerCase();
    default:
      return JSON.stringify(r).toLowerCase();
  }
}

export function buildResumeDiffPlan(existing: Resume, incoming: Resume): ResumeDiffPlan {
  const scalars: ScalarFieldDiff[] = SCALAR_SPECS.map((spec) => {
    const existingValue = spec.get(existing).trim();
    const incomingValue = spec.get(incoming).trim();
    let kind: ScalarFieldDiff['kind'];
    if (existingValue === incomingValue) kind = 'same';
    else if (!existingValue && incomingValue) kind = 'added';
    else if (existingValue && !incomingValue) kind = 'missing_incoming';
    else kind = 'changed';
    return {
      id: spec.id,
      label: spec.label,
      existingValue,
      incomingValue,
      kind,
      defaultDecision: kind === 'added' ? 'use_incoming' : 'keep_existing',
    };
  });

  const arrays: ArraySectionDiff[] = ARRAY_SECTIONS.map((section) => {
    const existArr = existing[section] as readonly unknown[];
    const incArr = incoming[section] as readonly unknown[];
    const seen = new Set(existArr.map((it) => itemSignature(section, it)));
    const newItems = incArr.filter((it) => !seen.has(itemSignature(section, it)));
    const defaultDecision: ArrayMergeDecision =
      incArr.length === 0 ? 'keep_existing' : newItems.length > 0 ? 'append_new' : 'keep_existing';
    return {
      section,
      existingCount: existArr.length,
      incomingCount: incArr.length,
      newItemCount: newItems.length,
      defaultDecision,
    };
  });

  return { scalars, arrays };
}

export function applyDiffMergeDecisions(
  existing: Resume,
  incoming: Resume,
  scalarDecisions: Partial<Record<string, ScalarMergeDecision>> = {},
  arrayDecisions: Partial<Record<MergeArraySection, ArrayMergeDecision>> = {},
): Resume {
  const plan = buildResumeDiffPlan(existing, incoming);
  const out = structuredClone(existing);

  for (const s of plan.scalars) {
    const decision = scalarDecisions[s.id] ?? s.defaultDecision;
    if (decision === 'use_incoming' && s.incomingValue) {
      const spec = SCALAR_SPECS.find((sp) => sp.id === s.id);
      spec?.set(out, s.incomingValue);
    }
  }

  for (const a of plan.arrays) {
    const decision = arrayDecisions[a.section] ?? a.defaultDecision;
    if (decision === 'keep_existing') continue;
    const existArr = out[a.section] as unknown[];
    const incArr = incoming[a.section] as readonly unknown[];
    if (decision === 'replace_with_incoming') {
      (out as Record<string, unknown>)[a.section] = structuredClone(incArr);
      continue;
    }
    // append_new: only append items whose normalized signature is absent from existing list.
    const seen = new Set(existArr.map((it) => itemSignature(a.section, it)));
    const merged = [...existArr];
    for (const it of incArr) {
      const sig = itemSignature(a.section, it);
      if (!seen.has(sig)) {
        seen.add(sig);
        merged.push(structuredClone(it));
      }
    }
    (out as Record<string, unknown>)[a.section] = merged;
  }

  return ResumeSchema.parse(out);
}
