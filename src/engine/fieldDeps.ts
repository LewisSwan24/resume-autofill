// What a frame needs from the resume (data minimisation, M1.1): the `frame:needs` answer type and the
// single dependency table that says which resume leaves a field key reads.
//
// Mirrors `resolveValue` in ./values.ts: a derived key reads several leaves (basics.fullName → family +
// given name), and the `endDate` of a card is blanked while `current` is true. Keep the two in sync;
// tests/unit/engine/fieldDeps.test.ts resolves every derived key against a subset built from this table.
import { FIELD_KEYS, getFieldKeyDef, type FieldKey, type SectionKey } from '../schema/fieldKeys';

export type AttachmentKey = 'attachments.resume' | 'attachments.photo' | 'attachments.transcript';

export const ATTACHMENT_KEYS: readonly AttachmentKey[] = [
  'attachments.resume',
  'attachments.photo',
  'attachments.transcript',
];

/** Attachment key → the `resume.attachments` property that holds its file id. */
export const ATTACHMENT_PROP: Readonly<Record<AttachmentKey, 'resumeFileId' | 'photoFileId' | 'transcriptFileId'>> = {
  'attachments.resume': 'resumeFileId',
  'attachments.photo': 'photoFileId',
  'attachments.transcript': 'transcriptFileId',
};

export const isAttachmentKey = (key: string): key is AttachmentKey =>
  (ATTACHMENT_KEYS as readonly string[]).includes(key);

/** Sections that repeat as cards (one per resume entry). */
export const REPEAT_SECTIONS: readonly SectionKey[] = [
  'education', 'work', 'internship', 'projects', 'campus', 'awards', 'languages', 'certificates', 'skills',
  'family', 'referees',
];

/** Array modules of the resume (`internship` cards are fed by the `work` module). */
export const ARRAY_MODULE_NAMES = [
  'education', 'work', 'projects', 'campus', 'awards', 'languages', 'certificates', 'skills', 'family', 'referees',
] as const;
export type ArrayModuleName = (typeof ARRAY_MODULE_NAMES)[number];

export const isArrayModuleName = (m: string): m is ArrayModuleName =>
  (ARRAY_MODULE_NAMES as readonly string[]).includes(m);

/** Resume module a repeated section reads (`internship` → `work`); null for non-repeated sections. */
export function sectionModule(section: SectionKey): ArrayModuleName | null {
  const m = section === 'internship' ? 'work' : section;
  return isArrayModuleName(m) ? m : null;
}

/**
 * Answer of a frame to `frame:needs`. Carries no resume data and no locale: only which field keys the
 * frame recognised, which repeated sections it has (cards or add buttons) and which upload controls.
 */
export interface FrameNeeds {
  /** Recognised keys at or above the review threshold (attachment keys are listed in `attachmentKeys`). */
  fieldKeys: FieldKey[];
  /** Repeated sections present on the page. */
  repeatSections: SectionKey[];
  /** Upload controls that will take a file. */
  attachmentKeys: AttachmentKey[];
}

export const emptyNeeds = (): FrameNeeds => ({ fieldKeys: [], repeatSections: [], attachmentKeys: [] });

export const isEmptyNeeds = (n: FrameNeeds): boolean =>
  n.fieldKeys.length === 0 && n.repeatSections.length === 0 && n.attachmentKeys.length === 0;

const KNOWN_SECTIONS: ReadonlySet<string> = new Set(REPEAT_SECTIONS);
const MAX_ENTRIES = 512;

const stringList = (x: unknown): string[] | null =>
  Array.isArray(x) && x.length <= MAX_ENTRIES && x.every((s) => typeof s === 'string') ? (x as string[]) : null;

/**
 * Validate an untrusted `frame:needs` answer. Returns null when it is not the right shape; unknown keys,
 * sections and attachment names are dropped (they could never resolve to data anyway).
 */
export function parseFrameNeeds(x: unknown): FrameNeeds | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = stringList(o.fieldKeys);
  const sections = stringList(o.repeatSections);
  const attachments = stringList(o.attachmentKeys);
  if (!keys || !sections || !attachments) return null;
  const attachmentKeys = new Set<AttachmentKey>(attachments.filter(isAttachmentKey));
  const fieldKeys = new Set<FieldKey>();
  for (const k of keys) {
    if (isAttachmentKey(k)) attachmentKeys.add(k);
    else if (getFieldKeyDef(k)) fieldKeys.add(k);
  }
  return {
    fieldKeys: [...fieldKeys],
    repeatSections: [...new Set(sections.filter((s): s is SectionKey => KNOWN_SECTIONS.has(s)))],
    attachmentKeys: [...attachmentKeys],
  };
}

// ---------------------------------------------------------------- dependency table

const ADDRESS_KEYS = [
  'contact.addressCountry', 'contact.addressProvince', 'contact.addressCity', 'contact.addressDistrict',
  'contact.addressStreet', 'contact.postcode',
];

/**
 * Field key → the other keys whose leaves its value is computed from (beyond its own leaf).
 *  - derived keys: see `derived()` in values.ts;
 *  - `<array module>.endDate` → `.current` (a current entry has no end date, see resolveValue).
 */
export const FIELD_DEPS: Readonly<Record<FieldKey, readonly FieldKey[]>> = {
  'basics.fullName': ['basics.familyName', 'basics.givenName'],
  'basics.age': ['basics.birthDate'],
  'basics.currentLocation': ['contact.addressCountry', 'contact.addressProvince', 'contact.addressCity'],
  // On a list of places these tell the ones of one name apart (matchPlace in values.ts).
  'contact.addressCity': ['contact.addressCountry', 'contact.addressProvince'],
  // A short form means different things in different countries (placeSpellings in the dictionary).
  'contact.addressProvince': ['contact.addressCountry'],
  // Several places share a code, and the country of the address settles which one.
  'contact.phoneCountryCode': ['contact.addressCountry'],
  'contact.phoneFull': ['contact.phone', 'contact.phoneCountryCode'],
  'contact.addressFull': ADDRESS_KEYS,
  'contact.inNamedCountry': ['contact.addressCountry'],
  'education.period': ['education.startDate', 'education.endDate', 'education.current'],
  'work.period': ['work.startDate', 'work.endDate', 'work.current'],
  'projects.period': ['projects.startDate', 'projects.endDate', 'projects.current'],
  'campus.period': ['campus.startDate', 'campus.endDate', 'campus.current'],
  'education.endDate': ['education.current'],
  'work.endDate': ['work.current'],
  'projects.endDate': ['projects.current'],
  'campus.endDate': ['campus.current'],
};

/**
 * Leaves of an array module that card alignment needs whenever any entry of the module is sent:
 * `work.kind` splits internship from work entries (sectionEntries in values.ts).
 */
export const ENTRY_ALIGNMENT_FIELDS: Readonly<Partial<Record<ArrayModuleName, readonly string[]>>> = {
  work: ['kind'],
};

/** The keys plus everything their values are computed from. */
export function expandFieldKeys(keys: Iterable<FieldKey>): Set<FieldKey> {
  const out = new Set<FieldKey>();
  for (const k of keys) {
    out.add(k);
    for (const dep of FIELD_DEPS[k] ?? []) out.add(dep);
  }
  return out;
}

/** Every catalogued key (for tests). */
export const ALL_FIELD_KEYS: readonly FieldKey[] = FIELD_KEYS.map((d) => d.key);
