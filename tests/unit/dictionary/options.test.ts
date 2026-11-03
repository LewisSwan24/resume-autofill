import { describe, expect, it } from 'vitest';
import { OPTION_SYNONYMS, isPlaceholderOption, matchOption, resolveCode } from '../../../src/dictionary/options';
import type { OptionInfo } from '../../../src/engine/types';
import { ENUM_DOMAINS, ENUM_VALUES } from '../../../src/schema/fieldKeys';

const opts = (...labels: string[]): OptionInfo[] => labels.map((label) => ({ label }));

/** Convenience: label of the matched option, or the status when not matched. */
function pick(domain: string | null, value: string | string[] | boolean, options: OptionInfo[]): string {
  const r = matchOption(domain, value, options);
  return r.status === 'matched' ? options[r.index]!.label : r.status;
}

describe('OPTION_SYNONYMS structure', () => {
  it('covers every enum domain from fieldKeys with exactly the canonical codes', () => {
    for (const d of ENUM_DOMAINS) {
      expect(OPTION_SYNONYMS[d], d).toBeDefined();
      expect(Object.keys(OPTION_SYNONYMS[d]!).sort(), d).toEqual([...ENUM_VALUES[d]!].sort());
    }
  });
  it('has the extra languageCert and pronouns domains', () => {
    expect(Object.keys(OPTION_SYNONYMS.languageCert!)).toEqual(expect.arrayContaining(['cet4', 'cet6', 'ielts', 'toefl']));
    expect(Object.keys(OPTION_SYNONYMS.pronouns!)).toEqual(expect.arrayContaining(['he_him', 'she_her', 'they_them']));
  });
  it('every code has at least 2 non-empty synonyms', () => {
    for (const [domain, codes] of Object.entries(OPTION_SYNONYMS)) {
      for (const [code, syns] of Object.entries(codes)) {
        expect(syns.length, `${domain}.${code}`).toBeGreaterThanOrEqual(2);
        expect(syns.every((s) => s.trim().length > 0), `${domain}.${code}`).toBe(true);
      }
    }
  });
  it('every enum code except the open-ended "other" has both zh and en text', () => {
    for (const d of ENUM_DOMAINS) {
      if (['salaryCurrency', 'salaryPeriod'].includes(d)) continue;
      for (const [code, syns] of Object.entries(OPTION_SYNONYMS[d]!)) {
        expect(syns.some((s) => /[\u4e00-\u9fff]/.test(s)), `${d}.${code} zh`).toBe(true);
        expect(syns.some((s) => /[a-z]/i.test(s)), `${d}.${code} en`).toBe(true);
      }
    }
  });
});

describe('resolveCode', () => {
  it('returns canonical codes unchanged', () => {
    expect(resolveCode('degree', 'master')).toBe('master');
    expect(resolveCode('yesNo', 'yes')).toBe('yes');
  });
  it('maps unambiguous labels to their code', () => {
    expect(resolveCode('degree', '硕士研究生')).toBe('master');
    expect(resolveCode('languageCert', 'CET-6')).toBe('cet6');
    expect(resolveCode('languageCert', 'cet 6')).toBe('cet6');
  });
  it('returns undefined for unknown text or unknown domain', () => {
    expect(resolveCode('degree', '昆士兰大学')).toBeUndefined();
    expect(resolveCode('nope', 'master')).toBeUndefined();
    expect(resolveCode(null, 'master')).toBeUndefined();
  });
});

describe('isPlaceholderOption', () => {
  it.each([
    [{ label: '请选择' }, true],
    [{ label: '-- 请选择 --' }, true],
    [{ label: '请选择学历' }, true],
    [{ label: 'Select...' }, true],
    [{ label: 'Select' }, true],
    [{ label: 'Please select' }, true],
    [{ label: '-- Select one --' }, true],
    [{ label: 'Choose an option' }, true],
    [{ label: '   ' }, true],
    [{ label: 'Anything', value: '' }, true],
    [{ label: '---' }, true],
    [{ label: 'Male', value: 'male' }, false],
    [{ label: 'Select Health' }, false],
    [{ label: '硕士' }, false],
    [{ label: 'Other', value: undefined }, false],
  ] as [OptionInfo, boolean][])('%j → %s', (o, expected) => {
    expect(isPlaceholderOption(o)).toBe(expected);
  });
});

