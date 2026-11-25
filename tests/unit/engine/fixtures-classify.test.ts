// Classification + plan of the three synthetic fixture pages (native / antd / Element Plus) in jsdom.
// Every row: label → expected field key (and, when the row has a `state` key, the value the plan would
// write must equal the fixture's expected.json). Full in-browser verification is Task 17.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AWARD_LEVELS, CITIES, DEGREES as ANTD_DEGREES, ENGLISH_LEVELS, ETHNICITIES, FOREIGN_LANGUAGES, PHONE_CODES,
  POLITICAL as ANTD_POLITICAL, SCHOOLS as ANTD_SCHOOLS,
} from '../../../fixtures/synthetic/antd/data';
import {
  ACADEMIC_DEGREES, DEGREES as EL_DEGREES, MARITAL, POLITICAL as EL_POLITICAL, SCHOOLS as EL_SCHOOLS,
} from '../../../fixtures/synthetic/element/data';
import type { FileData } from '../../../src/drivers/types';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema';
import { evaluate, loadExpected, type FixtureName, type Row } from './fixtureAsserts';
import { mountAntd, mountElement, mountNative, mountNativeFrame, mountQuestions } from './fixtureDom';

// Whole-page scans are slow in jsdom (evidence collection clones DOM); allow for a loaded CI box.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  document.body.innerHTML = '';
});

const labels = (opts: { label: string }[]) => opts.map((o) => o.label);
const resumes = createSampleProfile().resumes;
const resumeOf = (id: string) => resumes.find((r) => r.id === id)!;
const file = (name: string): FileData => ({ name, type: 'application/octet-stream', dataUrl: 'data:,' });

