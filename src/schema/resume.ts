// Resume data model (zod v4). Every module has defaults so that
// `ResumeSchema.parse({ id, title, locale })` yields a complete, empty resume.
import { z } from 'zod';

// ---------------------------------------------------------------- primitives

/** Free text; empty string means "not provided". */
const text = () => z.string().default('');

/** `YYYY-MM` or `YYYY-MM-DD`. */
export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;
const dateString = () => z.string().regex(DATE_PATTERN, 'Expected YYYY-MM or YYYY-MM-DD');
/** Date that may be empty. */
const date = () => z.union([z.literal(''), dateString()]).default('');
/** End date: `null` + `current: true` represents "至今 / present". */
const endDate = () => z.union([z.literal(''), dateString()]).nullable().default(null);

const nullableBool = () => z.boolean().nullable().default(null);
const nullableNumber = () => z.number().nonnegative().nullable().default(null);
const nullableEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().default(null);

// ---------------------------------------------------------------- enum codes

export const GENDERS = ['male', 'female', 'nonbinary', 'undisclosed'] as const;
export const ID_TYPES = ['id_card', 'passport', 'hk_macau_permit', 'taiwan_permit', 'other'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'other'] as const;
export const POLITICAL_STATUSES = [
  'party_member', 'probationary_party_member', 'league_member', 'masses', 'democratic_party', 'other',
] as const;
export const WORK_RIGHTS_STATUSES = [
  'citizen', 'permanent_resident', 'graduate_visa', 'student_visa', 'working_holiday', 'other_temporary', 'no_rights',
] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'internship', 'contract', 'graduate_program'] as const;
export const SALARY_CURRENCIES = ['CNY', 'AUD', 'USD'] as const;
export const SALARY_PERIODS = ['month', 'year'] as const;
export const DEGREES = ['high_school', 'associate', 'bachelor', 'master', 'phd', 'other'] as const;
export const EDUCATION_TYPES = ['full_time', 'part_time'] as const;
export const WORK_KINDS = ['internship', 'full_time', 'part_time'] as const;
export const AWARD_LEVELS = [
  'national', 'provincial', 'municipal', 'school', 'college', 'international', 'other',
] as const;
export const PROFICIENCIES = ['native', 'fluent', 'proficient', 'intermediate', 'basic'] as const;
export const RELATIONSHIPS = ['father', 'mother', 'spouse', 'sibling', 'other'] as const;
export const DIVERSITY_ANSWERS = ['yes', 'no', 'prefer_not_to_say'] as const;
/** How to answer a gender question that offers a way to decline. */
export const GENDER_ANSWERS = ['prefer_not_to_say', 'from_resume'] as const;

// ---------------------------------------------------------------- modules

export const RegionSchema = z.object({
  country: z.string().optional(),
  province: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
});

const region = () => RegionSchema.prefault({});

export const BasicsSchema = z.object({
  familyName: text(),
  givenName: text(),
  preferredName: text(),
  englishName: text(),
  pronouns: text(),
  gender: nullableEnum(GENDERS),
  birthDate: date(),
  nationality: text(),
  ethnicity: text(),
  idType: nullableEnum(ID_TYPES),
  idNumber: text(),
  maritalStatus: nullableEnum(MARITAL_STATUSES),
  politicalStatus: nullableEnum(POLITICAL_STATUSES),
  partyJoinDate: date(),
  height: nullableNumber(),
  weight: nullableNumber(),
  nativePlace: region(),
  studentOrigin: region(),
  household: region(),
  currentLocation: region(),
});

export const AddressSchema = z.object({
  country: text(),
  province: text(),
  city: text(),
  district: text(),
  street: text(),
  postcode: text(),
});

export const ContactSchema = z.object({
  email: text(),
  phoneCountryCode: z.string().default('+86'),
  phone: text(),
  wechat: text(),
  qq: text(),
  address: AddressSchema.prefault({}),
  linkedin: text(),
  github: text(),
  portfolio: text(),
  website: text(),
});

export const WorkRightsSchema = z.object({
  status: nullableEnum(WORK_RIGHTS_STATUSES),
  visaType: text(),
  visaExpiry: date(),
  requiresSponsorship: nullableBool(),
  hasFullWorkRights: nullableBool(),
});

export const JobIntentionSchema = z.object({
  positions: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  industry: text(),
  employmentType: nullableEnum(EMPLOYMENT_TYPES),
  salaryMin: nullableNumber(),
  salaryMax: nullableNumber(),
  salaryCurrency: nullableEnum(SALARY_CURRENCIES),
  salaryPeriod: nullableEnum(SALARY_PERIODS),
  availableFrom: date(),
  noticePeriod: text(),
  acceptAdjustment: nullableBool(),
  acceptRelocation: nullableBool(),
  howDidYouHear: text(),
});