describe('matchOption: canonical codes via synonym groups', () => {
  it('degree master → 硕士研究生', () => {
    expect(pick('degree', 'master', opts('请选择', '本科', '硕士研究生', '博士研究生'))).toBe('硕士研究生');
  });
  it('degree bachelor → 本科 / 学士 / Bachelor degree', () => {
    expect(pick('degree', 'bachelor', opts('大专', '本科', '硕士'))).toBe('本科');
    expect(pick('degree', 'bachelor', opts('学士', '硕士', '博士'))).toBe('学士');
    expect(pick('degree', 'bachelor', opts('Diploma', "Bachelor's degree", "Master's degree"))).toBe("Bachelor's degree");
  });
  it('degree master → 硕士 and Masters (学位 wording)', () => {
    expect(pick('degree', 'master', opts('学士', '硕士', '博士'))).toBe('硕士');
    expect(pick('degree', 'master', opts('Bachelor', 'Masters', 'Doctorate'))).toBe('Masters');
  });
  it('degree phd → 博士 / 博士研究生 / Doctorate', () => {
    expect(pick('degree', 'phd', opts('硕士', '博士研究生'))).toBe('博士研究生');
    expect(pick('degree', 'phd', opts('Masters', 'Doctorate (PhD)'))).toBe('Doctorate (PhD)');
  });
  it('degree associate → 大专 / 专科', () => {
    expect(pick('degree', 'associate', opts('专科', '本科'))).toBe('专科');
    expect(pick('degree', 'associate', opts('大专', '本科'))).toBe('大专');
  });
  it('degree master does not guess "本科" when no master option exists', () => {
    expect(pick('degree', 'master', opts('本科', '大专'))).toBe('none');
  });
  it('politicalStatus: 团员 → 共青团员, 党员 → 中共党员 (not 预备党员)', () => {
    expect(pick('politicalStatus', 'league_member', opts('中共党员', '中共预备党员', '共青团员', '群众'))).toBe('共青团员');
    expect(pick('politicalStatus', 'league_member', opts('中国共产主义青年团团员', '群众'))).toBe('中国共产主义青年团团员');
    expect(pick('politicalStatus', 'party_member', opts('中共党员', '中共预备党员', '共青团员', '群众'))).toBe('中共党员');
    expect(pick('politicalStatus', 'probationary_party_member', opts('中共党员', '中共预备党员', '群众'))).toBe('中共预备党员');
    expect(pick('politicalStatus', 'masses', opts('党员', '团员', '群众'))).toBe('群众');
  });
  it('politicalStatus party_member never lands on 预备党员 when only that exists', () => {
    expect(pick('politicalStatus', 'party_member', opts('中共预备党员', '共青团员', '群众'))).toBe('none');
  });
  it('workRightsStatus graduate_visa → "Temporary visa with full work rights"', () => {
    const o = opts('Australian citizen', 'Permanent resident', 'Temporary visa with full work rights', 'Temporary visa with limited work rights');
    expect(pick('workRightsStatus', 'graduate_visa', o)).toBe('Temporary visa with full work rights');
    expect(pick('workRightsStatus', 'student_visa', o)).toBe('Temporary visa with limited work rights');
    expect(pick('workRightsStatus', 'citizen', o)).toBe('Australian citizen');
    expect(pick('workRightsStatus', 'permanent_resident', o)).toBe('Permanent resident');
  });
  it('workRightsStatus other_temporary does not steal the "with full work rights" option', () => {
    const o = opts('Temporary visa with full work rights', 'Citizen');
    expect(pick('workRightsStatus', 'other_temporary', o)).toBe('none');
  });
  it('workRightsStatus citizen satisfies "Australian citizen or permanent resident"', () => {
    const o = opts('Australian citizen or permanent resident', 'Visa holder');
    expect(pick('workRightsStatus', 'citizen', o)).toBe('Australian citizen or permanent resident');
    expect(pick('workRightsStatus', 'permanent_resident', o)).toBe('Australian citizen or permanent resident');
  });
  it('educationType full_time does not match 非全日制', () => {
    expect(pick('educationType', 'full_time', opts('全日制', '非全日制'))).toBe('全日制');
    expect(pick('educationType', 'full_time', opts('非全日制'))).toBe('none');
    expect(pick('educationType', 'part_time', opts('全日制', '非全日制'))).toBe('非全日制');
  });
  it('gender: male does not match Female', () => {
    expect(pick('gender', 'male', opts('Female', 'Male'))).toBe('Male');
    expect(pick('gender', 'male', opts('Female'))).toBe('none');
    expect(pick('gender', 'female', opts('男', '女'))).toBe('女');
    expect(pick('gender', 'female', opts('男', '女', '保密'))).toBe('女');
    expect(pick('gender', 'undisclosed', opts('Male', 'Female', 'Prefer not to say'))).toBe('Prefer not to say');
  });
  it('maritalStatus and idType', () => {
    expect(pick('maritalStatus', 'single', opts('已婚', '未婚', '离异'))).toBe('未婚');
    expect(pick('idType', 'id_card', opts('护照', '居民身份证', '港澳居民来往内地通行证'))).toBe('居民身份证');
    expect(pick('idType', 'passport', opts('身份证', '护照'))).toBe('护照');
  });
  it('relationship', () => {
    expect(pick('relationship', 'father', opts('父亲', '母亲', '配偶'))).toBe('父亲');
    expect(pick('relationship', 'spouse', opts('Parent', 'Spouse', 'Friend'))).toBe('Spouse');
    expect(pick('relationship', 'mother', opts('Father', 'Mother'))).toBe('Mother');
  });
  it('employmentType, awardLevel, proficiency', () => {
    expect(pick('employmentType', 'full_time', opts('全职', '兼职', '实习'))).toBe('全职');
    expect(pick('employmentType', 'graduate_program', opts('Full-time', 'Graduate program'))).toBe('Graduate program');
    expect(pick('awardLevel', 'national', opts('校级', '省级', '国家级'))).toBe('国家级');
    expect(pick('awardLevel', 'school', opts('校级', '省级', '国家级'))).toBe('校级');
    expect(pick('proficiency', 'fluent', opts('精通', '熟练', '一般'))).toBe('精通');
    expect(pick('proficiency', 'basic', opts('Fluent', 'Basic'))).toBe('Basic');
  });
  it('salary currency and period', () => {
    expect(pick('salaryCurrency', 'CNY', opts('USD', 'RMB'))).toBe('RMB');
    expect(pick('salaryCurrency', 'AUD', opts('USD', '澳元'))).toBe('澳元');
    expect(pick('salaryPeriod', 'month', opts('Per year', 'Per month'))).toBe('Per month');
    expect(pick('salaryPeriod', 'year', opts('月薪', '年薪'))).toBe('年薪');
  });
  it('workKind: internship / full_time', () => {
    expect(pick('workKind', 'internship', opts('全职', '实习'))).toBe('实习');
  });
});

