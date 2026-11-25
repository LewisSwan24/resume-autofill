// Application questions: what forms ask beyond the resume itself (能否出差, 已有几份 offer, Do you hold a driver's
// licence?). One answer each, of a fixed type, kept once per resume and empty until the applicant answers it.
import { z } from 'zod';

export const WORK_ARRANGEMENTS = ['onsite', 'hybrid', 'remote'] as const;
/** 应届 or 往届: graduating in this recruiting season, or earlier. */
export const GRADUATE_STATUSES = ['fresh_graduate', 'past_graduate'] as const;
/** Australian government security clearance held now. */
export const SECURITY_CLEARANCES = ['none', 'baseline', 'nv1', 'nv2', 'pv'] as const;

export type QuestionGroup = 'arrangements' | 'offers' | 'relations' | 'identity' | 'screening';
export type QuestionType = 'bool' | 'number' | 'text' | 'enum';

export interface ApplicationQuestion {
  key: string;
  group: QuestionGroup;
  type: QuestionType;
  /** For `enum`: the option domain, whose codes are in `QUESTION_ENUM_VALUES`. */
  enumDomain?: string;
}

const q = (key: string, group: QuestionGroup, type: QuestionType, enumDomain?: string): ApplicationQuestion =>
  enumDomain ? { key, group, type, enumDomain } : { key, group, type };

/** In the order the editor shows them, group by group. */
export const APPLICATION_QUESTIONS: readonly ApplicationQuestion[] = [
  q('canTravel', 'arrangements', 'bool'),
  q('shiftWork', 'arrangements', 'bool'),
  q('overtime', 'arrangements', 'bool'),
  q('canWorkOnsite', 'arrangements', 'bool'),
  q('workArrangement', 'arrangements', 'enum', 'workArrangement'),
  q('earlyInternship', 'arrangements', 'bool'),
  q('internshipDaysPerWeek', 'arrangements', 'number'),
  q('internshipMonths', 'arrangements', 'number'),

  q('offerCount', 'offers', 'number'),
  q('offerSalaryRange', 'offers', 'text'),
  q('currentSalary', 'offers', 'number'),

  q('relativesAtCompany', 'relations', 'bool'),
  q('relativesDetail', 'relations', 'text'),
  q('workedHereBefore', 'relations', 'bool'),
  q('referrerName', 'relations', 'text'),
  q('campusAmbassador', 'relations', 'bool'),

  q('graduateStatus', 'identity', 'enum', 'graduateStatus'),
  q('furtherStudyPlan', 'identity', 'bool'),
  q('securityClearance', 'identity', 'enum', 'securityClearance'),
  q('driversLicence', 'identity', 'bool'),

  q('englishWorkingLanguage', 'screening', 'bool'),
  q('yearsExperience', 'screening', 'number'),
  q('yearsLeading', 'screening', 'number'),
  q('background', 'screening', 'text'),
];

export const QUESTION_ENUM_VALUES = {
  workArrangement: WORK_ARRANGEMENTS,
  graduateStatus: GRADUATE_STATUSES,
  securityClearance: SECURITY_CLEARANCES,
} as const;

/** Spelled out so each answer keeps its own type; a test holds it to `APPLICATION_QUESTIONS`. */
export const QuestionsSchema = z.object({
  canTravel: z.boolean().nullable().default(null),
  shiftWork: z.boolean().nullable().default(null),
  overtime: z.boolean().nullable().default(null),
  canWorkOnsite: z.boolean().nullable().default(null),
  workArrangement: z.enum(WORK_ARRANGEMENTS).nullable().default(null),
  earlyInternship: z.boolean().nullable().default(null),
  internshipDaysPerWeek: z.number().nonnegative().nullable().default(null),
  internshipMonths: z.number().nonnegative().nullable().default(null),
  offerCount: z.number().nonnegative().nullable().default(null),
  offerSalaryRange: z.string().default(''),
  currentSalary: z.number().nonnegative().nullable().default(null),
  relativesAtCompany: z.boolean().nullable().default(null),
  relativesDetail: z.string().default(''),
  workedHereBefore: z.boolean().nullable().default(null),
  referrerName: z.string().default(''),
  campusAmbassador: z.boolean().nullable().default(null),
  graduateStatus: z.enum(GRADUATE_STATUSES).nullable().default(null),
  furtherStudyPlan: z.boolean().nullable().default(null),
  securityClearance: z.enum(SECURITY_CLEARANCES).nullable().default(null),
  driversLicence: z.boolean().nullable().default(null),
  englishWorkingLanguage: z.boolean().nullable().default(null),
  yearsExperience: z.number().nonnegative().nullable().default(null),
  yearsLeading: z.number().nonnegative().nullable().default(null),
  background: z.string().default(''),
});

export type Questions = z.infer<typeof QuestionsSchema>;