/** Runs scan → plan and checks every row against classification and expected.json. */
function verify(
  fixture: FixtureName,
  resumeId: string,
  rows: Row[],
  files: Record<string, FileData> = {},
) {
  const scan = scanDocument(document);
  const resume = resumeOf(resumeId);
  const plan = planFill(scan.contexts, scan.classifications, resume, files);
  const expected = loadExpected(fixture);
  const results = evaluate(scan, plan, rows);

  // Table: "label → fieldKey" as the engine sees it.
  const table = results.map((r) => `${r.row.section ?? '*'} | ${r.row.label}${r.row.index !== undefined ? ` #${r.row.index}` : ''} → ${r.key}`);
  const want = rows.map((r) => `${r.section ?? '*'} | ${r.label}${r.index !== undefined ? ` #${r.index}` : ''} → ${r.key}`);
  expect(table).toEqual(want);

  for (const r of results) {
    const where = `${r.row.label}${r.row.index !== undefined ? ` #${r.row.index}` : ''}`;
    if (r.row.key === null) {
      expect(r.outcome, `${where} must stay untouched`).not.toBe('step');
      continue;
    }
    if (r.row.state === undefined) continue;
    const exp = expected[r.row.state];
    expect(r.confidence, `${where} confidence`).toBeGreaterThanOrEqual(FILL_THRESHOLD - 1e-9);
    if (exp === '' || exp === undefined || (exp === false && r.value === undefined)) {
      // Expected to stay empty: no data, or the dropdown has no matching option.
      const untouched = r.value === undefined || (typeof r.value === 'string' && r.value.startsWith('<'));
      expect(untouched, `${where} should leave the field empty (got ${JSON.stringify(r.value)}, ${r.outcome})`).toBe(true);
    } else {
      expect(r.value, `${where} → ${r.row.state}`).toEqual(exp);
    }
  }
  return { scan, plan, results };
}

// ------------------------------------------------------------------------------------------- native

describe('native fixture (en-AU, sample-en)', () => {
  const edu = (index: number): Row[] => [
    { state: `education[${index}].institution`, label: 'Institution', section: 'education', index, key: 'education.school' },
    { state: `education[${index}].degree`, label: 'Degree', section: 'education', index, key: 'education.degree' },
    { state: `education[${index}].fieldOfStudy`, label: 'Field of study', section: 'education', index, key: 'education.major' },
    { state: `education[${index}].start`, label: 'Start', section: 'education', index, key: 'education.startDate' },
    { state: `education[${index}].end`, label: 'End', section: 'education', index, key: 'education.endDate' },
  ];
  const emp = (index: number): Row[] => [
    { state: `employment[${index}].jobTitle`, label: 'Job title', section: 'work', index, key: 'work.position' },
    { state: `employment[${index}].company`, label: 'Company', section: 'work', index, key: 'work.company' },
    { state: `employment[${index}].start`, label: 'Start', section: 'work', index, key: 'work.startDate' },
    { state: `employment[${index}].end`, label: 'End', section: 'work', index, key: 'work.endDate' },
    { state: `employment[${index}].current`, label: 'I currently work here', section: 'work', index, key: 'work.current' },
    { state: `employment[${index}].description`, label: 'Description', section: 'work', index, key: 'work.description' },
  ];
  const rows: Row[] = [
    { state: 'firstName', label: 'First name', key: 'basics.givenName' },
    { state: 'lastName', label: 'Last name', key: 'basics.familyName' },
    { state: 'preferredName', label: 'Preferred name', key: 'basics.preferredName' },
    { state: 'email', label: 'Email', key: 'contact.email' },
    { state: 'phoneCountryCode', label: 'Country code', key: 'contact.phoneCountryCode' },
    { state: 'mobileNumber', label: 'Mobile number', key: 'contact.phone' },
    { state: 'pronouns', label: 'Pronouns', key: 'basics.pronouns' },
    { state: 'street', label: 'Street', key: 'contact.addressStreet' },
    { state: 'suburb', label: 'Suburb/City', key: 'contact.addressCity' },
    { state: 'state', label: 'State', key: 'contact.addressProvince' },
    { state: 'postcode', label: 'Postcode', key: 'contact.postcode' },
    { state: 'linkedinUrl', label: 'linkedin url', key: 'contact.linkedin' },
    { state: 'githubProfile', label: 'GitHub profile URL', key: 'contact.github' },
    { state: 'workRights', label: 'Work rights in Australia', key: 'workRights.status' },
    { state: 'visaExpiry', label: 'Visa expiry date', key: 'workRights.visaExpiry' },
    {
      state: 'requiresSponsorship', label: 'Will you now or in the future require sponsorship?',
      key: 'workRights.requiresSponsorship',
    },
    ...edu(0), ...edu(1), ...emp(0), ...emp(1),
    { state: 'preferredLocation', label: 'Preferred location', key: 'jobIntention.cities' },
    { state: 'aboutYou', label: 'Tell us about yourself', key: 'misc.selfIntroduction' },
    { state: 'resume', label: 'Resume/CV', key: 'attachments.resume' },
    {
      state: 'indigenousStatus', label: 'Do you identify as Aboriginal or Torres Strait Islander?',
      key: 'diversity.indigenous',
    },
    { state: 'howDidYouHear', label: 'How did you hear about us?', key: 'jobIntention.howDidYouHear' },
    { state: 'verificationCode', label: 'Verification code', key: null },
    { state: 'privacyAgreed', label: 'I agree to the privacy policy', key: null },
  ];

  it('classifies every field and plans the expected values', () => {
    mountNative(2);
    const { scan } = verify('native', 'sample-en', rows, { 'sample-resume-en': file('Zhiyuan-Lin-Resume.pdf') });
    // Rows cover every control on the page.
    expect(scan.contexts).toHaveLength(rows.length);
  });

  it('classifies the same-origin iframe document on its own', () => {
    mountNativeFrame();
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resumeOf('sample-en'));
    const byLabel = Object.fromEntries(scan.contexts.map((c, i) => [c.evidence[0]!.text, scan.classifications[i]!.fieldKey]));
    expect(byLabel).toEqual({ 'Notice period': 'jobIntention.noticePeriod', 'Earliest start date': 'jobIntention.availableFrom' });
    const display = plan.steps.map((s) => (s.intent.kind === 'text' ? s.intent.text : s.intent.kind === 'date' ? s.intent.display : ''));
    expect(display).toEqual(['2 weeks', '2026-07']);
  });

  it('writes month inputs as YYYY-MM and the visa expiry as a full date', () => {
    mountNative(2);
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resumeOf('sample-en'));
    const intent = (key: string, index?: number) => {
      const i = scan.classifications.findIndex((c, n) => c.fieldKey === key && (index === undefined || scan.contexts[n]!.group?.index === index));
      return plan.steps.find((s) => s.fieldId === scan.contexts[i]!.control.id)!.intent;
    };
    expect(intent('workRights.visaExpiry')).toMatchObject({ kind: 'date', display: '2028-08-31', year: 2028, month: 8, day: 31 });
    expect(intent('education.startDate', 0)).toMatchObject({ kind: 'date', display: '2024-07', year: 2024, month: 7 });
    expect(intent('work.current', 0)).toEqual({ kind: 'check', checked: true });
  });
});

