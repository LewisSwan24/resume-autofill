import { scanDocument } from '../../../src/engine/scan';
import { describe, expect, it } from 'vitest';
import {
  FIELD_SYNONYMS, NEVER_FILL, allSynonyms, isExactOnlySynonym, isExcluded, isNeverFill,
} from '../../../src/dictionary/fields';
import { labelSimilarity } from '../../../src/dictionary/similarity';
import { FIELD_KEYS } from '../../../src/schema/fieldKeys';

describe('FIELD_SYNONYMS coverage', () => {
  it('has an entry for every FIELD_KEY (incl. derived) and nothing unknown', () => {
    const keys = FIELD_KEYS.map((d) => d.key).sort();
    expect(Object.keys(FIELD_SYNONYMS).sort()).toEqual(keys);
  });

  it('every non-derived key plus basics.fullName and contact.phoneFull exists', () => {
    for (const d of FIELD_KEYS.filter((k) => !k.derived)) expect(FIELD_SYNONYMS[d.key], d.key).toBeDefined();
    expect(FIELD_SYNONYMS['basics.fullName']).toBeDefined();
    expect(FIELD_SYNONYMS['contact.phoneFull']).toBeDefined();
  });

  it('every key has >= 3 synonyms in total, with both zh and en entries', () => {
    for (const { key } of FIELD_KEYS) {
      const e = FIELD_SYNONYMS[key]!;
      expect(e.zh.length + e.en.length, key).toBeGreaterThanOrEqual(3);
      expect(e.zh.length, `${key} zh`).toBeGreaterThanOrEqual(2);
      expect(e.en.length, `${key} en`).toBeGreaterThanOrEqual(2);
    }
  });

  it('zh entries contain CJK, en entries contain latin letters and no CJK', () => {
    for (const [key, e] of Object.entries(FIELD_SYNONYMS)) {
      for (const s of e.zh) expect(/[\u4e00-\u9fff]|^[a-z]+$/i.test(s), `${key}: ${s}`).toBe(true);
      for (const s of e.en) {
        expect(/[a-z]/i.test(s), `${key}: ${s}`).toBe(true);
        expect(/[\u4e00-\u9fff]/.test(s), `${key}: ${s}`).toBe(false);
      }
    }
  });

  it('has no empty or duplicate synonyms within a key', () => {
    for (const [key, e] of Object.entries(FIELD_SYNONYMS)) {
      const all = [...e.zh, ...e.en].map((s) => s.trim().toLowerCase());
      expect(all.every(Boolean), key).toBe(true);
      expect(new Set(all).size, `${key} duplicates`).toBe(all.length);
    }
  });

  it('exclude lists are non-empty strings when present', () => {
    for (const [key, e] of Object.entries(FIELD_SYNONYMS)) {
      for (const x of e.exclude ?? []) expect(x.trim().length, `${key} exclude`).toBeGreaterThan(0);
    }
  });
});

