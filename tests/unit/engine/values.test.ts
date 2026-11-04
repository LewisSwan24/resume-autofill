import { describe, expect, it } from 'vitest';
import type { FileData, FillIntent } from '../../../src/drivers/types';
import type { Control, OptionInfo } from '../../../src/engine/types';
import {
  entryCount, optionLabel, resolveValue, sectionEntries, toIntent, type RawValue,
} from '../../../src/engine/values';
import { ResumeSchema, createSampleProfile, type Region, type Resume } from '../../../src/schema';
import { getFieldKeyDef } from '../../../src/schema/fieldKeys';

const profile = createSampleProfile();
const zh = profile.resumes.find((r) => r.id === 'sample-zh')!;
const en = profile.resumes.find((r) => r.id === 'sample-en')!;

const control = (kind: Control['kind'], extra: Partial<Control> = {}): Control => ({
  id: 'c1',
  el: document.createElement('input'),
  kind,
  lib: 'native',
  ...extra,
});
const opts = (...labels: string[]): OptionInfo[] => labels.map((label) => ({ label }));
const def = (key: string) => getFieldKeyDef(key)!;
const intent = (key: string, raw: RawValue, c: Control, locale: Resume['locale'] = 'zh-CN', files?: Record<string, FileData>) =>
  toIntent(def(key), raw, c, locale, files ? { files } : {});
/** The option a choice intent would pick from `options` (label), or the match status. */
function picked(i: FillIntent | null, options: OptionInfo[]): string {
  if (!i || i.kind !== 'choice') throw new Error(`not a choice: ${JSON.stringify(i)}`);
  const m = i.match(options);
  return m.status === 'matched' ? options[m.index]!.label : m.status;
}

