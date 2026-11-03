import { describe, expect, it } from 'vitest';
import type { FileData, FillIntent } from '../../../src/drivers/types';
import type { Control, OptionInfo } from '../../../src/engine/types';
import {
  entryCount, optionLabel, resolveValue, sectionEntries, toIntent, type RawValue,
} from '../../../src/engine/values';
import { ResumeSchema, createSampleProfile, type Resume } from '../../../src/schema';
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
