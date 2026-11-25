// Editor metadata: which modules/fields the resume form shows and how each field is edited.
// Pure data (no React) so it can be unit-tested against the schema.
import { z } from 'zod';
import {
  AwardSchema,
  CampusEntrySchema,
  CertificateSchema,
  CustomAnswerSchema,
  EducationSchema,
  FamilyMemberSchema,
  LanguageEntrySchema,
  LanguageTestSchema,
  ProjectSchema,
  RefereeSchema,
  SkillSchema,
  WorkEntrySchema,
  APPLICATION_QUESTIONS,
  type QuestionType,
  type Resume,
} from '../schema';

export type InputKind = 'text' | 'textarea' | 'date' | 'month' | 'select' | 'bool' | 'region' | 'list' | 'number';

export interface FieldMeta {
  /** Path inside the module object (dotted for nested objects, e.g. `address.city`). */
  key: string;
  labelKey: string;
  input: InputKind;
  /** Key into the option dictionary / `ENUM_VALUES` for `select` inputs. */
  enumDomain?: string;
  /** On an end-date field: the boolean key (`current`) that the "至今 / Present" checkbox toggles. */
  currentKey?: string;
}

export type ModuleName =
  | 'basics' | 'contact' | 'workRights' | 'jobIntention' | 'questions' | 'education' | 'work' | 'projects' | 'campus'
  | 'awards' | 'languages' | 'certificates' | 'skills' | 'family' | 'emergencyContact' | 'referees'
  | 'diversity' | 'about' | 'customAnswers' | 'attachments';

/** Modules stored as arrays of entries on the resume. */
export type ArrayModuleName =
  | 'education' | 'work' | 'projects' | 'campus' | 'awards' | 'languages' | 'certificates' | 'skills'
  | 'family' | 'referees' | 'customAnswers';

/** A list inside each entry of a module: the tests of a language entry. Only the extension's editor shows it so far. */
export interface SubListMeta {
  /** Key of the array inside the entry. */
  key: string;
  labelKey: string;
  helpKey: string;
  /** Names one item: `{n}` is its number. */
  itemLabelKey: string;
  addLabelKey: string;
  removeLabelKey: string;
  fields: FieldMeta[];
}

export interface ModuleMeta {
  module: ModuleName;
  labelKey: string;
  fields: FieldMeta[];
  subLists?: SubListMeta[];
  /** Array module: the user can add, remove and reorder entries. */
  repeatable: boolean;
  /** `about` edits top-level resume fields; `attachments` has a dedicated uploader instead of fields. */
  container: 'object' | 'array' | 'root' | 'attachments';
}

const f = (
  key: string,
  labelName: string,
  input: InputKind,
  extra: { enumDomain?: string; currentKey?: string } = {},
): FieldMeta => ({ key, labelKey: `options.field.${labelName}`, input, ...extra });

const text = (key: string, labelName = key) => f(key, labelName, 'text');
const area = (key: string, labelName = key) => f(key, labelName, 'textarea');
const select = (key: string, enumDomain: string, labelName = key) => f(key, labelName, 'select', { enumDomain });
const month = (key: string, labelName = key) => f(key, labelName, 'month');
const endMonth = (key = 'endDate') => f(key, 'endDate', 'month', { currentKey: 'current' });

const QUESTION_INPUT: Record<QuestionType, InputKind> = { bool: 'bool', number: 'number', text: 'text', enum: 'select' };

const mod = (
  module: ModuleName,
  container: ModuleMeta['container'],
  fields: FieldMeta[],
): ModuleMeta => ({
  module,
  labelKey: `options.module.${module}`,
  fields,
  repeatable: container === 'array',
  container,
});