describe('matchOption: booleans and yes/no', () => {
  it('true → 是, false → 否', () => {
    expect(pick('yesNo', true, opts('是', '否'))).toBe('是');
    expect(pick('yesNo', false, opts('是', '否'))).toBe('否');
  });
  it('true/false map to Yes/No with domain null or yesNo', () => {
    expect(pick(null, true, opts('No', 'Yes'))).toBe('Yes');
    expect(pick(null, false, opts('No', 'Yes'))).toBe('No');
  });
  it("codes 'yes'/'no' behave like booleans", () => {
    expect(pick('yesNo', 'yes', opts('接受', '不接受'))).toBe('接受');
    expect(pick('yesNo', 'no', opts('愿意', '不愿意'))).toBe('不愿意');
    expect(pick('yesNo', 'yes', opts('服从', '不服从'))).toBe('服从');
  });
  it('Y/N single letters', () => {
    expect(pick('yesNo', true, opts('Y', 'N'))).toBe('Y');
  });
  it('true never matches 否 and no option exists → none', () => {
    expect(pick('yesNo', true, opts('否'))).toBe('none');
  });
  it('a boolean with a non-yes/no domain falls back to yes/no synonyms', () => {
    expect(pick('degree', true, opts('Yes', 'No'))).toBe('Yes');
  });
  it('diversity yes with several "Yes, …" options is ambiguous, never picked', () => {
    const o = opts('No', 'Yes, Aboriginal', 'Yes, Torres Strait Islander', 'Prefer not to say');
    const r = matchOption('diversity', 'yes', o);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toEqual([1, 2]);
  });
  it('diversity no / prefer_not_to_say', () => {
    const o = opts('No', 'Yes, Aboriginal', "I don't wish to answer");
    expect(pick('diversity', 'no', o)).toBe('No');
    expect(pick('diversity', 'prefer_not_to_say', o)).toBe("I don't wish to answer");
    expect(pick('diversity', 'prefer_not_to_say', opts('Yes', 'No', 'Decline to answer'))).toBe('Decline to answer');
    expect(pick('diversity', 'prefer_not_to_say', opts('Yes', 'No', 'Prefer not to say'))).toBe('Prefer not to say');
    expect(pick('diversity', 'prefer_not_to_say', opts('是', '否', '不愿透露'))).toBe('不愿透露');
  });
});

