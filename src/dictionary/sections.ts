// Section-title synonyms (zh + en) and a fuzzy section-title matcher.
import { labelSimilarity } from './similarity';
import { normalizeLabel } from './normalize';
import type { SectionKey } from '../schema/fieldKeys';

export const SECTION_SYNONYMS: Record<SectionKey, string[]> = {
  basics: [
    '基本信息', '个人信息', '基础信息', '个人资料', '个人基本信息', '申请人信息', '求职者信息',
    'Personal details', 'Personal information', 'Basic information', 'Basic details', 'About you', 'Your details',
    'Applicant details',
  ],
  contact: [
    '联系方式', '联系信息', '通讯信息', '联系地址', '通讯方式',
    'Contact details', 'Contact information', 'Contact info', 'Address details', 'Contact',
  ],
  jobIntention: [
    '求职意向', '应聘信息', '应聘意向', '申请职位', '应聘职位', '意向岗位', '岗位意向', '期望职位', '志愿信息',
    'Job preferences', 'Job intention', 'Position applied for', 'Role preferences', 'Application details',
    'Position details', 'Desired position', 'Preferences', 'Your preferences',
  ],
  education: [
    '教育经历', '教育背景', '学历信息', '学习经历', '教育信息', '学历教育', '学历学位', '教育情况',
    'Education', 'Academic history', 'Education history', 'Educational background', 'Academic background',
    'Qualifications', 'Education details',
  ],
  work: [
    '工作经历', '工作经验', '工作履历', '职业经历', '工作情况', '就业经历',
    'Employment history', 'Work experience', 'Work history', 'Employment', 'Professional experience',
    'Career history',
  ],
  internship: [
    '实习经历', '实习经验', '实习情况', '实习信息', '实践实习',
    'Internship', 'Internships', 'Internship experience', 'Intern experience', 'Vacation work',
  ],
  projects: [
    '项目经历', '项目经验', '项目经验与成果', '项目情况', '科研项目', '项目信息',
    'Projects', 'Project experience', 'Project history', 'Key projects', 'Personal projects',
  ],
  campus: [
    '校园经历', '校园活动', '社会实践', '社团经历', '学生干部经历', '实践经历', '校内经历', '课外活动',
    'Campus activities', 'Campus experience', 'Extracurricular activities', 'Extracurriculars',
    'Leadership and activities', 'Volunteering', 'Student activities',
  ],
  awards: [
    '获奖情况', '获奖经历', '奖项荣誉', '荣誉奖励', '奖励荣誉', '所获荣誉', '荣誉奖项', '奖学金情况',
    'Awards', 'Honours', 'Honors', 'Honours and awards', 'Awards and achievements', 'Achievements',
    'Scholarships and awards',
  ],
  languages: [
    '语言能力', '外语能力', '语言水平', '外语水平', '语言技能', '语言信息',
    'Languages', 'Language skills', 'Language proficiency', 'Languages spoken', 'Foreign languages',
  ],
  certificates: [
    '证书', '资格证书', '证书资质', '技能证书', '职业资格', '获得证书', '证书信息',
    'Certificates', 'Certifications', 'Licences and certifications', 'Licenses and certifications',
    'Professional certifications', 'Professional licences',
  ],
  skills: [
    '技能', '专业技能', '技能特长', '技能清单', '技能与特长', '个人技能', '职业技能',
    'Skills', 'Technical skills', 'Key skills', 'Skills and abilities', 'Core competencies', 'Skill set',
  ],
  family: [
    '家庭成员', '家庭情况', '家庭信息', '家庭主要成员', '家庭关系', '主要社会关系', '亲属信息',
    '家属', '家属信息', '直系亲属', '家庭及社会关系', '家庭成员及社会关系', '父母信息',
    'Family members', 'Family details', 'Family information', 'Family background', 'Family',
    'Parent', 'Parents', 'Guardian', 'Guardians', 'Parent details', 'Guardian details',
  ],
  emergencyContact: [
    '紧急联系人', '紧急联络人', '应急联系人', '紧急联系人信息', '紧急联系方式', '联系人信息', '联系人',
    'Emergency contact', 'Emergency contacts', 'Emergency contact details', 'Emergency contact information',
    'Next of kin',
  ],
  referees: [
    '推荐人', '证明人', '推荐人信息', '证明人信息', '工作推荐人', '推荐信息',
    'Referees', 'References', 'Referee details', 'Professional references', 'Work references',
  ],
  workRights: [
    '工作权利', '工作签证', '工作许可', '签证信息', '工作资格', '工作签证信息', '身份与签证',
    'Work rights', 'Work authorisation', 'Work authorization', 'Visa status', 'Visa details', 'Right to work',
    'Visa and work rights', 'Work eligibility',
  ],
  diversity: [
    '多元化', '多元与包容', '多样性与包容', '平等机会', '多元化调查', '多元化信息', '平等就业机会',
    'Diversity', 'Diversity and inclusion', 'Diversity & inclusion', 'Equal opportunity', 'Equal employment opportunity',
    'EEO', 'Diversity information',
  ],
  selfIntro: [
    '自我评价', '自我介绍', '个人简介', '个人陈述', '个人总结', '自我描述', '个人评价', '自荐信',
    'Personal statement', 'About me', 'Self introduction', 'Self-introduction', 'Professional summary',
    'Cover letter', 'Tell us about yourself', 'Personal summary',
  ],
  attachments: [
    '附件', '附件上传', '上传附件', '简历附件', '文件上传', '材料上传', '上传简历',
    'Attachments', 'Documents', 'Upload documents', 'Supporting documents', 'File uploads', 'Upload resume',
  ],
  other: [
    '其他信息', '其它信息', '其他', '补充信息', '附加信息', '更多信息', '其他情况',
    'Other information', 'Additional information', 'Other details', 'Additional details', 'Other', 'Miscellaneous',
  ],
};

export interface SectionMatch {
  section: SectionKey;
  confidence: number;
}

const MIN_SECTION_CONFIDENCE = 0.8;

// "第1段", "第二条", leading "1.", trailing " 2" / "#2" are card numbering, not title text.
function stripNumbering(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/第\s*[一二三四五六七八九十\d]+\s*[段条项个份]/g, ' ')
    .replace(/^\s*\d+\s*[.、)]\s*/, '')
    .replace(/\s*#?\d+\s*$/, '');
}

/** Best-matching section for a heading text, or null when nothing reaches confidence 0.8. */
/** Sections whose name, phone and address are another person's. */
export const ABOUT_SOMEONE_ELSE: ReadonlySet<SectionKey> = new Set<SectionKey>(['referees', 'family', 'emergencyContact']);

/** A question that reads like a section's name. */
const NOT_A_SECTION = /^(?:family name|家庭住址|家庭地址)$/;

export function matchSection(title: string): SectionMatch | null {
  const t = normalizeLabel(stripNumbering(title));
  if (!t || NOT_A_SECTION.test(t)) return null;
  let best: SectionMatch | null = null;
  for (const [section, synonyms] of Object.entries(SECTION_SYNONYMS) as [SectionKey, string[]][]) {
    for (const syn of synonyms) {
      const confidence = labelSimilarity(t, syn);
      if (confidence >= MIN_SECTION_CONFIDENCE && (!best || confidence > best.confidence)) {
        best = { section, confidence };
      }
    }
  }
  return best;
}
