// How forms word the application questions, in Chinese and English, and the questions they must not be taken for.
import { describe, expect, it } from 'vitest';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { scanDocument } from '../../../src/engine/scan';

const YES_NO = '<select id="q"><option></option><option>是</option><option>否</option></select>';
const BOX = '<input id="q" type="text">';

function classify(label: string, control = BOX) {
  document.body.innerHTML = `<form><div class="field"><label for="q">${label}</label>${control}</div></form>`;
  return scanDocument(document).classifications[0]!;
}

const asked: [string, string, string?][] = [
  ['能否出差', 'questions.canTravel', YES_NO],
  ['是否接受出差', 'questions.canTravel', YES_NO],
  ['Are you willing to travel for work?', 'questions.canTravel', YES_NO],
  ['是否接受轮班', 'questions.shiftWork', YES_NO],
  ['能否接受倒班', 'questions.shiftWork', YES_NO],
  ['Are you able to work shifts, including weekends?', 'questions.shiftWork', YES_NO],
  ['是否接受加班', 'questions.overtime', YES_NO],
  ['Are you willing to work overtime?', 'questions.overtime', YES_NO],
  ['Can you work on-site?', 'questions.canWorkOnsite', YES_NO],
  ['是否可以到岗办公', 'questions.canWorkOnsite', YES_NO],
  ['Preferred work arrangement', 'questions.workArrangement'],
  ['工作方式', 'questions.workArrangement'],
  ['是否需要/可以提前实习', 'questions.earlyInternship', YES_NO],
  ['每周可实习天数', 'questions.internshipDaysPerWeek'],
  ['How many days per week can you intern?', 'questions.internshipDaysPerWeek'],
  ['可实习时长（月）', 'questions.internshipMonths'],
  ['已获得几份其他公司offer', 'questions.offerCount'],
  ['How many job offers do you currently hold?', 'questions.offerCount'],
  ['已获得offer薪资范围', 'questions.offerSalaryRange'],
  ['目前薪资', 'questions.currentSalary'],
  ['What is your current salary?', 'questions.currentSalary'],
  ['是否有亲友在本公司就职', 'questions.relativesAtCompany', YES_NO],
  ['是否有亲友就职', 'questions.relativesAtCompany', YES_NO],
  ['Do you have any relatives or friends working at the company?', 'questions.relativesAtCompany', YES_NO],
  ['亲友姓名及关系', 'questions.relativesDetail'],
  ['是否曾在本公司工作', 'questions.workedHereBefore', YES_NO],
  ['Have you previously worked for this company?', 'questions.workedHereBefore', YES_NO],
  ['内推人姓名', 'questions.referrerName'],
  ['Who referred you to this role?', 'questions.referrerName'],
  ['是否愿意成为校园大使', 'questions.campusAmbassador', YES_NO],
  ['应届/往届', 'questions.graduateStatus'],
  ['是否计划升学深造或考公/考编', 'questions.furtherStudyPlan', YES_NO],
  ['What level of security clearance do you currently hold?', 'questions.securityClearance'],
  ['是否持有驾驶证', 'questions.driversLicence', YES_NO],
  ["Do you hold a current driver's licence?", 'questions.driversLicence', YES_NO],
  ['英语是否可作为工作语言', 'questions.englishWorkingLanguage', YES_NO],
  ['工作年限', 'questions.yearsExperience'],
  ['How many years of professional experience do you have?', 'questions.yearsExperience'],
  ['带团队年限', 'questions.yearsLeading'],
  ['How many years of experience do you have leading teams?', 'questions.yearsLeading'],
  ['Which best describes your background?', 'questions.background'],
];

describe('application questions', () => {
  it.each(asked)('"%s" is %s', (label, key, control) => {
    const c = classify(label, control);
    expect(c.fieldKey).toBe(key);
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });
});

describe('the questions they must not be taken for', () => {
  it.each([
    ['期望工作地点', 'jobIntention.cities'],
    ['期望薪资', 'jobIntention.salaryMin'],
    ['Expected salary', 'jobIntention.salaryMin'],
    ['紧急联系人姓名', 'emergencyContact.name'],
    ['可到岗时间', 'jobIntention.availableFrom'],
    ['是否接受调剂', 'jobIntention.acceptAdjustment'],
  ])('"%s" stays %s', (label, key) => {
    expect(classify(label).fieldKey).toBe(key);
  });
});

describe('fields the resume already had, asked in longer words', () => {
  it('"Your earliest availability to start employment" is the start date', () => {
    const c = classify('Your earliest availability to start employment');
    expect(c.fieldKey).toBe('jobIntention.availableFrom');
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('an availability for a call or an interview is not the start date', () => {
    for (const label of ['Earliest availability for a video call', 'When are you available for an interview?']) {
      expect(classify(label).fieldKey, label).not.toBe('jobIntention.availableFrom');
    }
  });
});

describe('a referral code or staff number', () => {
  it.each(['推荐人工号', '推荐码', 'Referral code', 'Referrer employee ID'])('"%s" is not the referrer’s name', (label) => {
    expect(classify(label).fieldKey).not.toBe('questions.referrerName');
  });
});
