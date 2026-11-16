// What each frame of a page receives when the person taps 「一键填写」: the extension's subset rule
// (buildResumeSubset) per frame, the attachment files its upload controls asked for, and what the report lists as
// handed over. Pure.
import { buildResumeSubset } from '../../../../../src/background/subset';
import { getModule, MODULES, type ModuleName } from '../../../../../src/editor/modules';
import { targetOfField } from '../../../../../src/editor/fieldTarget';
import {
  ATTACHMENT_PROP,
  expandFieldKeys,
  isAttachmentKey,
  isEmptyNeeds,
  sectionModule,
  type AttachmentKey,
  type FrameNeeds,
} from '../../../../../src/engine/fieldDeps';
import { FIELD_KEYS, type SectionKey } from '../../../../../src/schema/fieldKeys';
import type { Profile, Resume } from '../../../../../src/schema/resume';
import { isModuleFilled, resolveFillResume } from '../../home/summary';
import type { FillLanguage } from '../../store/appStateStore';
import type { FileInfo } from '../../store/fileStore';
import { DEMO_ORIGIN } from './constants';
import { sampleFor } from './sampleResume';

export type ResumeChoice = { kind: 'default' } | { kind: 'profile'; resumeId: string } | { kind: 'sample' };

export interface FramePlan {
  frame: number;
  needs: FrameNeeds;
  resume: Resume;
  fileIds: string[];
}

export interface HandedOver {
  fields: { moduleLabelKey: string; labels: string[] }[];
  wholeSections: { section: SectionKey; entries: number }[];
  /** File names. */
  files: string[];
  /** Number of leaves (countLeaves). */
  total: number;
  /** Hosts of other sites than the page that received data (the person agreed to each by name). */
  otherSites: string[];
}

const ALL_ATTACHMENT_KEYS = Object.keys(ATTACHMENT_PROP) as AttachmentKey[];

/**
 * Ids of the files a resume references for the given attachment keys (default: all of them).
 * Copied from src/background/fill.ts (that file imports wxt/browser); follow-up: share it from a pure module.
 */
export function attachmentIds(resume: Resume, keys: readonly AttachmentKey[] = ALL_ATTACHMENT_KEYS): string[] {
  return keys.map((k) => resume.attachments[ATTACHMENT_PROP[k]]).filter((id): id is string => !!id);
}

/** One plan per frame with something to fill, in the map's order. */
export function planFrames(resume: Resume, needsByFrame: ReadonlyMap<number, FrameNeeds>): FramePlan[] {
  const plans: FramePlan[] = [];
  for (const [frame, needs] of needsByFrame) {
    if (isEmptyNeeds(needs)) continue;
    plans.push({
      frame,
      needs,
      resume: buildResumeSubset(resume, needs),
      fileIds: [...new Set(attachmentIds(resume, needs.attachmentKeys))],
    });
  }
  return plans;
}

const moduleKeys = (module: string): string[] => FIELD_KEYS.filter((d) => d.key.startsWith(`${module}.`)).map((d) => d.key);

/**
 * Union of the expanded field keys, the attachment keys and every leaf of each whole repeated section. With the
 * resume known, a whole section counts its leaves once per entry (that is what leaves the app); there are only about
 * 140 field keys, so without entries the LARGE_NEEDS question could never come up.
 */
export function countLeaves(needs: Iterable<FrameNeeds>, resume?: Resume): number {
  const leaves = new Set<string>();
  for (const n of needs) {
    for (const k of expandFieldKeys(n.fieldKeys.filter((k) => !isAttachmentKey(k)))) leaves.add(k);
    for (const k of n.attachmentKeys) leaves.add(k);
    for (const k of n.fieldKeys) if (isAttachmentKey(k)) leaves.add(k);
    for (const section of n.repeatSections) {
      const m = sectionModule(section);
      if (!m) continue;
      const entries = resume ? Math.max(1, (resume[m] as unknown[]).length) : 1;
      for (const k of moduleKeys(m)) for (let i = 0; i < entries; i++) leaves.add(`${k}#${i}`);
    }
  }
  // A key requested on its own and also inside a whole section counts once (as the section's first entry).
  for (const k of [...leaves]) if (!k.includes('#') && leaves.has(`${k}#0`)) leaves.delete(k);
  return leaves.size;
}