// ------------------------------------------------------------------------------------------- antd

describe('antd fixture (zh-CN, sample-zh)', () => {
  const edu: Row[] = [
    { state: 'education[0].school', label: '学校名称', section: 'education', index: 0, key: 'education.school', options: labels(ANTD_SCHOOLS) },
    { state: 'education[0].degree', label: '学历', section: 'education', index: 0, key: 'education.degree', options: labels(ANTD_DEGREES) },
    { state: 'education[0].major', label: '专业', section: 'education', index: 0, key: 'education.major' },
    { state: 'education[0].startDate', label: '入学时间', section: 'education', index: 0, key: 'education.startDate' },
    { state: 'education[0].endDate', label: '毕业时间', section: 'education', index: 0, key: 'education.endDate' },
    { state: 'education[0].gpa', label: 'GPA', section: 'education', index: 0, key: 'education.gpa' },
    { state: 'education[0].ranking', label: '专业排名', section: 'education', index: 0, key: 'education.ranking' },
  ];
  const intern = (i: number): Row[] => [
    { state: `internship[${i}].company`, label: '公司名称', section: 'internship', index: i, key: 'work.company' },
    { state: `internship[${i}].position`, label: '职位名称', section: 'internship', index: i, key: 'work.position' },
    { state: `internship[${i}].startDate`, label: '开始时间', section: 'internship', index: i, key: 'work.startDate' },
    { state: `internship[${i}].endDate`, label: '结束时间', section: 'internship', index: i, key: 'work.endDate' },
    { state: `internship[${i}].current`, label: '至今', section: 'internship', index: i, key: 'work.current' },
    { state: `internship[${i}].description`, label: '工作内容', section: 'internship', index: i, key: 'work.description' },
  ];
  const rows: Row[] = [
    { state: 'name', label: '姓名', key: 'basics.fullName' },
    { state: 'gender', label: '性别', key: 'basics.gender' },
    { state: 'birthDate', label: '出生日期', key: 'basics.birthDate' },
    { state: 'ethnicity', label: '民族', key: 'basics.ethnicity', options: labels(ETHNICITIES) },
    { state: 'politicalStatus', label: '政治面貌', key: 'basics.politicalStatus', options: labels(ANTD_POLITICAL) },
    { state: 'phoneCountryCode', label: '区号', key: 'contact.phoneCountryCode', options: labels(PHONE_CODES) },
    { state: 'phone', label: '手机号码', kind: 'text', key: 'contact.phone' },
    { state: 'email', label: '电子邮箱', key: 'contact.email' },
    { state: 'idNumber', label: '身份证号', key: 'basics.idNumber' },
    { state: 'wechat', label: '微信号', key: 'contact.wechat' },
    { state: 'qq', label: 'QQ', key: 'contact.qq' },
    { state: 'nativePlace', label: '籍贯', key: 'basics.nativePlace' },
    { state: 'currentLocation', label: '现居住地', key: 'basics.currentLocation' },
    { state: 'expectedPosition', label: '期望职位', key: 'jobIntention.positions' },
    { state: 'expectedCities', label: '期望城市', key: 'jobIntention.cities', options: labels(CITIES) },
    { state: 'acceptAdjustment', label: '是否服从调剂', key: 'jobIntention.acceptAdjustment' },
    ...edu, ...intern(0), ...intern(1),
    { state: 'englishLevel', label: '英语等级', key: 'languages.certificate', options: labels(ENGLISH_LEVELS) },
    { state: 'foreignLanguage', label: '外语语种', key: 'languages.language', options: labels(FOREIGN_LANGUAGES) },
    { state: 'award[0].name', label: '奖项名称', section: 'awards', key: 'awards.name' },
    { state: 'award[0].date', label: '获奖时间', section: 'awards', key: 'awards.date' },
    { state: 'award[0].level', label: '奖项级别', section: 'awards', key: 'awards.level', options: labels(AWARD_LEVELS) },
    { state: 'resume', label: '上传简历', key: 'attachments.resume' },
    { state: 'selfEvaluation', label: '自我评价', kind: 'textarea', key: 'misc.selfIntroduction' },
    { state: 'referrerId', label: '推荐人工号', key: null },
  ];

  it('classifies every field and plans the expected values', () => {
    mountAntd();
    const { scan } = verify('antd', 'sample-zh', rows, { 'sample-resume-zh': file('林知远-简历.pdf') });
    expect(scan.contexts).toHaveLength(rows.length);
  });

  it('uses a day picker for the birth date and fills the second entry from its own card', () => {
    mountAntd();
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resumeOf('sample-zh'));
    const at = (key: string, index?: number) => {
      const i = scan.classifications.findIndex((c, n) => c.fieldKey === key && (index === undefined || scan.contexts[n]!.group?.index === index));
      return plan.steps.find((s) => s.fieldId === scan.contexts[i]!.control.id);
    };
    expect(at('basics.birthDate')!.intent).toMatchObject({ kind: 'date', display: '2002-03-15', day: 15 });
    expect(at('work.company', 1)!.source).toBe('work[1].company');
    // 字节跳动 is current: no end date step, but the 至今 checkbox is ticked.
    expect(at('work.endDate', 1)).toBeUndefined();
    expect(plan.reports.find((r) => r.fieldKey === 'work.endDate' && r.outcome === 'no_data')).toBeDefined();
    expect(at('work.current', 1)!.intent).toEqual({ kind: 'check', checked: true });
  });

  it('reports the cards the resume needs: 2 education entries for 1 card, 2 internships for 2 cards', () => {
    mountAntd();
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resumeOf('sample-zh'));
    const demand = Object.fromEntries(plan.cardDemand.map((d) => [d.section, `${d.have}/${d.need}`]));
    expect(demand).toMatchObject({ education: '1/2', internship: '2/2', awards: '1/1', languages: '1/1' });
  });
});