describe('FIELD_SYNONYMS required content', () => {
  const required: [string, string][] = [
    ['contact.addressCity', 'Suburb'], ['contact.addressCity', 'City'], ['contact.addressCity', 'Town'],
    ['contact.addressProvince', 'State'], ['contact.addressProvince', 'State/Territory'],
    ['basics.givenName', 'First name'], ['basics.givenName', 'Given name(s)'], ['basics.givenName', '名'],
    ['basics.familyName', 'Last name'], ['basics.familyName', 'Surname'], ['basics.familyName', '姓'],
    ['education.major', 'Field of study'], ['education.major', '专业'],
    ['education.school', 'Institution'], ['education.school', 'School'], ['education.school', 'University'],
    ['education.school', '学校'], ['education.school', '毕业院校'],
    ['work.position', 'Job title'], ['work.position', 'Position'], ['work.position', '职位'], ['work.position', '岗位'],
    ['jobIntention.noticePeriod', 'Notice period'],
    ['jobIntention.availableFrom', 'Earliest start date'], ['jobIntention.availableFrom', '到岗时间'],
    ['misc.selfIntroduction', 'Tell us about yourself'], ['misc.selfIntroduction', '自我评价'],
    ['misc.selfIntroduction', '自我介绍'],
    ['attachments.resume', 'Resume/CV'], ['attachments.resume', '上传简历'], ['attachments.resume', '简历附件'],
    ['attachments.photo', '照片'], ['attachments.photo', 'Photo'],
    ['diversity.indigenous', 'Aboriginal or Torres Strait Islander'],
    ['jobIntention.howDidYouHear', 'How did you hear about us'],
    ['workRights.requiresSponsorship', 'Require sponsorship'],
    ['workRights.status', 'Work rights'],
    ['work.current', 'I currently work here'], ['work.current', '至今'], ['work.current', '是否在职'],
    ['jobIntention.acceptAdjustment', '是否服从调剂'],
    ['jobIntention.acceptRelocation', '是否接受外派'], ['jobIntention.acceptRelocation', 'Relocate'],
    ['basics.nativePlace', '籍贯'], ['basics.currentLocation', '现居住地'],
    ['basics.currentLocation', '当前所在地'], ['basics.household', '户口所在地'],
    ['basics.studentOrigin', '生源地'], ['languages.certificate', '英语等级'],
    ['education.ranking', '专业排名'], ['education.degree', '学历'], ['education.degree', '学位'],
    ['contact.email', '确认邮箱'], ['contact.email', 'Confirm email'],
  ];
  it.each(required)('%s includes %j', (key, syn) => {
    const e = FIELD_SYNONYMS[key]!;
    const norm = (s: string) => s.trim().toLowerCase();
    expect([...e.zh, ...e.en].map(norm)).toContain(norm(syn));
  });
});

describe('allSynonyms', () => {
  it('concatenates zh and en', () => {
    const e = FIELD_SYNONYMS['contact.postcode']!;
    expect(allSynonyms('contact.postcode')).toEqual([...e.zh, ...e.en]);
  });
  it('returns [] for unknown keys', () => {
    expect(allSynonyms('nope.nothing')).toEqual([]);
  });
});

describe('isExcluded', () => {
  it('basics.familyName excludes family-member wording', () => {
    expect(isExcluded('basics.familyName', '家庭成员姓名')).toBe(true);
    expect(isExcluded('basics.familyName', 'Family member name')).toBe(true);
    expect(isExcluded('basics.familyName', 'Family name')).toBe(false);
    expect(isExcluded('basics.familyName', '姓')).toBe(false);
  });
  it('basics.fullName excludes company/school names', () => {
    expect(isExcluded('basics.fullName', '公司名称')).toBe(true);
    expect(isExcluded('basics.fullName', 'Company name')).toBe(true);
    expect(isExcluded('basics.fullName', 'First name')).toBe(true);
    expect(isExcluded('basics.fullName', 'Full name')).toBe(false);
  });
  it('is false for keys without exclusions and unknown keys', () => {
    expect(isExcluded('contact.wechat', 'anything')).toBe(false);
    expect(isExcluded('unknown.key', 'anything')).toBe(false);
  });
  it('uses normalized text (full-width, asterisks)', () => {
    expect(isExcluded('basics.familyName', '＊家庭成员')).toBe(true);
  });
  it('email address is not a postal address', () => {
    expect(isExcluded('contact.addressFull', 'Email address')).toBe(true);
    expect(isExcluded('contact.addressFull', 'Residential address')).toBe(false);
  });
});

describe('isExactOnlySynonym', () => {
  it('flags 1-char CJK and <=2-char latin synonyms', () => {
    expect(isExactOnlySynonym('名')).toBe(true);
    expect(isExactOnlySynonym('姓')).toBe(true);
    expect(isExactOnlySynonym('省')).toBe(true);
    expect(isExactOnlySynonym('QQ')).toBe(true);
    expect(isExactOnlySynonym('姓名')).toBe(false);
    expect(isExactOnlySynonym('Email')).toBe(false);
  });
});