describe('resolveValue', () => {
  it('derives the full name per locale', () => {
    expect(resolveValue('basics.fullName', zh, 0, 'basics')?.raw).toBe('林知远');
    expect(resolveValue('basics.fullName', en, 0, 'basics')?.raw).toBe('Zhiyuan Lin');
  });

  it('reads plain, address and phone values with their resume path', () => {
    expect(resolveValue('contact.email', zh, 0, 'contact')).toEqual({ raw: 'zhiyuan.lin@example.com', source: 'contact.email' });
    expect(resolveValue('contact.addressCity', en, 0, 'contact')).toEqual({ raw: 'Brisbane', source: 'contact.address.city' });
    expect(resolveValue('contact.postcode', en, 0, 'contact')?.raw).toBe('4000');
    expect(resolveValue('contact.phoneFull', en, 0, 'contact')?.raw).toBe('+61 412345678');
    expect(resolveValue('contact.phoneFull', zh, 0, 'contact')?.raw).toBe('+86 13800138000');
    expect(resolveValue('contact.addressFull', en, 0, 'contact')?.raw).toBe('1 Example St, Brisbane, QLD 4000, Australia');
  });

  it('treats empty strings and null as no data', () => {
    expect(resolveValue('contact.qq', zh, 0, 'contact')).toBeNull();
    expect(resolveValue('basics.gender', ResumeSchema.parse({ id: 'x', title: 't', locale: 'zh-CN' }), 0, 'basics')).toBeNull();
    expect(resolveValue('education.gpa', zh, 1, 'education')).toBeNull();
    expect(resolveValue('education.school', zh, 5, 'education')).toBeNull();
  });

  it('answers where you are based from the address when no location is given, down to the city', () => {
    const value = resolveValue('basics.currentLocation', en, 0, 'basics');
    expect(value?.source).toBe('contact.address');
    expect(value?.raw).toEqual({ country: 'Australia', province: 'QLD', city: 'Brisbane' });
    const asked = zh.basics.currentLocation;
    expect(resolveValue('basics.currentLocation', zh, 0, 'basics')?.raw).toEqual(asked);
  });

  it('keeps booleans, numbers, lists, regions and the derived age', () => {
    expect(resolveValue('workRights.requiresSponsorship', en, 0, 'workRights')?.raw).toBe(false);
    expect(resolveValue('jobIntention.cities', zh, 0, 'jobIntention')?.raw).toEqual(['深圳', '杭州']);
    expect(resolveValue('basics.nativePlace', zh, 0, 'basics')?.raw).toEqual({ province: '浙江省', city: '杭州市' });
    expect(resolveValue('basics.age', zh, 0, 'basics', { now: new Date(2026, 2, 14) })?.raw).toBe(23);
    expect(resolveValue('basics.age', zh, 0, 'basics', { now: new Date(2026, 2, 15) })?.raw).toBe(24);
  });

  it('maps card i to entry i of the section', () => {
    expect(resolveValue('education.school', zh, 1, 'education')).toEqual({ raw: '昆士兰大学', source: 'education[1].school' });
  });

  it('splits work and internship sections (plan 0.7)', () => {
    const mixed = ResumeSchema.parse({
      id: 'm', title: 'm', locale: 'en-AU',
      work: [
        { kind: 'full_time', company: 'Acme' },
        { kind: 'internship', company: 'Intern Co' },
        { kind: 'part_time', company: 'Cafe' },
      ],
    });
    // internship section: internship entries, source keeps the stored index
    expect(resolveValue('work.company', mixed, 0, 'internship')).toEqual({ raw: 'Intern Co', source: 'work[1].company' });
    expect(resolveValue('work.company', mixed, 1, 'internship')).toBeNull();
    // work section with an internship section on the page: the others
    expect(resolveValue('work.company', mixed, 1, 'work', { hasInternshipSection: true })?.raw).toBe('Cafe');
    // work section alone: everything
    expect(resolveValue('work.company', mixed, 1, 'work')?.raw).toBe('Intern Co');
    expect(sectionEntries(mixed, 'work', 'work', true).map((r) => r.index)).toEqual([0, 2]);
    expect(entryCount(mixed, 'internship')).toBe(1);
    expect(entryCount(mixed, 'work', true)).toBe(2);
    expect(entryCount(mixed, 'work')).toBe(3);
    expect(entryCount(mixed, 'basics')).toBe(0);
  });

  it('gives a current entry no end date', () => {
    expect(resolveValue('work.endDate', zh, 1, 'internship')).toBeNull();
    expect(resolveValue('work.endDate', zh, 0, 'internship')?.raw).toBe('2023-09');
    expect(resolveValue('work.current', zh, 1, 'internship')?.raw).toBe(true);
    expect(resolveValue('work.current', zh, 0, 'internship')?.raw).toBe(false);
  });

  it('resolves attachments to their file id and misc texts', () => {
    expect(resolveValue('attachments.resume', zh, 0, 'attachments')).toEqual({ raw: 'sample-resume-zh', source: 'attachments.resumeFileId' });
    expect(resolveValue('attachments.transcript', zh, 0, 'attachments')).toBeNull();
    expect(resolveValue('misc.selfIntroduction', en, 0, 'selfIntro')?.raw).toMatch(/^I am a Master/);
  });
});

describe('optionLabel', () => {
  it('uses the first synonym in the resume language', () => {
    expect(optionLabel('relationship', 'father', 'zh-CN')).toBe('父亲');
    expect(optionLabel('relationship', 'father', 'en-AU')).toBe('Father');
    expect(optionLabel('languageCert', 'cet6', 'zh-CN')).toBe('英语六级');
    expect(optionLabel('gender', 'male', 'en-AU')).toBe('Male');
    expect(optionLabel('yesNo', 'yes', 'zh-CN')).toBe('是');
    expect(optionLabel('degree', 'nothing', 'zh-CN')).toBe('nothing');
    expect(optionLabel(null, 'x', 'zh-CN')).toBe('x');
  });
});