// ------------------------------------------------------------------------------------------- Element Plus

describe('Element Plus fixture (zh-CN, sample-zh)', () => {
  const edu = (i: number): Row[] => [
    { state: `education[${i}].school`, label: '学校', section: 'education', index: i, key: 'education.school', options: EL_SCHOOLS },
    { state: `education[${i}].degree`, label: '学历', section: 'education', index: i, key: 'education.degree', options: EL_DEGREES },
    { state: `education[${i}].academicDegree`, label: '学位', section: 'education', index: i, key: 'education.degree', options: ACADEMIC_DEGREES },
    { state: `education[${i}].major`, label: '专业', section: 'education', index: i, key: 'education.major' },
    { state: `education[${i}].startDate`, label: '开始时间', section: 'education', index: i, key: 'education.startDate' },
    { state: `education[${i}].endDate`, label: '结束时间', section: 'education', index: i, key: 'education.endDate' },
  ];
  const intern = (i: number): Row[] => [
    { state: `internship[${i}].company`, label: '公司', section: 'internship', index: i, key: 'work.company' },
    { state: `internship[${i}].position`, label: '岗位', section: 'internship', index: i, key: 'work.position' },
    { state: `internship[${i}].startDate`, label: '开始时间', section: 'internship', index: i, key: 'work.startDate' },
    { state: `internship[${i}].endDate`, label: '结束时间', section: 'internship', index: i, key: 'work.endDate' },
    { state: `internship[${i}].current`, label: '是否在职', section: 'internship', index: i, key: 'work.current' },
    { state: `internship[${i}].description`, label: '工作描述', section: 'internship', index: i, key: 'work.description' },
  ];
  const family = (i: number): Row[] => [
    { state: `family[${i}].relationship`, label: '关系', section: 'family', index: i, key: 'family.relationship' },
    { state: `family[${i}].name`, label: '姓名', section: 'family', index: i, key: 'family.name' },
    { state: `family[${i}].employer`, label: '工作单位', section: 'family', index: i, key: 'family.employer' },
    { state: `family[${i}].position`, label: '职务', section: 'family', index: i, key: 'family.position' },
  ];
  const rows: Row[] = [
    { state: 'name', label: '姓名', section: 'basics', key: 'basics.fullName' },
    { state: 'gender', label: '性别', key: 'basics.gender' },
    { state: 'birthMonth', label: '出生年月', key: 'basics.birthDate' },
    { state: 'politicalStatus', label: '政治面貌', key: 'basics.politicalStatus', options: EL_POLITICAL },
    { state: 'maritalStatus', label: '婚姻状况', key: 'basics.maritalStatus', options: MARITAL },
    { state: 'phone', label: '手机', key: 'contact.phone' },
    { state: 'email', label: '邮箱', key: 'contact.email' },
    { state: 'household', label: '户口所在地', key: 'basics.household' },
    { state: 'studentOrigin', label: '生源地', key: 'basics.studentOrigin' },
    ...edu(0), ...edu(1), ...intern(0), ...intern(1),
    { state: 'project[0].name', label: '项目名称', section: 'projects', key: 'projects.name' },
    { state: 'project[0].role', label: '担任角色', section: 'projects', key: 'projects.role' },
    { state: 'project[0].description', label: '项目描述', section: 'projects', key: 'projects.description' },
    ...family(0), ...family(1),
    { state: 'emergencyContact.name', label: '姓名', section: 'emergencyContact', key: 'emergencyContact.name' },
    { state: 'emergencyContact.phone', label: '电话', section: 'emergencyContact', key: 'emergencyContact.phone' },
    { state: 'acceptRelocation', label: '是否接受外派', key: 'jobIntention.acceptRelocation' },
    { state: 'photo', label: '照片', key: 'attachments.photo' },
    { state: 'selfIntroduction', label: '自我介绍', key: 'misc.selfIntroduction' },
  ];

  it('classifies every field and plans the expected values', () => {
    mountElement(2);
    const { scan } = verify('element', 'sample-zh', rows, { 'sample-photo': file('photo.png') });
    expect(scan.contexts).toHaveLength(rows.length);
  });

  it('writes the month picker as 2002-03 without a day and ticks 是否在职 only for the current entry', () => {
    mountElement(2);
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resumeOf('sample-zh'));
    const stepFor = (key: string, index?: number) => {
      const i = scan.classifications.findIndex((c, n) => c.fieldKey === key && (index === undefined || scan.contexts[n]!.group?.index === index));
      return plan.steps.find((s) => s.fieldId === scan.contexts[i]!.control.id);
    };
    const birth = stepFor('basics.birthDate')!.intent;
    expect(birth).toMatchObject({ kind: 'date', display: '2002-03' });
    expect(birth).not.toHaveProperty('day');
    expect(stepFor('work.current', 0)!.intent).toEqual({ kind: 'check', checked: false });
    expect(stepFor('work.current', 1)!.intent).toEqual({ kind: 'check', checked: true });
  });

  it('needs 2 internship cards when the page offers 1 (添加实习经历)', () => {
    mountElement(1);
    const scan = scanDocument(document);
    const plan = planFill(scan.contexts, scan.classifications, resumeOf('sample-zh'));
    const internship = plan.cardDemand.find((d) => d.section === 'internship')!;
    expect(internship.have).toBe(1);
    expect(internship.need).toBe(2);
    expect(plan.cardDemand.find((d) => d.section === 'education')).toMatchObject({ have: 2, need: 2 });
    expect(plan.cardDemand.find((d) => d.section === 'family')).toMatchObject({ have: 2, need: 2 });
  });
});