describe('matchOption: free text values', () => {
  it('exact (normalized) match: 昆士兰大学', () => {
    expect(pick(null, '昆士兰大学', opts('悉尼大学', '昆士兰大学', '昆士兰科技大学'))).toBe('昆士兰大学');
  });
  it('unique containment: 昆士兰大学 in "昆士兰大学 (UQ)"', () => {
    expect(pick(null, '昆士兰大学', opts('悉尼大学', '昆士兰大学（UQ）'))).toBe('昆士兰大学（UQ）');
  });
  it('QLD matches the exact state code', () => {
    expect(pick(null, 'QLD', opts('NSW', 'VIC', 'QLD', 'WA'))).toBe('QLD');
    expect(pick(null, 'qld', opts('NSW', 'QLD'))).toBe('QLD');
  });
  it('dial code +61 matches "Australia (+61)"', () => {
    expect(pick(null, '+61', opts('China (+86)', 'Australia (+61)', 'New Zealand (+64)'))).toBe('Australia (+61)');
    expect(pick(null, '61', opts('China (+86)', 'Australia (+61)'))).toBe('Australia (+61)');
  });
  it('dial code +1 is ambiguous across US and Canada but does not hit +1-242', () => {
    const o = opts('United States (+1)', 'Canada (+1)', 'Bahamas (+1-242)', 'Australia (+61)');
    const r = matchOption(null, '+1', o);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toEqual([0, 1]);
  });
  it('LinkedIn matches "LinkedIn" and "LinkedIn Jobs"', () => {
    expect(pick(null, 'LinkedIn', opts('Seek', 'LinkedIn', 'Indeed'))).toBe('LinkedIn');
    expect(pick(null, 'LinkedIn', opts('Seek', 'LinkedIn Jobs', 'Indeed'))).toBe('LinkedIn Jobs');
  });
  it('CET-6 matches 大学英语六级 / CET6 / 英语六级', () => {
    expect(pick('languageCert', 'CET-6', opts('CET-4', '大学英语六级', 'IELTS'))).toBe('大学英语六级');
    expect(pick('languageCert', 'CET-6', opts('CET4', 'CET6'))).toBe('CET6');
    expect(pick('languageCert', 'cet6', opts('英语四级', '英语六级'))).toBe('英语六级');
    expect(pick('languageCert', 'CET-4', opts('CET-4', 'CET-6'))).toBe('CET-4');
  });
  it('other language certs and pronouns', () => {
    expect(pick('languageCert', 'ielts', opts('托福', '雅思'))).toBe('雅思');
    expect(pick('languageCert', 'toefl', opts('IELTS', 'TOEFL iBT'))).toBe('TOEFL iBT');
    expect(pick('languageCert', 'pte', opts('IELTS', 'PTE Academic'))).toBe('PTE Academic');
    expect(pick('pronouns', 'he_him', opts('She/her', 'He/him', 'They/them'))).toBe('He/him');
    expect(pick('pronouns', 'they_them', opts('She/her', 'He/him', 'They/them'))).toBe('They/them');
    expect(pick('pronouns', 'She / Her', opts('She/her', 'He/him'))).toBe('She/her');
  });
  it('free text resolved to a code uses the synonym group (硕士 → 硕士研究生)', () => {
    expect(pick('degree', '硕士', opts('本科', '硕士研究生'))).toBe('硕士研究生');
  });
  it('first element of an array is used; empty array → none', () => {
    expect(pick('degree', ['master', 'phd'], opts('硕士研究生', '博士研究生'))).toBe('硕士研究生');
    expect(pick(null, ['QLD', 'NSW'], opts('NSW', 'QLD'))).toBe('QLD');
    expect(matchOption(null, [], opts('A'))).toEqual({ status: 'none' });
  });
  it('returns indexes into the original array, including skipped placeholders', () => {
    const o = opts('请选择', 'NSW', 'QLD');
    expect(matchOption(null, 'QLD', o)).toMatchObject({ status: 'matched', index: 2 });
  });
});