describe('toIntent', () => {
  it('text, longtext and numbers become text', () => {
    expect(intent('contact.email', 'a@b.c', control('text'))).toEqual({ kind: 'text', text: 'a@b.c' });
    expect(intent('education.courses', 'Algorithms', control('textarea'))).toEqual({ kind: 'text', text: 'Algorithms' });
    expect(intent('basics.height', 172, control('text'))).toEqual({ kind: 'text', text: '172' });
    expect(intent('misc.selfIntroduction', 'hi', control('richtext'))).toEqual({ kind: 'text', text: 'hi' });
  });

  it('dates: month inputs YYYY-MM, day pickers keep or default the day', () => {
    const month = control('date', { inputType: 'month', dateGranularity: 'month' });
    expect(intent('education.startDate', '2020-09', month)).toEqual({ kind: 'date', display: '2020-09', year: 2020, month: 9 });
    const nativeDate = control('date', { inputType: 'date', dateGranularity: 'day' });
    expect(intent('workRights.visaExpiry', '2028-08-31', nativeDate)).toEqual({ kind: 'date', display: '2028-08-31', year: 2028, month: 8, day: 31 });
    // month-only data on input[type=date] → first of the month
    expect(intent('jobIntention.availableFrom', '2026-07', nativeDate)).toEqual({ kind: 'date', display: '2026-07-01', year: 2026, month: 7, day: 1 });
    // day data on a month picker: no day
    expect(intent('basics.birthDate', '2002-03-15', month)).toEqual({ kind: 'date', display: '2002-03', year: 2002, month: 3 });
    const year = control('date', { dateGranularity: 'year' });
    expect(intent('basics.birthDate', '2002-03-15', year)).toMatchObject({ display: '2002', year: 2002 });
    // a plain text box gets the stored string; a select cannot take a date
    expect(intent('education.endDate', '2024-06', control('text'))).toEqual({ kind: 'text', text: '2024-06' });
    expect(intent('education.endDate', '2024-06', control('select'))).toBeNull();
    expect(intent('education.endDate', 'soon', month)).toBeNull();
  });

  it('enum on a select/radio → choice resolved with matchOption', () => {
    const degrees = control('select', { options: opts('Select', 'Bachelor', 'Master', 'Doctorate', 'Diploma') });
    const i = intent('education.degree', 'master', degrees, 'en-AU');
    expect(i).toMatchObject({ kind: 'choice', display: 'Master', query: 'Master' });
    expect(picked(i, degrees.options!)).toBe('Master');
    // zh synonyms: 本科 / 硕士研究生 / 博士研究生 resolve by code
    expect(picked(intent('education.degree', 'master', control('select')), opts('本科', '硕士研究生', '博士研究生'))).toBe('硕士研究生');
    expect(picked(intent('education.degree', 'bachelor', control('select')), opts('学士', '硕士', '博士'))).toBe('学士');
    expect(picked(intent('education.degree', 'phd', control('select')), opts('学士', '硕士', '博士'))).toBe('博士');
    expect(picked(intent('basics.gender', 'female', control('radio')), opts('男', '女'))).toBe('女');
  });

  it('enum on a text control → the locale label as text', () => {
    expect(intent('family.relationship', 'father', control('text'))).toEqual({ kind: 'text', text: '父亲' });
    expect(intent('family.relationship', 'mother', control('text'), 'en-AU')).toEqual({ kind: 'text', text: 'Mother' });
    expect(intent('basics.politicalStatus', 'league_member', control('text'))).toEqual({ kind: 'text', text: '共青团员' });
    expect(intent('education.degree', 'master', control('date'))).toBeNull();
  });

  it('bool: check for a single checkbox, yes/no choice for radios and selects', () => {
    expect(intent('work.current', true, control('checkbox'))).toEqual({ kind: 'check', checked: true });
    expect(intent('education.current', false, control('checkbox'))).toEqual({ kind: 'check', checked: false });
    const yn = control('radio', { options: opts('是', '否') });
    expect(picked(intent('jobIntention.acceptAdjustment', true, yn), yn.options!)).toBe('是');
    const en2 = control('radio', { options: opts('Yes', 'No') });
    expect(picked(intent('workRights.requiresSponsorship', false, en2, 'en-AU'), en2.options!)).toBe('No');
    // a single checkbox cannot hold a non-bool key; a text box gets the label
    expect(intent('education.school', 'X', control('checkbox'))).toBeNull();
    expect(intent('jobIntention.acceptRelocation', true, control('text'))).toEqual({ kind: 'text', text: '是' });
  });

  it('region on a search box: the rest of the address tells places of one name apart', () => {
    const region = { country: 'Australia', province: 'QLD', city: 'Brisbane' };
    const pick = (...labels: string[]) => picked(intent('basics.currentLocation', region, control('select'), 'en-AU'), opts(...labels));
    expect(pick('Brisbane, Queensland, Australia', 'Brisbane, California, United States')).toBe('Brisbane, Queensland, Australia');
    expect(pick('Brisbane, QLD, Australia', 'Brisbane, WA, Australia')).toBe('Brisbane, QLD, Australia');
    expect(pick('Brisbane QLD, Australia', 'Melbourne VIC, Australia')).toBe('Brisbane QLD, Australia');
    expect(pick('Brisbane QLD')).toBe('Brisbane QLD');
    expect(pick('Brisbane')).toBe('Brisbane');
    expect(pick('Brisbane, QLD, Australia', 'Brisbane, QLD 4000, Australia')).toBe('ambiguous');
    // Places elsewhere are not this place, even when one is all the search found.
    expect(pick('Brisbane, Ontario, Canada', 'Brisbane, California, United States')).toBe('none');
    expect(pick('Brisbane CA, United States')).toBe('none');
    // A longer name is another place.
    expect(pick('Brisbane City QLD, Australia')).toBe('none');
    expect(pick('Sydney NSW, Australia')).toBe('none');
  });

  describe('a gender question that lets you decline', () => {
    const answer = (genderAnswer: 'prefer_not_to_say' | 'from_resume', c: Control, ...labels: string[]) =>
      picked(toIntent(def('basics.gender'), 'male', c, 'en-AU', { genderAnswer }), opts(...labels));
    const declinable = ['Male', 'Female', 'Prefer not to say'];

    it('declines when that is the chosen answer', () => {
      expect(answer('prefer_not_to_say', control('select'), ...declinable)).toBe('Prefer not to say');
      expect(answer('prefer_not_to_say', control('radio'), ...declinable)).toBe('Prefer not to say');
    });

    it('answers from the resume when that is the chosen answer', () => {
      expect(answer('from_resume', control('select'), ...declinable)).toBe('Male');
    });

    it('answers from the resume when the question offers no way to decline', () => {
      expect(answer('prefer_not_to_say', control('select'), 'Male', 'Female')).toBe('Male');
      expect(answer('prefer_not_to_say', control('select'), '男', '女')).toBe('男');
    });

    it.each([
      'Decline to self-identify', "I don't wish to answer", 'Prefer not to disclose', 'Decline to state',
      'Do not wish to disclose', 'Prefer not to respond', '不愿透露', '保密', '不便透露', '不方便透露', '不透露', '不想透露',
      '拒绝回答', '不愿回答', '不愿说明',
    ])(
      'reads "%s" as declining',
      (decline) => {
        expect(answer('prefer_not_to_say', control('select'), 'Male', 'Female', decline)).toBe(decline);
      },
    );

    it('does not pick between two ways of declining', () => {
      expect(answer('prefer_not_to_say', control('select'), 'Male', 'Prefer not to say', 'Decline to self-identify')).toBe('ambiguous');
    });

    it('declines in a checkbox group too', () => {
      const c = control('checkbox', { multiple: true, options: opts(...declinable) });
      const i = toIntent(def('basics.gender'), 'male', c, 'en-AU', { genderAnswer: 'prefer_not_to_say' });
      if (i?.kind !== 'multi') throw new Error(`not a multi: ${JSON.stringify(i)}`);
      const m = i.items[0]!.match(opts(...declinable));
      expect(m.status === 'matched' && declinable[m.index]).toBe('Prefer not to say');
    });

    it('searches for the way to decline, not for the answer it is keeping back', () => {
      const i = toIntent(def('basics.gender'), 'male', control('select'), 'en-AU', { genderAnswer: 'prefer_not_to_say' });
      expect(i).toMatchObject({ kind: 'choice', query: 'Prefer not to say' });
    });

    it('says what it will write when the options are known', () => {
      const c = control('select', { options: opts(...declinable) });
      const i = toIntent(def('basics.gender'), 'male', c, 'en-AU', { genderAnswer: 'prefer_not_to_say' });
      expect(i).toMatchObject({ kind: 'choice', display: 'Prefer not to say' });
    });

    it('leaves other questions alone', () => {
      const c = control('select');
      const i = toIntent(def('basics.maritalStatus'), 'single', c, 'en-AU', { genderAnswer: 'prefer_not_to_say' });
      expect(picked(i, opts('Single', 'Married', 'Prefer not to say'))).toBe('Single');
    });
  });

  describe('a place that does not fit the address', () => {
    const place = (home: Region, name: string, ...labels: string[]) =>
      picked(toIntent(def('contact.addressCity'), name, control('select'), 'en-AU', { home }), opts(...labels));
    const au = (province: string, city: string): Region => ({ country: 'Australia', province, city });

    it('is refused when it names another state of the same country', () => {
      expect(place(au('VIC', 'Richmond'), 'Richmond', 'Richmond, New South Wales, AUS')).toBe('none');
      expect(place(au('WA', 'Perth'), 'Perth', 'Perth, Tasmania, AUS')).toBe('none');
      expect(place(au('VIC', 'Richmond'), 'Richmond', 'Richmond, NSW, Australia')).toBe('none');
      expect(place(au('VIC', 'Richmond'), 'Richmond', 'Richmond, New South Wales, AUS', 'Richmond, Victoria, AUS')).toBe('Richmond, Victoria, AUS');
    });

    it('is not refused because the name of the town looks like a state', () => {
      expect(place(au('WA', 'Victoria Park'), 'Victoria Park', 'Victoria Park, WA, AUS')).toBe('Victoria Park, WA, AUS');
    });

    it('is refused when it only starts the same', () => {
      expect(place(au('NSW', 'Newcastle'), 'Newcastle', 'Newcastle West, IE')).toBe('none');
      expect(place(au('VIC', 'Melbourne'), 'Melbourne', 'Melbourne Beach, FL')).toBe('none');
    });

    it('is taken from a plain list by its exact name', () => {
      expect(place(au('QLD', 'Brisbane'), 'Brisbane', 'Sydney', 'Brisbane')).toBe('Brisbane');
    });

    it('does not read Australian state short forms into another country', () => {
      const home: Region = { country: 'United States', province: 'WA', city: 'Albany' };
      expect(place(home, 'Albany', 'Albany, Western Australia')).toBe('none');
      expect(place(home, 'Albany', 'Albany, WA, USA')).toBe('Albany, WA, USA');
    });

    it('is not guessed at when there is no country or state to check it against', () => {
      expect(place({ city: 'Brisbane' } as Region, 'Brisbane', 'Brisbane, CA, USA')).toBe('ambiguous');
    });
  });

  describe('a state on a pick list', () => {
    const state = (home: Region, ...labels: string[]) =>
      picked(toIntent(def('contact.addressProvince'), home.province!, control('select'), 'en-AU', { home }), opts(...labels));
    const qld: Region = { country: 'Australia', province: 'QLD', city: 'Brisbane' };

    it('takes the name spelled out', () => {
      expect(state(qld, 'Select One', 'New South Wales', 'Queensland', 'Victoria')).toBe('Queensland');
    });

    it('takes the short form when that is what the list has', () => {
      expect(state(qld, 'NSW', 'QLD')).toBe('QLD');
    });

    it('takes nothing else', () => {
      expect(state(qld, 'New South Wales', 'Victoria')).toBe('none');
    });

    it('does not spell out a short form from another country', () => {
      expect(state({ country: 'United States', province: 'WA', city: 'Seattle' }, 'Western Australia', 'Oregon')).toBe('none');
    });
  });

  it('knows a country or state by its other spellings', () => {
    const home = { country: 'Australia', province: 'QLD', city: 'Brisbane' };
    const city = (...labels: string[]) =>
      picked(toIntent(def('contact.addressCity'), 'Brisbane', control('select'), 'en-AU', { home }), labels.map((label) => ({ label })));
    expect(city('Brisbane, Queensland, AUS', 'Brisbane, CA, USA', 'Brisbane, IL, USA', 'Brisbane, Erin, ON, CAN')).toBe('Brisbane, Queensland, AUS');
    expect(city('Brisbane, CA, USA', 'Brisbane, IL, USA')).toBe('none');
    // A state short for another one elsewhere is not enough: the country still decides.
    const perth = { country: 'Australia', province: 'WA', city: 'Perth' };
    const west = (...labels: string[]) =>
      picked(toIntent(def('contact.addressCity'), 'Perth', control('select'), 'en-AU', { home: perth }), labels.map((label) => ({ label })));
    expect(west('Perth, Western Australia, AUS', 'Perth, WA, USA')).toBe('Perth, Western Australia, AUS');
    expect(west('Perth, WA, USA')).toBe('none');
  });

  it('a city on a search box goes by the home address too', () => {
    const home = { country: 'Australia', province: 'QLD', city: 'Brisbane' };
    const city = (...labels: string[]) => picked(toIntent(def('contact.addressCity'), 'Brisbane', control('select'), 'en-AU', { home }), opts(...labels));
    expect(city('Brisbane QLD, Australia', 'Melbourne VIC, Australia')).toBe('Brisbane QLD, Australia');
    expect(city('Brisbane CA, United States')).toBe('none');
  });

  it('region: cascade path, joined text per locale, choice on a select', () => {
    const region = { province: '浙江省', city: '杭州市', district: '西湖区' };
    expect(intent('basics.household', region, control('cascader'))).toEqual({
      kind: 'cascade', display: '浙江省杭州市西湖区', path: ['浙江省', '杭州市', '西湖区'],
    });
    expect(intent('basics.nativePlace', { province: '浙江省', city: '杭州市' }, control('cascader'))).toMatchObject({ path: ['浙江省', '杭州市'] });
    expect(intent('basics.household', region, control('text'))).toEqual({ kind: 'text', text: '浙江省杭州市西湖区' });
    expect(intent('basics.currentLocation', { city: 'Brisbane', province: 'QLD' }, control('text'), 'en-AU')).toEqual({ kind: 'text', text: 'Brisbane, QLD' });
    expect(picked(intent('basics.household', region, control('select')), opts('杭州市', '西湖区'))).toBe('西湖区');
    expect(intent('basics.household', { country: 'Australia' }, control('cascader'))).toMatchObject({ path: ['Australia'] });
  });

  it('list: multi for a multiple select, first item otherwise', () => {
    const multi = intent('jobIntention.cities', ['深圳', '杭州'], control('select', { multiple: true }));
    expect(multi).toMatchObject({ kind: 'multi', display: '深圳、杭州' });
    if (multi?.kind !== 'multi') throw new Error('multi expected');
    const options = opts('北京', '上海', '深圳', '杭州');
    expect(multi.items.map((it) => options[(it.match(options) as { index: number }).index]!.label)).toEqual(['深圳', '杭州']);
    const single = control('select', { options: opts('Sydney', 'Brisbane') });
    expect(picked(intent('jobIntention.cities', ['Brisbane', 'Perth'], single), single.options!)).toBe('Brisbane');
    expect(intent('jobIntention.positions', ['后端开发工程师', '前端'], control('text'))).toEqual({ kind: 'text', text: '后端开发工程师' });
  });

  it('text keys on a select use the dictionary domain when one exists', () => {
    // plain text key → matchOption without domain
    const states = control('select', { options: opts('Select', 'NSW', 'QLD') });
    expect(picked(intent('contact.addressProvince', 'QLD', states, 'en-AU'), states.options!)).toBe('QLD');
    // languages.certificate has no enumDomain in the catalogue → languageCert
    const certs = opts('CET-4', 'CET-6', '专业四级', '无');
    expect(picked(intent('languages.certificate', 'CET-6', control('select')), certs)).toBe('CET-6');
    expect(picked(intent('languages.certificate', '六级', control('select')), certs)).toBe('CET-6');
    expect(intent('languages.certificate', 'CET-6', control('text'))).toEqual({ kind: 'text', text: 'CET-6' });
    // pronouns
    const pronouns = opts('Select', 'He/him', 'She/her', 'They/them');
    expect(picked(intent('basics.pronouns', 'he/him', control('select')), pronouns)).toBe('He/him');
  });

  it('phone country code on a select matches by dial code', () => {
    const codes = opts('Select', 'Australia (+61)', 'China (+86)', 'Canada (+1)');
    expect(picked(intent('contact.phoneCountryCode', '+61', control('select')), codes)).toBe('Australia (+61)');
    expect(picked(intent('contact.phoneCountryCode', '+86', control('select')), opts('+86', '+852', '+61'))).toBe('+86');
  });

  it('a value with no matching option reports none, never a guess', () => {
    const i = intent('jobIntention.cities', ['Brisbane'], control('select'));
    expect(i?.kind === 'choice' && i.match(opts('Sydney', 'Melbourne', 'Perth')).status).toBe('none');
  });

  it('files need the run payload; a file key only fits a file control', () => {
    const file: FileData = { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:,' };
    expect(intent('attachments.resume', 'sample-resume-zh', control('file'), 'zh-CN', { 'sample-resume-zh': file })).toEqual({ kind: 'file', file });
    expect(intent('attachments.resume', 'missing', control('file'), 'zh-CN', {})).toBeNull();
    expect(intent('attachments.resume', 'sample-resume-zh', control('text'), 'zh-CN', { 'sample-resume-zh': file })).toBeNull();
    expect(intent('contact.email', 'a@b.c', control('file'))).toBeNull();
  });
});
