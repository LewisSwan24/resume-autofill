import { describe, expect, it } from 'vitest';
import { SECTION_SYNONYMS, matchSection } from '../../../src/dictionary/sections';
import type { SectionKey } from '../../../src/schema/fieldKeys';

const ALL_SECTIONS: SectionKey[] = [
  'basics', 'contact', 'jobIntention', 'education', 'work', 'internship', 'projects',
  'campus', 'awards', 'languages', 'certificates', 'skills', 'family',
  'emergencyContact', 'referees', 'workRights', 'diversity', 'selfIntro', 'attachments', 'other',
];

describe('SECTION_SYNONYMS', () => {
  it('covers every section key with at least 3 synonyms in total', () => {
    for (const s of ALL_SECTIONS) expect(SECTION_SYNONYMS[s].length, s).toBeGreaterThanOrEqual(3);
  });
  it('has no key outside the SectionKey union', () => {
    expect(Object.keys(SECTION_SYNONYMS).sort()).toEqual([...ALL_SECTIONS].sort());
  });
  it('contains both zh and en text for every section', () => {
    for (const s of ALL_SECTIONS) {
      expect(SECTION_SYNONYMS[s].some((t) => /[\u4e00-\u9fff]/.test(t)), `${s} zh`).toBe(true);
      expect(SECTION_SYNONYMS[s].some((t) => /[a-z]/i.test(t)), `${s} en`).toBe(true);
    }
  });
});

describe('matchSection (zh)', () => {
  const cases: [string, SectionKey][] = [
    ['教育经历', 'education'],
    ['教育背景', 'education'],
    ['学历信息', 'education'],
    ['实习经历', 'internship'],
    ['工作经历', 'work'],
    ['工作经验', 'work'],
    ['项目经历', 'projects'],
    ['校园经历', 'campus'],
    ['获奖情况', 'awards'],
    ['语言能力', 'languages'],
    ['资格证书', 'certificates'],
    ['专业技能', 'skills'],
    ['家庭成员', 'family'],
    ['家庭情况', 'family'],
    ['紧急联系人', 'emergencyContact'],
    ['求职意向', 'jobIntention'],
    ['基本信息', 'basics'],
    ['联系方式', 'contact'],
    ['自我评价', 'selfIntro'],
    ['附件', 'attachments'],
    ['*教育经历', 'education'],
    ['教育经历：', 'education'],
    ['教育经历 1', 'education'],
    ['第1段 工作经历', 'work'],
  ];
  it.each(cases)('%s → %s', (title, section) => {
    const r = matchSection(title);
    expect(r?.section).toBe(section);
    expect(r?.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('matchSection (en)', () => {
  const cases: [string, SectionKey][] = [
    ['Education', 'education'],
    ['Academic history', 'education'],
    ['Internship', 'internship'],
    ['Internships', 'internship'],
    ['Employment history', 'work'],
    ['Work experience', 'work'],
    ['Projects', 'projects'],
    ['Extracurricular activities', 'campus'],
    ['Awards', 'awards'],
    ['Language skills', 'languages'],
    ['Certifications', 'certificates'],
    ['Skills', 'skills'],
    ['Family members', 'family'],
    ['Emergency contact', 'emergencyContact'],
    ['Emergency contact details', 'emergencyContact'],
    ['Referees', 'referees'],
    ['Work rights', 'workRights'],
    ['Diversity and inclusion', 'diversity'],
    ['Equal opportunity', 'diversity'],
    ['Personal details', 'basics'],
    ['Contact details', 'contact'],
    ['Job preferences', 'jobIntention'],
    ['Personal statement', 'selfIntro'],
    ['Attachments', 'attachments'],
    ['Additional information', 'other'],
    ['EDUCATION (required)', 'education'],
    ['Education 2', 'education'],
  ];
  it.each(cases)('%s → %s', (title, section) => {
    const r = matchSection(title);
    expect(r?.section).toBe(section);
    expect(r?.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('matchSection (negatives)', () => {
  it.each(['', '   ', 'Submit application', '提交', 'Terms and conditions', '确认', 'Step 3 of 5'])(
    '%j → null',
    (title) => {
      expect(matchSection(title)).toBeNull();
    },
  );
  it('keeps internship and work apart', () => {
    expect(matchSection('实习经历')?.section).not.toBe('work');
    expect(matchSection('工作经历')?.section).not.toBe('internship');
  });
});