describe('matchOption: ambiguity, none, placeholders', () => {
  it('ambiguous containment: two options contain the value', () => {
    const r = matchOption(null, '计算机', opts('计算机科学', '计算机技术', '软件工程'));
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toEqual([0, 1]);
  });
  it('containment below length ratio 0.5 is not accepted', () => {
    expect(pick(null, '计算机', opts('计算机科学与技术专业', '软件工程'))).toBe('none');
  });
  it('containment works in the other direction (option inside value)', () => {
    expect(pick(null, '昆士兰大学计算机学院', opts('悉尼大学', '昆士兰大学计算机'))).toBe('昆士兰大学计算机');
  });
  it('duplicate exact labels are ambiguous', () => {
    expect(matchOption(null, 'Other', opts('Other', 'Other')).status).toBe('ambiguous');
  });
  it('no match → none (never falls back to the first option)', () => {
    expect(matchOption(null, 'Zzz', opts('Alpha', 'Beta'))).toEqual({ status: 'none' });
    expect(matchOption('degree', 'master', opts('Alpha', 'Beta'))).toEqual({ status: 'none' });
  });
  it('empty options, empty value → none', () => {
    expect(matchOption(null, 'x', [])).toEqual({ status: 'none' });
    expect(matchOption(null, '  ', opts('A'))).toEqual({ status: 'none' });
    expect(matchOption(null, '', opts('A'))).toEqual({ status: 'none' });
  });
  it('placeholder options are never matched', () => {
    expect(pick(null, '请选择', opts('请选择', '本科'))).toBe('none');
    expect(pick(null, 'Select...', opts('Select...', 'Yes'))).toBe('none');
    expect(pick(null, 'Anything', [{ label: 'Anything', value: '' }])).toBe('none');
  });
  it('disabled options are never matched', () => {
    expect(matchOption('degree', 'master', [{ label: '硕士', disabled: true }, { label: '本科' }])).toEqual({ status: 'none' });
  });
  it('fuzzy tier: close typo beats a distant runner-up', () => {
    const r = matchOption(null, 'Univeristy of Queensland', opts('University of Queensland', 'Griffith University'));
    expect(r).toMatchObject({ status: 'matched', index: 0 });
    if (r.status === 'matched') expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });
  it('fuzzy tier: two near-identical candidates are ambiguous', () => {
    const r = matchOption(null, 'Univeristy of Queensland', opts('University of Queensland', 'Universty of Queensland'));
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toEqual([0, 1]);
  });
  it('identical normalized labels are never silently disambiguated', () => {
    expect(matchOption(null, 'University of Queensland', opts('University of Queensland', 'university of queensland')).status).toBe('ambiguous');
  });
  it('a negated option is not accepted for a positive code through containment', () => {
    expect(matchOption('yesNo', 'yes', opts('不太愿意')).status).toBe('none');
    expect(matchOption('yesNo', 'yes', opts('愿意去')).status).toBe('matched');
  });
  it('fuzzy tier: below 0.85 → none', () => {
    expect(matchOption(null, 'Engineering', opts('Biology', 'Chemistry')).status).toBe('none');
  });
  it('canonical codes never match by fuzzy/containment (male vs Female, no vs None)', () => {
    expect(matchOption('gender', 'male', opts('Female', 'Other')).status).toBe('none');
    expect(matchOption('yesNo', 'no', opts('Not sure')).status).toBe('none');
  });
  it('confidence is in (0,1] and exact-synonym < exact label equality', () => {
    const a = matchOption('degree', 'master', opts('硕士研究生'));
    const b = matchOption(null, '硕士研究生', opts('硕士研究生'));
    expect(a.status).toBe('matched');
    expect(b.status).toBe('matched');
    if (a.status === 'matched' && b.status === 'matched') {
      expect(a.confidence).toBeGreaterThan(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(b.confidence).toBe(1);
    }
  });
});