/** i18n keys of a field key's module and label (src/i18n `options.*`); unknown keys keep the key as label. */
function labelsOf(key: string): { moduleLabelKey: string; labelKey: string } {
  const head = key.slice(0, key.indexOf('.'));
  const target = targetOfField(key);
  if (target) {
    const meta = getModule(target.module);
    const field = meta.fields.find((f) => f.key === target.field);
    if (field) return { moduleLabelKey: meta.labelKey, labelKey: field.labelKey };
  }
  const moduleName = (head === 'misc' ? 'about' : head) as ModuleName;
  const meta = MODULES.find((m) => m.module === moduleName);
  return { moduleLabelKey: meta?.labelKey ?? `options.module.${moduleName}`, labelKey: key };
}

/** What the report lists under 「这次交给网页的内容」. */
export function handedOver(resume: Resume, plans: readonly FramePlan[], files: Readonly<Record<string, FileInfo>>): HandedOver {
  const sections = new Map<SectionKey, number>();
  const wholeModules = new Set<string>();
  for (const plan of plans) {
    for (const section of plan.needs.repeatSections) {
      const m = sectionModule(section);
      if (!m || sections.has(section)) continue;
      wholeModules.add(m);
      const entries = (resume[m] as unknown[]).length;
      if (entries > 0) sections.set(section, entries);
    }
  }

  const byModule = new Map<string, string[]>();
  for (const plan of plans) {
    const keys = expandFieldKeys(plan.needs.fieldKeys.filter((k) => !isAttachmentKey(k)));
    for (const key of keys) {
      if (key === 'basics.idNumber') continue; // never handed over (buildResumeSubset blanks it)
      if (wholeModules.has(key.slice(0, key.indexOf('.')))) continue;
      const { moduleLabelKey, labelKey } = labelsOf(key);
      const labels = byModule.get(moduleLabelKey) ?? [];
      if (!labels.includes(labelKey)) labels.push(labelKey);
      byModule.set(moduleLabelKey, labels);
    }
  }

  const fileNames: string[] = [];
  for (const id of new Set(plans.flatMap((p) => p.fileIds))) {
    const info = files[id];
    if (info && !fileNames.includes(info.name)) fileNames.push(info.name);
  }

  return {
    fields: [...byModule].map(([moduleLabelKey, labels]) => ({ moduleLabelKey, labels })),
    wholeSections: [...sections].map(([section, entries]) => ({ section, entries })),
    files: fileNames,
    total: countLeaves(plans.map((p) => p.needs), resume),
    otherSites: [],
  };
}

/** A resume with at least one filled module (the same rule as the profile page's captions). */
const hasContent = (resume: Resume): boolean => MODULES.some((meta) => isModuleFilled(meta, resume));

/**
 * The resume a fill uses. The made-up sample is returned only on DEMO_ORIGIN (where it is also the default); on any
 * other origin a `sample` choice falls back to the profile default. Never mixes resumes.
 */
export function pickResume(
  origin: string,
  choice: ResumeChoice,
  profile: Profile | null,
  pref: FillLanguage,
): { resume: Resume; sample: boolean; fallback: boolean } | { empty: true } {
  const demo = origin === DEMO_ORIGIN;
  if (demo && (choice.kind === 'sample' || choice.kind === 'default')) {
    return { resume: sampleFor(pref), sample: true, fallback: false };
  }
  if (choice.kind === 'profile' && profile) {
    const chosen = profile.resumes.find((r) => r.id === choice.resumeId);
    if (chosen) return hasContent(chosen) ? { resume: chosen, sample: false, fallback: false } : { empty: true };
  }
  if (!profile) return { empty: true };
  const resolved = resolveFillResume(profile, pref);
  if (!resolved || !hasContent(resolved.resume)) return { empty: true };
  return { resume: resolved.resume, sample: false, fallback: resolved.fallback };
}
