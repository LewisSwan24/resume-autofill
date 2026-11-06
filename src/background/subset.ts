// Data minimisation: the resume a frame receives. `buildResumeSubset` copies from the real resume only the
// leaves a frame's `FrameNeeds` imply; everything else is the schema default / empty value.
//
// Granularity (chosen on purpose):
//  - single modules (basics, contact, ...): per leaf — exactly the requested keys plus the leaves their
//    values are computed from (FIELD_DEPS);
//  - repeated sections the frame has (`needs.repeatSections`): per MODULE — every leaf of every entry, so
//    cards added during the fill (which may expose fields the first card did not) can still be filled;
//  - an array module that only appears through requested keys (no section recognised): all entries
//    (card alignment needs the count) but only the requested leaves + alignment leaves;
//  - attachments: only the file ids of the requested attachment keys.
// Never copied: title, linkedResumeId, customAnswers, timestamps, any module nothing asked for.
import {
  ATTACHMENT_PROP,
  ENTRY_ALIGNMENT_FIELDS,
  expandFieldKeys,
  isArrayModuleName,
  isAttachmentKey,
  sectionModule,
  ARRAY_MODULE_NAMES,
  type ArrayModuleName,
  type FrameNeeds,
} from '../engine/fieldDeps';
import {
  AwardSchema,
  CampusEntrySchema,
  CertificateSchema,
  EducationSchema,
  FamilyMemberSchema,
  LanguageEntrySchema,
  ProjectSchema,
  RefereeSchema,
  ResumeSchema,
  SkillSchema,
  WorkEntrySchema,
  type Resume,
} from '../schema';

type Bag = Record<string, unknown>;

const ENTRY_SCHEMAS: Record<ArrayModuleName, { parse(input: unknown): unknown }> = {
  education: EducationSchema,
  work: WorkEntrySchema,
  projects: ProjectSchema,
  campus: CampusEntrySchema,
  awards: AwardSchema,
  languages: LanguageEntrySchema,
  certificates: CertificateSchema,
  skills: SkillSchema,
  family: FamilyMemberSchema,
  referees: RefereeSchema,
};

const SINGLE_MODULES = ['basics', 'contact', 'workRights', 'jobIntention', 'emergencyContact', 'diversity'] as const;
const MISC_FIELDS = ['selfIntroduction', 'hobbies'] as const;

/** `contact.<key>` → `contact.address.<prop>` (mirrors ADDRESS_FIELDS in engine/values.ts). */
const ADDRESS_PROP: Readonly<Record<string, string>> = {
  addressCountry: 'country',
  addressProvince: 'province',
  addressCity: 'city',
  addressDistrict: 'district',
  addressStreet: 'street',
  postcode: 'postcode',
};

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/**
 * Minimal copy of `resume` for a frame with these needs. Schema-valid; unrequested leaves hold schema
 * defaults (the contact country code is blanked instead of the `+86` default). Entry counts of the
 * array modules in play are preserved so `ensureCards` / card alignment behave as with the full resume.
 */
export function buildResumeSubset(resume: Resume, needs: FrameNeeds): Resume {
  const attachmentKeys = new Set(needs.attachmentKeys);
  const requested = expandFieldKeys(needs.fieldKeys.filter((k) => !isAttachmentKey(k)));
  for (const k of needs.fieldKeys) if (isAttachmentKey(k)) attachmentKeys.add(k);

  // `id` is opaque and the schema wants it non-empty; `locale` drives derived values and labels.
  const out = ResumeSchema.parse({
    id: resume.id,
    title: '',
    locale: resume.locale,
    createdAt: 0,
    updatedAt: 0,
    contact: { phoneCountryCode: '' },
  }) as Resume;
  const outBag = out as unknown as Bag;
  const srcBag = resume as unknown as Bag;

  const arrayLeaves = new Map<ArrayModuleName, Set<string>>();
  for (const key of requested) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    const module = key.slice(0, dot);
    const field = key.slice(dot + 1);

    if (module === 'misc') {
      if ((MISC_FIELDS as readonly string[]).includes(field)) outBag[field] = srcBag[field];
    } else if (isArrayModuleName(module)) {
      let leaves = arrayLeaves.get(module);
      if (!leaves) arrayLeaves.set(module, (leaves = new Set()));
      leaves.add(field);
    } else if ((SINGLE_MODULES as readonly string[]).includes(module)) {
      const target = outBag[module] as Bag;
      const source = srcBag[module] as Bag;
      if (module === 'contact' && field in ADDRESS_PROP) {
        const prop = ADDRESS_PROP[field]!;
        (target.address as Bag)[prop] = (source.address as Bag)[prop];
      } else if (field in target && field !== 'address') {
        target[field] = clone(source[field]);
      }
    }
    // attachments.* and unknown keys: nothing to copy here
  }

  // An identity or passport number is never filled into any page, whatever the page asks: it stays home.
  (outBag.basics as Bag).idNumber = '';

  // Not a field of its own on any page: it says how the gender field is answered.
  if (requested.has('basics.gender')) {
    (outBag.diversity as Bag).genderAnswer = (srcBag.diversity as Bag).genderAnswer;
  }

  // Array modules: whole module for a repeated section, requested leaves for a module reached by key only.
  const wholeModules = new Set<ArrayModuleName>();
  for (const section of needs.repeatSections) {
    const m = sectionModule(section);
    if (m) wholeModules.add(m);
  }
  for (const module of ARRAY_MODULE_NAMES) {
    const entries = srcBag[module] as Bag[];
    if (wholeModules.has(module)) {
      outBag[module] = entries.map((e) => clone(e));
    } else if (arrayLeaves.has(module)) {
      const leaves = new Set([...arrayLeaves.get(module)!, ...(ENTRY_ALIGNMENT_FIELDS[module] ?? [])]);
      outBag[module] = entries.map((entry) => {
        const copy = ENTRY_SCHEMAS[module].parse({}) as Bag;
        for (const leaf of leaves) if (leaf in copy) copy[leaf] = clone(entry[leaf]);
        return copy;
      });
    }
  }

  // Attachments: file ids of the requested upload controls only.
  for (const key of attachmentKeys) {
    const prop = ATTACHMENT_PROP[key];
    const id = resume.attachments[prop];
    if (id) out.attachments[prop] = id;
  }
  return out;
}