// ------------------------------------------------------------------------------------ application questions

describe('application questions, zh-CN (sample-zh)', () => {
  const rows: Row[] = [
    { state: 'canTravel', label: '能否出差', key: 'questions.canTravel' },
    { state: 'shiftWork', label: '是否接受轮班', key: 'questions.shiftWork' },
    { state: 'overtime', label: '是否接受加班', key: 'questions.overtime' },
    { state: 'earlyInternship', label: '是否需要/可以提前实习', key: 'questions.earlyInternship' },
    { state: 'internshipDaysPerWeek', label: '每周可实习天数', key: 'questions.internshipDaysPerWeek' },
    { state: 'internshipMonths', label: '可实习时长（月）', key: 'questions.internshipMonths' },
    { state: 'offerCount', label: '已获得几份其他公司offer', key: 'questions.offerCount' },
    { state: 'offerSalaryRange', label: '已获得offer薪资范围', key: 'questions.offerSalaryRange' },
    { state: 'relativesAtCompany', label: '是否有亲友在本公司就职', key: 'questions.relativesAtCompany' },
    { state: 'workedHereBefore', label: '是否曾在本公司工作', key: 'questions.workedHereBefore' },
    { state: 'campusAmbassador', label: '是否愿意成为校园大使', key: 'questions.campusAmbassador' },
    { state: 'graduateStatus', label: '应届/往届', key: 'questions.graduateStatus' },
    { state: 'furtherStudyPlan', label: '是否计划升学深造或考公/考编', key: 'questions.furtherStudyPlan' },
    { state: 'englishWorkingLanguage', label: '英语是否可作为工作语言', key: 'questions.englishWorkingLanguage' },
    { state: 'driversLicence', label: '是否持有驾驶证', key: 'questions.driversLicence' },
    { state: 'yearsExperience', label: '工作年限', key: 'questions.yearsExperience' },
    { label: '推荐人工号', key: null },
    { label: '推荐码', key: null },
  ];

  it('answers every question as expected.json says, and leaves the staff number and the code alone', () => {
    mountQuestions('zh');
    verify('questions-zh', 'sample-zh', rows);
  });
});