export const MODULES: readonly ModuleMeta[] = [
  mod('basics', 'object', [
    text('familyName'), text('givenName'), text('preferredName'), text('englishName'), text('pronouns'),
    select('gender', 'gender'),
    f('birthDate', 'birthDate', 'date'),
    text('nationality'), text('ethnicity'),
    select('idType', 'idType'), text('idNumber'),
    select('maritalStatus', 'maritalStatus'),
    select('politicalStatus', 'politicalStatus'),
    f('partyJoinDate', 'partyJoinDate', 'date'),
    f('height', 'height', 'number'), f('weight', 'weight', 'number'),
    f('nativePlace', 'nativePlace', 'region'),
    f('studentOrigin', 'studentOrigin', 'region'),
    f('household', 'household', 'region'),
    f('currentLocation', 'currentLocation', 'region'),
  ]),
  mod('contact', 'object', [
    text('email'), text('phoneCountryCode'), text('phone'), text('wechat'), text('qq'),
    text('address.country', 'country'), text('address.province', 'province'),
    text('address.city', 'city'), text('address.district', 'district'),
    text('address.street', 'street'), text('address.postcode', 'postcode'),
    text('linkedin'), text('github'), text('portfolio'), text('website'),
  ]),
  mod('workRights', 'object', [
    select('status', 'workRightsStatus', 'workRightsStatus'),
    text('visaType'),
    f('visaExpiry', 'visaExpiry', 'date'),
    f('requiresSponsorship', 'requiresSponsorship', 'bool'),
    f('hasFullWorkRights', 'hasFullWorkRights', 'bool'),
  ]),
  mod('jobIntention', 'object', [
    f('positions', 'positions', 'list'), f('cities', 'cities', 'list'),
    text('industry'),
    select('employmentType', 'employmentType'),
    f('salaryMin', 'salaryMin', 'number'), f('salaryMax', 'salaryMax', 'number'),
    select('salaryCurrency', 'salaryCurrency'), select('salaryPeriod', 'salaryPeriod'),
    f('availableFrom', 'availableFrom', 'date'),
    text('noticePeriod'),
    f('acceptAdjustment', 'acceptAdjustment', 'bool'),
    f('acceptRelocation', 'acceptRelocation', 'bool'),
    text('howDidYouHear'),
  ]),
  mod('questions', 'object', APPLICATION_QUESTIONS.map((q) =>
    f(q.key, q.key, QUESTION_INPUT[q.type], q.enumDomain ? { enumDomain: q.enumDomain } : {}),
  )),
  mod('education', 'array', [
    text('school'), text('schoolEn'), text('country'), text('city'),
    select('degree', 'degree'), select('educationType', 'educationType'),
    text('major'), text('minor'), text('department'),
    month('startDate'), endMonth(),
    text('gpa'), text('gpaScale'), text('ranking'),
    area('courses'), text('thesis'), area('honors'),
  ]),
  mod('work', 'array', [
    select('kind', 'workKind', 'workKind'),
    text('company'), text('position'), text('department', 'workDepartment'), text('city'),
    month('startDate'), endMonth(),
    area('description'),
  ]),
  mod('projects', 'array', [
    text('name', 'projectName'), text('role'),
    month('startDate'), endMonth(),
    area('description'), text('link'),
  ]),
  mod('campus', 'array', [
    text('organization'), text('role'),
    month('startDate'), endMonth(),
    area('description'),
  ]),
  mod('awards', 'array', [
    text('name', 'awardName'), month('date'),
    select('level', 'awardLevel', 'awardLevel'),
    text('issuer'), area('description'),
  ]),
  {
    ...mod('languages', 'array', [
      text('language'), select('proficiency', 'proficiency'),
      select('listeningSpeaking', 'proficiency'), select('readingWriting', 'proficiency'),
      text('certificate'), text('score'),
    ]),
    subLists: [{
      key: 'tests',
      labelKey: 'options.field.tests',
      helpKey: 'options.tests.help',
      itemLabelKey: 'options.tests.item',
      addLabelKey: 'options.tests.add',
      removeLabelKey: 'options.tests.remove',
      fields: [select('test', 'languageTest'), text('score'), month('date', 'testDate')],
    }],
  },
  mod('certificates', 'array', [
    text('name', 'certName'), month('date'), text('issuer'), text('number', 'certNumber'),
  ]),
  mod('skills', 'array', [text('name', 'skillName'), text('level', 'skillLevel')]),
  mod('family', 'array', [
    text('name', 'personName'), select('relationship', 'relationship'),
    text('employer'), text('position'), text('phone'),
    select('politicalStatus', 'politicalStatus'),
  ]),
  mod('emergencyContact', 'object', [
    text('name', 'personName'), select('relationship', 'relationship'), text('phone'),
  ]),
  mod('referees', 'array', [
    text('name', 'personName'), text('title'), text('company'),
    text('email'), text('phone'), text('relationship'),
  ]),
  mod('diversity', 'object', [
    select('indigenous', 'diversity'), select('disability', 'diversity'),
    select('genderIdentity', 'diversity'), select('veteran', 'diversity'),
    select('genderAnswer', 'genderAnswer'),
  ]),
  mod('about', 'root', [area('selfIntroduction'), area('hobbies')]),
  mod('customAnswers', 'array', [text('question'), area('answer')]),
  mod('attachments', 'attachments', []),
];

export function getModule(name: ModuleName): ModuleMeta {
  const found = MODULES.find((m) => m.module === name);
  if (!found) throw new Error(`Unknown module: ${name}`);
  return found;
}

export const ARRAY_MODULES: readonly ArrayModuleName[] = MODULES.filter((m) => m.repeatable).map(
  (m) => m.module as ArrayModuleName,
);

/** Entry schemas of the repeatable modules (used to build empty entries with schema defaults). */
const ENTRY_SCHEMAS: Record<ArrayModuleName, z.ZodType> = {
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
  customAnswers: CustomAnswerSchema,
};

export type EntryOf<M extends ArrayModuleName> = Resume[M][number];

/** A fresh entry with every schema default applied. */
export function newEntry<M extends ArrayModuleName>(module: M): EntryOf<M> {
  return ENTRY_SCHEMAS[module].parse({}) as EntryOf<M>;
}

/** Item schemas of the lists inside entries, by key. */
const SUB_ITEM_SCHEMAS: Record<string, z.ZodType> = { tests: LanguageTestSchema };

/** A fresh item of a list inside an entry, with every schema default applied. */
export function newSubItem(sub: SubListMeta): Record<string, unknown> {
  const schema = SUB_ITEM_SCHEMAS[sub.key];
  if (!schema) throw new Error(`Unknown list: ${sub.key}`);
  return schema.parse({}) as Record<string, unknown>;
}
