// Which field keys are long-text answers, and the kind each one is.
export type LongTextKind = 'coverLetter' | 'whyUs' | 'strengths' | 'careerPlan' | 'projectDuties' | 'selfEvaluation';

export const LONG_TEXT_KEYS: Readonly<Record<string, LongTextKind>> = {
  'answers.coverLetter': 'coverLetter',
  'answers.whyUs': 'whyUs',
  'answers.strengths': 'strengths',
  'answers.careerPlan': 'careerPlan',
  'projects.duties': 'projectDuties',
  'misc.selfIntroduction': 'selfEvaluation',
};

export const longTextKindOf = (fieldKey: string): LongTextKind | null => LONG_TEXT_KEYS[fieldKey] ?? null;

/** Kinds that are always a draft for the applicant to read before it goes in; self evaluation only when cut. */
export const isDraftKind = (kind: LongTextKind): boolean => kind !== 'selfEvaluation';
