// Home's progress summary of a resume: the seven key sections and the eight key details an application form almost
// always asks for, each with the place in the editor where it is filled in. Pure.
import { ATTACHMENT_SLOTS, getByPath, getModule, type ArrayModuleName, type ModuleMeta, type ModuleName } from '../../../../src/editor';
import type { Profile, Resume } from '../../../../src/schema';
import { blankValue, isFilled } from '../fields';
import type { FocusTarget } from '../navigation';
import type { FillLanguage } from '../store/appStateStore';

export const KEY_MODULES: readonly ModuleName[] = ['basics', 'contact', 'education', 'jobIntention', 'work', 'skills', 'attachments'];

export type JumpTarget = Omit<FocusTarget, 'nonce'>;
export interface KeyItem {
  id: string;
  labelKey: string;
  target: JumpTarget;
}

export interface ResumeSummary {
  modules: { module: ModuleName; filled: boolean }[];
  filledCount: number;
  total: number;
  missing: KeyItem[];
}

const blankText = (v: unknown) => typeof v !== 'string' || v.trim() === '';
const blankAny = (v: unknown) => v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : blankText(v));

type Education = Resume['education'][number];

/** "No education entry has this field": the first blank entry (or no entry) is where it gets filled in. */
function educationItem(id: string, field: keyof Education, labelKey: string): (r: Resume) => KeyItem | null {
  return (r) => {
    if (r.education.some((e) => !blankAny(e[field]))) return null;
    const index = r.education.findIndex((e) => blankAny(e[field]));
    return { id, labelKey, target: { module: 'education', entry: index < 0 ? undefined : index, field } };
  };
}

/** The key details, in display order. Each returns the missing item, or null when it is filled. */
const CHECKS: ReadonlyArray<{ id: string; labelKey: string; check: (r: Resume) => KeyItem | null }> = [
  {
    id: 'name',
    labelKey: 'm.home.item.name',
    check: (r) => {
      const field = blankText(r.basics.familyName) ? 'familyName' : blankText(r.basics.givenName) ? 'givenName' : null;
      return field ? { id: 'name', labelKey: 'm.home.item.name', target: { module: 'basics', field } } : null;
    },
  },
  {
    id: 'phone',
    labelKey: 'options.field.phone',
    check: (r) => (blankText(r.contact.phone) ? { id: 'phone', labelKey: 'options.field.phone', target: { module: 'contact', field: 'phone' } } : null),
  },
  {
    id: 'email',
    labelKey: 'options.field.email',
    check: (r) => (blankText(r.contact.email) ? { id: 'email', labelKey: 'options.field.email', target: { module: 'contact', field: 'email' } } : null),
  },
  { id: 'school', labelKey: 'options.field.school', check: educationItem('school', 'school', 'options.field.school') },
  { id: 'degree', labelKey: 'options.field.degree', check: educationItem('degree', 'degree', 'options.field.degree') },
  { id: 'major', labelKey: 'options.field.major', check: educationItem('major', 'major', 'options.field.major') },
  {
    id: 'positions',
    labelKey: 'options.field.positions',
    check: (r) =>
      r.jobIntention.positions.length === 0
        ? { id: 'positions', labelKey: 'options.field.positions', target: { module: 'jobIntention', field: 'positions' } }
        : null,
  },
  {
    id: 'resumePdf',
    labelKey: 'options.attach.resume',
    check: (r) =>
      r.attachments.resumeFileId
        ? null
        : { id: 'resumePdf', labelKey: 'options.attach.resume', target: { module: 'attachments', field: 'resumeFileId' } },
  },
];

/** The key details in display order, with their labels. */
export const KEY_ITEMS: readonly { id: string; labelKey: string }[] = CHECKS.map(({ id, labelKey }) => ({ id, labelKey }));

/** Same rule as the module list's caption: attachments any slot set; lists ≥ 1 entry; else ≥ 1 field filled. */
export function isModuleFilled(meta: ModuleMeta, resume: Resume): boolean {
  if (meta.container === 'attachments') return ATTACHMENT_SLOTS.some((slot) => Boolean(resume.attachments[slot]));
  if (meta.repeatable) return (resume[meta.module as ArrayModuleName] as unknown[]).length > 0;
  const base = meta.container === 'root' ? '' : `${meta.module}.`;
  return meta.fields.some((f) => isFilled(getByPath(resume, `${base}${f.key}`), blankValue(meta, f)));
}

export function summarizeResume(resume: Resume): ResumeSummary {
  const modules = KEY_MODULES.map((module) => ({ module, filled: isModuleFilled(getModule(module), resume) }));
  const missing = CHECKS.map((c) => c.check(resume)).filter((i): i is KeyItem => i !== null);
  return { modules, filledCount: modules.filter((m) => m.filled).length, total: KEY_MODULES.length, missing };
}

const languageOf = (r: Resume): 'zh' | 'en' => (r.locale.startsWith('zh') ? 'zh' : 'en');

/** The resume filling uses, given the stored preference. `fallback`: none in the asked language, so the active one. */
export function resolveFillResume(profile: Profile, pref: FillLanguage): { resume: Resume; fallback: boolean } | null {
  if (profile.resumes.length === 0) return null;
  const active = profile.resumes.find((r) => r.id === profile.activeResumeId) ?? profile.resumes[0]!;
  if (pref === 'active') return { resume: active, fallback: false };
  if (languageOf(active) === pref) return { resume: active, fallback: false };
  const linked = active.linkedResumeId ? profile.resumes.find((r) => r.id === active.linkedResumeId) : undefined;
  if (linked && languageOf(linked) === pref) return { resume: linked, fallback: false };
  const first = profile.resumes.find((r) => languageOf(r) === pref);
  if (first) return { resume: first, fallback: false };
  return { resume: active, fallback: true };
}