describe('NEVER_FILL', () => {
  it('lists captcha, password and consent wording in both languages', () => {
    const all = [...NEVER_FILL.zh, ...NEVER_FILL.en].map((s) => s.toLowerCase());
    for (const w of ['captcha', 'verification code', '验证码', 'password', '密码', 'consent', 'agree', '同意', 'i agree', 'privacy policy', '声明']) {
      expect(all, w).toContain(w);
    }
  });

  const never = [
    'Captcha', 'Please enter the verification code', '验证码', '短信验证码', '图形验证码',
    'Password', 'Confirm password', '密码', '确认密码', '登录密码',
    'I consent to the collection of my data', 'I agree to the Terms and Conditions',
    'I agree', '我已阅读并同意《隐私政策》', '同意用户协议', 'Privacy policy', '声明', '本人声明以上信息属实',
    'Email verification code',
  ];
  it.each(never)('%j is never-fill', (label) => {
    expect(isNeverFill(label)).toBe(true);
  });

  const fine = [
    'Email', '邮箱', 'First name', '姓名', 'Postcode', '邮政编码', 'Passport number', '护照号',
    'Tell us about yourself', '自我评价', 'Phone', 'Position', '职位',
    '是否同意调剂', '是否服从调剂', 'Are you willing to relocate?', 'Do you require sponsorship?',
  ];
  it.each(fine)('%j is fillable', (label) => {
    expect(isNeverFill(label)).toBe(false);
  });

  it('is robust to decoration (asterisk, full-width, case)', () => {
    expect(isNeverFill('*验证码：')).toBe(true);
    expect(isNeverFill('ＰＡＳＳＷＯＲＤ')).toBe(true);
  });
});

describe('a declaration inside a question that is otherwise ordinary', () => {
  it.each([
    'Require visa sponsorship? I declare this is true',
    'I certify that I have work rights in Australia',
    'I confirm I will not need sponsorship',
    'I acknowledge the background check',
    '本人声明无需工作签证担保 sponsor',
  ])('never fills "%s"', (label) => {
    expect(isNeverFill(label)).toBe(true);
  });

  it.each(['Do you require visa sponsorship?', 'Do you have work rights in Australia?', 'Are you willing to relocate?'])(
    'still answers "%s"',
    (label) => {
      expect(isNeverFill(label)).toBe(false);
    },
  );
});

describe('synonym sanity vs similarity', () => {
  it('"Surname" is closer to familyName than to givenName', () => {
    const best = (key: string) => Math.max(...allSynonyms(key).map((s) => labelSimilarity('Surname', s)));
    expect(best('basics.familyName')).toBeGreaterThan(best('basics.givenName'));
  });
});

describe('questions that lost their fuzzy match to the small-words check', () => {
  const scoreOf = (label: string) => {
    document.body.innerHTML = `<label for="q">${label}</label><select id="q"><option>Yes</option><option>No</option></select>`;
    const { classifications } = scanDocument(document);
    return classifications[0]!;
  };

  it('a salary expectation stays a question for the applicant: it could be either end of a range', () => {
    const c = scoreOf('What are your salary expectations?');
    expect(c.fieldKey).toMatch(/^jobIntention\.salaryM(in|ax)$/);
    expect(c.confidence).toBeLessThan(0.75);
    expect(c.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it.each(['Do you have full legal working rights within this country?', 'What are your current work rights in this country?'])('"%s" is about work rights', (label) => {
    expect(scoreOf(label).fieldKey).toBe('workRights.hasFullWorkRights');
  });

  it('a question about work rights and sponsorship at once goes to the applicant', () => {
    const c = scoreOf('Do you have full legal working rights within this country and do not require further visa sponsorship now or in the future?');
    expect(c.fieldKey).toMatch(/^workRights\./);
    expect(c.confidence).toBeLessThan(0.75);
    expect(c.confidence).toBeGreaterThanOrEqual(0.5);
  });
});
