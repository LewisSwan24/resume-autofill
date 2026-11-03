// Field-key catalogue: every fillable leaf of the resume model plus derived keys.
// A FieldKey is "<module>.<field>". Array modules use the module-level key; the entry index
// comes from card alignment at fill time. Top-level string modules live under `misc.*`.
import {
  AWARD_LEVELS, DEGREES, DIVERSITY_ANSWERS, EDUCATION_TYPES, EMPLOYMENT_TYPES, GENDERS, ID_TYPES,
  MARITAL_STATUSES, POLITICAL_STATUSES, PROFICIENCIES, RELATIONSHIPS, SALARY_CURRENCIES, SALARY_PERIODS,
  WORK_KINDS, WORK_RIGHTS_STATUSES,
} from './resume';

export type FieldKey = string;
export type SectionKey =
  | 'basics' | 'contact' | 'jobIntention' | 'education' | 'work' | 'internship' | 'projects'
  | 'campus' | 'awards' | 'languages' | 'certificates' | 'skills' | 'family'
  | 'emergencyContact' | 'referees' | 'workRights' | 'diversity' | 'selfIntro'
  | 'attachments' | 'other';
export type ValueType = 'text' | 'longtext' | 'date' | 'enum' | 'bool' | 'region' | 'file' | 'number' | 'list';
export interface FieldKeyDef {
  key: FieldKey;
  type: ValueType;
  enumDomain?: string;        // key into option dictionary, e.g. 'gender', 'degree', 'politicalStatus'
  derived?: boolean;          // computed at fill time (e.g. basics.fullName)
  sections: SectionKey[];     // sections where this key may legitimately appear
}

/** Canonical codes per enum domain. Bool fields use `yesNo` (`'yes'` ↔ true, `'no'` ↔ false). */
export const ENUM_VALUES: Readonly<Record<string, readonly string[]>> = {
  gender: GENDERS,
  idType: ID_TYPES,
  maritalStatus: MARITAL_STATUSES,
  politicalStatus: POLITICAL_STATUSES,
  workRightsStatus: WORK_RIGHTS_STATUSES,
  employmentType: EMPLOYMENT_TYPES,
  degree: DEGREES,
  educationType: EDUCATION_TYPES,
  workKind: WORK_KINDS,
  awardLevel: AWARD_LEVELS,
  proficiency: PROFICIENCIES,
  relationship: RELATIONSHIPS,
  diversity: DIVERSITY_ANSWERS,
  yesNo: ['yes', 'no'],
  salaryCurrency: SALARY_CURRENCIES,
  salaryPeriod: SALARY_PERIODS,
};

/** Every enum domain used by FIELD_KEYS (the option dictionary must cover each). */
export const ENUM_DOMAINS: string[] = Object.keys(ENUM_VALUES);

// ---------------------------------------------------------------- builders

type Opts = { enumDomain?: string; derived?: boolean };
const def = (key: FieldKey, type: ValueType, sections: SectionKey[], opts: Opts = {}): FieldKeyDef => ({
  key, type, sections, ...opts,
});

/** Builds defs for one module sharing the same sections. */
function module(
  name: string,
  sections: SectionKey[],
  fields: Record<string, ValueType | [ValueType, string]>,
): FieldKeyDef[] {
  return Object.entries(fields).map(([field, spec]) =>
    Array.isArray(spec)
      ? def(`${name}.${field}`, spec[0], sections, { enumDomain: spec[1] })
      : def(`${name}.${field}`, spec, sections),
  );
}

const yesNo = (): [ValueType, string] => ['bool', 'yesNo'];

// ---------------------------------------------------------------- catalogue