describe('screening questions, en-AU (sample-en)', () => {
  const rows: Row[] = [
    { state: 'canTravel', label: 'Are you willing to travel for work?', key: 'questions.canTravel' },
    { state: 'shiftWork', label: 'Are you able to work shifts, including weekends?', key: 'questions.shiftWork' },
    { state: 'overtime', label: 'Are you willing to work overtime?', key: 'questions.overtime' },
    { state: 'canWorkOnsite', label: 'Can you work on-site?', key: 'questions.canWorkOnsite' },
    { state: 'workArrangement', label: 'Preferred work arrangement', key: 'questions.workArrangement' },
    { state: 'offerCount', label: 'How many job offers do you currently hold?', key: 'questions.offerCount' },
    { state: 'relativesAtCompany', label: 'Do you have any relatives or friends working at the company?', key: 'questions.relativesAtCompany' },
    { state: 'workedHereBefore', label: 'Have you previously worked for this company?', key: 'questions.workedHereBefore' },
    { state: 'securityClearance', label: 'What level of security clearance do you currently hold?', key: 'questions.securityClearance' },
    { state: 'driversLicence', label: "Do you hold a current driver's licence?", key: 'questions.driversLicence' },
    { state: 'yearsExperience', label: 'How many years of professional experience do you have?', key: 'questions.yearsExperience' },
    { state: 'yearsLeading', label: 'How many years of experience do you have leading teams?', key: 'questions.yearsLeading' },
    { state: 'englishWorkingLanguage', label: 'Are you comfortable using English as your working language?', key: 'questions.englishWorkingLanguage' },
    { state: 'graduateStatus', label: 'Graduate status', key: 'questions.graduateStatus' },
    { label: 'Referral code', key: null },
    { label: 'Earliest availability for a video call', key: null },
  ];

  it('answers every question as expected.json says, and leaves the code and the call alone', () => {
    mountQuestions('en');
    verify('questions-en', 'sample-en', rows);
  });
});
