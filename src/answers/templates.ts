// The applicant's long-text answers start from these, and the applicant may replace any of them in the options page.
// A placeholder names something from the page or the resume; a sentence whose placeholder has nothing behind it is
// left out of the draft, so nothing is ever guessed and no empty braces reach a form.
//
// Placeholders, in either language: {公司}/{company}, {职位}/{position}, {姓名}/{name}, {简介}/{intro},
// {亮点}/{highlight}, {技能}/{skills}, {奖项}/{awards}, {意向}/{intention}.

export type TemplateKind = 'coverLetter' | 'whyUs' | 'strengths' | 'careerPlan';
export type TemplateLang = 'zh' | 'en';
export type Templates = Partial<Record<TemplateKind, string>>;

export const TEMPLATE_KINDS: readonly TemplateKind[] = ['coverLetter', 'whyUs', 'strengths', 'careerPlan'];

export const DEFAULT_TEMPLATES: Readonly<Record<TemplateLang, Readonly<Record<TemplateKind, string>>>> = {
  zh: {
    coverLetter: [
      '您好！我希望应聘{公司}的{职位}一职。',
      '{简介}',
      '{亮点}',
      '我熟悉{技能}，相信能较快胜任这份工作。',
      '期待有机会进一步交流，谢谢！',
    ].join('\n'),
    whyUs: [
      '我希望加入{公司}，担任{职位}。',
      '这个岗位和我的经历相符：{亮点}',
      '我熟悉{技能}，希望在工作中继续用好它们，和团队一起成长。',
    ].join('\n'),
    strengths: [
      '我熟悉{技能}。',
      '{亮点}',
      '曾获得{奖项}。',
    ].join('\n'),
    careerPlan: [
      '入职后，我希望先在{职位}岗位上打好基础，把{技能}用到实际工作中。',
      '之后，我希望在{意向}方向上不断积累，承担更多责任。',
    ].join('\n'),
  },
  en: {
    coverLetter: [
      'I am applying for the {position} role at {company}.',
      '{intro}',
      '{highlight}',
      'I work with {skills}, and I would welcome the chance to bring them to your team.',
      'Thank you for considering my application.',
    ].join('\n'),
    whyUs: [
      'I would like to join {company} as {position}.',
      'The role fits what I have done so far: {highlight}',
      'I work with {skills} and want to keep growing them alongside your team.',
    ].join('\n'),
    strengths: [
      'I work with {skills}.',
      '{highlight}',
      'I have received {awards}.',
    ].join('\n'),
    careerPlan: [
      'In the first years I want to build a solid base as {position}, putting {skills} to work on real problems.',
      'After that I want to grow in {intention} and take on more responsibility.',
    ].join('\n'),
  },
};

/** Both languages' names for each placeholder. */
export const PLACEHOLDER_NAMES: Readonly<Record<string, string>> = {
  公司: 'company', company: 'company',
  职位: 'position', 職位: 'position', position: 'position', role: 'position',
  姓名: 'name', name: 'name',
  简介: 'intro', 簡介: 'intro', intro: 'intro',
  亮点: 'highlight', 亮點: 'highlight', highlight: 'highlight',
  技能: 'skills', skills: 'skills',
  奖项: 'awards', 獎項: 'awards', awards: 'awards',
  意向: 'intention', 意向職位: 'intention', intention: 'intention',
};