export const EducationSchema = z.object({
  school: text(),
  schoolEn: text(),
  country: text(),
  city: text(),
  degree: nullableEnum(DEGREES),
  educationType: nullableEnum(EDUCATION_TYPES),
  major: text(),
  minor: text(),
  department: text(),
  startDate: date(),
  endDate: endDate(),
  current: z.boolean().default(false),
  gpa: text(),
  gpaScale: text(),
  ranking: text(),
  courses: text(),
  thesis: text(),
  honors: text(),
});

export const WorkEntrySchema = z.object({
  kind: z.enum(WORK_KINDS).default('full_time'),
  company: text(),
  position: text(),
  department: text(),
  city: text(),
  startDate: date(),
  endDate: endDate(),
  current: z.boolean().default(false),
  description: text(),
});

export const ProjectSchema = z.object({
  name: text(),
  role: text(),
  startDate: date(),
  endDate: endDate(),
  current: z.boolean().default(false),
  description: text(),
  link: text(),
});

export const CampusEntrySchema = z.object({
  organization: text(),
  role: text(),
  startDate: date(),
  endDate: endDate(),
  current: z.boolean().default(false),
  description: text(),
});

export const AwardSchema = z.object({
  name: text(),
  date: date(),
  level: nullableEnum(AWARD_LEVELS),
  issuer: text(),
  description: text(),
});

export const LanguageEntrySchema = z.object({
  language: text(),
  proficiency: nullableEnum(PROFICIENCIES),
  certificate: text(),
  score: text(),
});

export const CertificateSchema = z.object({
  name: text(),
  date: date(),
  issuer: text(),
  number: text(),
});

export const SkillSchema = z.object({
  name: text(),
  level: text(),
});

export const FamilyMemberSchema = z.object({
  name: text(),
  relationship: nullableEnum(RELATIONSHIPS),
  employer: text(),
  position: text(),
  phone: text(),
  politicalStatus: nullableEnum(POLITICAL_STATUSES),
});

export const EmergencyContactSchema = z.object({
  name: text(),
  relationship: nullableEnum(RELATIONSHIPS),
  phone: text(),
});

export const RefereeSchema = z.object({
  name: text(),
  title: text(),
  company: text(),
  email: text(),
  phone: text(),
  relationship: text(),
});

const diversityAnswer = () => z.enum(DIVERSITY_ANSWERS).default('prefer_not_to_say');

export const DiversitySchema = z.object({
  indigenous: diversityAnswer(),
  disability: diversityAnswer(),
  genderIdentity: diversityAnswer(),
  veteran: diversityAnswer(),
  genderAnswer: z.enum(GENDER_ANSWERS).default('prefer_not_to_say'),
});

export const AttachmentsSchema = z.object({
  resumeFileId: z.string().optional(),
  photoFileId: z.string().optional(),
  transcriptFileId: z.string().optional(),
});

export const CustomAnswerSchema = z.object({
  question: text(),
  answer: text(),
});

// ---------------------------------------------------------------- variant & recipe (Schema v2)

export const TRANSFORM_PRESETS = [
  'none',
  'trim',
  'uppercase',
  'lowercase',
  'phone_local',
  'date_ym',
  'date_ymd',
] as const;

export const VARIANT_SECTIONS = [
  'education',
  'work',
  'projects',
  'campus',
  'awards',
  'languages',
  'certificates',
  'skills',
  'family',
  'referees',
] as const;

export const VariantSectionSchema = z.enum(VARIANT_SECTIONS);

export const VariantMetaSchema = z.object({
  targetRole: z.string().max(120).optional(),
  customSummary: z.string().max(4000).optional(),
  hiddenSections: z.array(VariantSectionSchema).max(16).optional(),
  hiddenIndices: z.record(z.string(), z.array(z.number().int().nonnegative()).max(100)).optional(),
  sectionOrder: z.array(VariantSectionSchema).max(16).optional(),
  highlightedSkills: z.array(z.string().max(64)).max(60).optional(),
  jdKeywords: z.array(z.string().max(64)).max(60).optional(),
});

export const SiteRecipeFingerprintSchema = z.object({
  tag: z.string().min(1).max(32),
  role: z.string().max(64).optional(),
  inputType: z.string().max(32).optional(),
  nameAttr: z.string().max(128).optional(),
  autocomplete: z.string().max(64).optional(),
  placeholder: z.string().max(160).optional(),
  labelTokens: z.array(z.string().max(64)).max(24).default([]),
  structuralPath: z.string().max(256).optional(),
});