export const FIELD_KEYS: FieldKeyDef[] = [
  ...module('basics', ['basics', 'contact', 'other'], {
    familyName: 'text', givenName: 'text', preferredName: 'text', englishName: 'text', pronouns: 'text',
    gender: ['enum', 'gender'], birthDate: 'date', nationality: 'text', ethnicity: 'text',
    idType: ['enum', 'idType'], idNumber: 'text', maritalStatus: ['enum', 'maritalStatus'],
    politicalStatus: ['enum', 'politicalStatus'], partyJoinDate: 'date', height: 'number', weight: 'number',
    nativePlace: 'region', studentOrigin: 'region', household: 'region', currentLocation: 'region',
  }),
  def('basics.fullName', 'text', ['basics', 'contact', 'other'], { derived: true }),
  def('basics.age', 'number', ['basics', 'other'], { derived: true }),

  ...module('contact', ['contact', 'basics', 'other'], {
    email: 'text', phoneCountryCode: 'text', phone: 'text', wechat: 'text', qq: 'text',
    addressCountry: 'text', addressProvince: 'text', addressCity: 'text', addressDistrict: 'text',
    addressStreet: 'text', postcode: 'text',
    linkedin: 'text', github: 'text', portfolio: 'text', website: 'text',
  }),
  def('contact.phoneFull', 'text', ['contact', 'basics', 'other'], { derived: true }),
  def('contact.addressFull', 'text', ['contact', 'basics', 'other'], { derived: true }),

  ...module('workRights', ['workRights', 'basics', 'other'], {
    status: ['enum', 'workRightsStatus'], visaType: 'text', visaExpiry: 'date',
    requiresSponsorship: yesNo(), hasFullWorkRights: yesNo(),
  }),

  ...module('jobIntention', ['jobIntention', 'other'], {
    positions: 'list', cities: 'list', industry: 'text', employmentType: ['enum', 'employmentType'],
    salaryMin: 'number', salaryMax: 'number', salaryCurrency: ['enum', 'salaryCurrency'],
    salaryPeriod: ['enum', 'salaryPeriod'], availableFrom: 'date', noticePeriod: 'text',
    acceptAdjustment: yesNo(), acceptRelocation: yesNo(), howDidYouHear: 'text',
  }),

  ...module('education', ['education'], {
    school: 'text', schoolEn: 'text', country: 'text', city: 'text', degree: ['enum', 'degree'],
    educationType: ['enum', 'educationType'], major: 'text', minor: 'text', department: 'text',
    startDate: 'date', endDate: 'date', current: yesNo(), gpa: 'text', gpaScale: 'text', ranking: 'text',
    courses: 'longtext', thesis: 'text', honors: 'longtext',
  }),

  ...module('work', ['work', 'internship'], {
    kind: ['enum', 'workKind'], company: 'text', position: 'text', department: 'text', city: 'text',
    startDate: 'date', endDate: 'date', current: yesNo(), description: 'longtext',
  }),

  ...module('projects', ['projects'], {
    name: 'text', role: 'text', startDate: 'date', endDate: 'date', current: yesNo(),
    description: 'longtext', link: 'text',
  }),

  ...module('campus', ['campus'], {
    organization: 'text', role: 'text', startDate: 'date', endDate: 'date', current: yesNo(),
    description: 'longtext',
  }),

  ...module('awards', ['awards'], {
    name: 'text', date: 'date', level: ['enum', 'awardLevel'], issuer: 'text', description: 'longtext',
  }),

  ...module('languages', ['languages'], {
    language: 'text', proficiency: ['enum', 'proficiency'], certificate: 'text', score: 'text',
  }),

  ...module('certificates', ['certificates'], { name: 'text', date: 'date', issuer: 'text', number: 'text' }),

  ...module('skills', ['skills'], { name: 'text', level: 'text' }),

  ...module('family', ['family'], {
    name: 'text', relationship: ['enum', 'relationship'], employer: 'text', position: 'text', phone: 'text',
    politicalStatus: ['enum', 'politicalStatus'],
  }),

  ...module('emergencyContact', ['emergencyContact', 'family'], {
    name: 'text', relationship: ['enum', 'relationship'], phone: 'text',
  }),

  ...module('referees', ['referees'], {
    name: 'text', title: 'text', company: 'text', email: 'text', phone: 'text', relationship: 'text',
  }),

  ...module('diversity', ['diversity', 'other'], {
    indigenous: ['enum', 'diversity'], disability: ['enum', 'diversity'],
    genderIdentity: ['enum', 'diversity'], veteran: ['enum', 'diversity'],
  }),

  def('misc.selfIntroduction', 'longtext', ['selfIntro', 'other']),
  def('misc.hobbies', 'longtext', ['selfIntro', 'other']),

  ...module('attachments', ['attachments', 'other'], { resume: 'file', photo: 'file', transcript: 'file' }),
];

const BY_KEY = new Map(FIELD_KEYS.map((d) => [d.key, d]));

export function getFieldKeyDef(key: FieldKey): FieldKeyDef | undefined {
  return BY_KEY.get(key);
}