export const SiteRecipeRuleSchema = z.object({
  id: z.string().min(1).max(64),
  fingerprint: SiteRecipeFingerprintSchema,
  fieldKey: z.string().max(128).optional(),
  constantValue: z.string().max(2000).optional(),
  transformPreset: z.enum(TRANSFORM_PRESETS).default('none'),
});

export const SiteRecipeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  hostPattern: z.string().min(1).max(160),
  pathPattern: z.string().max(160).optional(),
  enabled: z.boolean().default(true),
  updatedAt: z.number().int().nonnegative(),
  rules: z.array(SiteRecipeRuleSchema).max(200).default([]),
});

// ---------------------------------------------------------------- resume / profile

export const LOCALES = ['zh-CN', 'en-AU'] as const;

export const ResumeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  locale: z.enum(LOCALES),
  linkedResumeId: z.string().optional(),
  variantOf: z.string().min(1).optional(),
  variantMeta: VariantMetaSchema.optional(),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
  basics: BasicsSchema.prefault({}),
  contact: ContactSchema.prefault({}),
  workRights: WorkRightsSchema.prefault({}),
  jobIntention: JobIntentionSchema.prefault({}),
  education: z.array(EducationSchema).default([]),
  work: z.array(WorkEntrySchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  campus: z.array(CampusEntrySchema).default([]),
  awards: z.array(AwardSchema).default([]),
  languages: z.array(LanguageEntrySchema).default([]),
  certificates: z.array(CertificateSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  family: z.array(FamilyMemberSchema).default([]),
  emergencyContact: EmergencyContactSchema.prefault({}),
  referees: z.array(RefereeSchema).default([]),
  diversity: DiversitySchema.prefault({}),
  selfIntroduction: text(),
  hobbies: text(),
  attachments: AttachmentsSchema.prefault({}),
  customAnswers: z.array(CustomAnswerSchema).default([]),
});

export const CURRENT_SCHEMA_VERSION = 2 as const;

export const SettingsSchema = z.object({
  uiLanguage: z.enum(['auto', 'zh', 'en']).default('auto'),
  previewBeforeFill: z.boolean().default(false),
  mappingPresetId: z.string().optional(),
  aiLayerMode: z.enum(['bm25_only', 'auto_local', 'ollama']).optional(),
  ollamaEnabled: z.boolean().optional(),
  ollamaEndpoint: z.string().optional(),
  ollamaModel: z.string().optional(),
  vaultIdleTimeoutMinutes: z.number().int().min(1).max(240).optional(),
});

export const ProfileSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  resumes: z.array(ResumeSchema).default([]),
  activeResumeId: z.string().nullable().default(null),
  settings: SettingsSchema.prefault({}),
  recipes: z.array(SiteRecipeSchema).optional(),
});

// ---------------------------------------------------------------- types

export type TransformPreset = (typeof TRANSFORM_PRESETS)[number];
export type VariantSection = (typeof VARIANT_SECTIONS)[number];
export type VariantMeta = z.infer<typeof VariantMetaSchema>;
export type SiteRecipeFingerprint = z.infer<typeof SiteRecipeFingerprintSchema>;
export type SiteRecipeRule = z.infer<typeof SiteRecipeRuleSchema>;
export type SiteRecipe = z.infer<typeof SiteRecipeSchema>;

export type Region = z.infer<typeof RegionSchema>;
export type Basics = z.infer<typeof BasicsSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type WorkRights = z.infer<typeof WorkRightsSchema>;
export type JobIntention = z.infer<typeof JobIntentionSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type WorkEntry = z.infer<typeof WorkEntrySchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CampusEntry = z.infer<typeof CampusEntrySchema>;
export type Award = z.infer<typeof AwardSchema>;
export type LanguageEntry = z.infer<typeof LanguageEntrySchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type FamilyMember = z.infer<typeof FamilyMemberSchema>;
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;
export type Referee = z.infer<typeof RefereeSchema>;
export type Diversity = z.infer<typeof DiversitySchema>;
export type GenderAnswer = (typeof GENDER_ANSWERS)[number];
export type Attachments = z.infer<typeof AttachmentsSchema>;
export type CustomAnswer = z.infer<typeof CustomAnswerSchema>;
export type Resume = z.infer<typeof ResumeSchema>;
/** Minimal input accepted by `ResumeSchema.parse`. */
export type ResumeInput = z.input<typeof ResumeSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Locale = (typeof LOCALES)[number];
