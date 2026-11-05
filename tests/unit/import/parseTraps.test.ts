// Resumes that read as something they are not. What is called certain here has to be right, and identity numbers stay out.
import { describe, expect, it } from 'vitest';
import { linesOfHtml } from '../../../src/import/extract/docx';
import type { TextLine } from '../../../src/import/extract/types';
import { parseResume, type Draft } from '../../../src/import/parse';
import { findPhone } from '../../../src/import/parse/contact';
import { findDateRange } from '../../../src/import/parse/dates';

const lines = (...texts: string[]): TextLine[] => texts.map((text) => ({ text, cells: [text], page: 1, fontSize: 0 }));
const row = (...cells: string[]): TextLine => ({ text: cells.join(' '), cells, page: 1, fontSize: 0 });
const value = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.value;
const certainty = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.certainty;

describe('a phone number written all together', () => {
  it.each([
    ['+8613800138000', '+86', '13800138000'],
    ['+61412345678', '+61', '0412345678'],
    ['+14155552671', '+1', '4155552671'],
    ['+85291234567', '+852', '91234567'],
    ['+447911123456', '+44', '7911123456'],
    ['+86 138 0013 8000', '+86', '13800138000'],
    ['+61 412 345 678', '+61', '0412345678'],
    ['+44 (0)20 7946 0958', '+44', '2079460958'],
  ])('%s has the code %s', (raw, code, number) => {
    expect(findPhone(raw)).toEqual({ code, number });
  });

  it.each(['+15 (2019-2021)', '+12%', '+3.5'])('%s is no phone', (raw) => {
    expect(findPhone(raw)).toBeNull();
  });
});

describe('what the whole file does not get to say', () => {
  it('a number under a phone label beats a mobile written beside it', () => {
    const d = parseResume(lines('Mia Harper', '0412 345 678', 'Phone: (07) 3000 1234', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02'));
    expect(value(d, 'contact.phone')).toBe('0730001234');
    expect(value(d, 'contact.phoneCountryCode')).toBeUndefined();
  });

  it('a labelled mobile keeps its code', () => {
    const d = parseResume(lines('Mia Harper', 'Phone: +61 412 345 678'));
    expect(value(d, 'contact.phone')).toBe('0412345678');
    expect(value(d, 'contact.phoneCountryCode')).toBe('+61');
  });

  it('numbers further down are not the applicant’s', () => {
    const d = parseResume(lines('Mia Harper', 'mia@example.com', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', 'Revenue +15 (2019-2021)', 'Handled the hotline on 0412 345 678'));
    expect(value(d, 'contact.phone')).toBeUndefined();
    expect(value(d, 'contact.phoneCountryCode')).toBeUndefined();
  });

  it.each(['References', 'Professional References', 'Character References', 'Referee 1', 'Referee', 'Emergency Contacts', '紧急联系人', '推荐人'])('nothing under %s is the applicant’s', (heading) => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', heading, 'Alex Doe', 'alex.doe@example.com', '0400 111 222'));
    expect(JSON.stringify(d.fields)).not.toMatch(/alex|0400111222/i);
  });

  it('an email further down is one to check', () => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', 'Ran the ops@acme.example inbox.'));
    expect(certainty(d, 'contact.email')).toBe('check');
  });

  it('a link to someone’s project is not their profile', () => {
    const d = parseResume(lines('Mia Harper', 'https://github.com/facebook/react'));
    expect(value(d, 'contact.github')).toBeUndefined();
    const own = parseResume(lines('Mia Harper', 'https://github.com/mia-harper'));
    expect(value(own, 'contact.github')).toBe('https://github.com/mia-harper');
  });

  it('a company’s site further down is not a personal one', () => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', 'Rebuilt www.acme.example for the team'));
    expect(value(d, 'contact.website')).toBeUndefined();
  });
});

describe('a value under a label', () => {
  it('is no email unless it reads as one', () => {
    const d = parseResume(lines('Mia Harper', 'Email: john at example dot com'));
    expect(certainty(d, 'contact.email')).not.toBe('high');
  });

  it.each(['Phone: 2019-2021', 'Phone: call me after five', 'Phone: 12'])('%s is no phone', (line) => {
    expect(value(parseResume(lines('Mia Harper', line)), 'contact.phone')).toBeUndefined();
  });
});

describe('a name', () => {
  it.each([
    ['WANG Xiaoming', 'WANG', 'Xiaoming'],
    ['Xiaoming WANG', 'WANG', 'Xiaoming'],
    ['Smith, John', 'Smith', 'John'],
    ['John Smith', 'Smith', 'John'],
    ['钟离昧', '钟离', '昧'],
    ['欧阳娜娜', '欧阳', '娜娜'],
    ['张三', '张', '三'],
  ])('%s has the family name %s', (name, family, given) => {
    const d = parseResume(lines(`Name: ${name}`));
    expect(value(d, 'basics.familyName')).toBe(family);
    expect(value(d, 'basics.givenName')).toBe(given);
  });

  it('is always one to check, even under a label: which part is which is a guess', () => {
    const d = parseResume(lines('姓名：林知远'));
    expect(certainty(d, 'basics.familyName')).toBe('check');
    expect(certainty(d, 'basics.givenName')).toBe('check');
  });
});

describe('dates', () => {
  it('a country is not a month', () => {
    expect(findDateRange('Myanmar 2018 - Present')).toMatchObject({ start: '2018-01', current: true, monthGuessed: true });
  });

  it('a word that starts like now is not now', () => {
    expect(findDateRange('2019-01 - Presentation team')).toBeNull();
    expect(findDateRange('2019-01 - Currently')).toBeNull();
  });

  it('still reads what it should', () => {
    expect(findDateRange('Mar 2018 - Present')).toMatchObject({ start: '2018-03', current: true, monthGuessed: false });
    expect(findDateRange('2021.03 至今 产品经理')).toMatchObject({ start: '2021-03', current: true });
    expect(findDateRange('2021.03至今任职')).toMatchObject({ start: '2021-03', current: true });
  });

  it.each([
    '• Led the migration 2020-01 - 2020-06 across three teams',
    '- Led the migration 2020-01 - 2020-06',
    'Led the migration that ran from 2020-01 - 2020-06 across three teams and every office we had',
    'Led the migration 2020-01 - 2020-06.',
  ])('a date in what someone did makes no new job: %s', (line) => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', line));
    expect(d.fields.filter((f) => /^work\.1\./.test(f.path))).toEqual([]);
    expect(value(d, 'work.0.description')).toContain('2020-01');
  });
});

describe('identity numbers', () => {
  const ID = '110101199001011234';
  const leak = /110101199001011234|E1234567|123 456 782|13812345678|0412345678/;

  it.each([
    [`姓名：张三 身份证号 ${ID}`],
    [`姓名：张三 身份证号码：${ID}`],
    [`Name: Mia Harper ID number ${ID}`],
    [`Name: Mia Harper Passport: E1234567`],
    [`Passport: 0412345678`],
    [`证件号码：13812345678`],
    [`国籍：中国 护照号 E1234567`],
    [`地址：北京市 身份证 ${ID}`],
    [`TFN 123 456 782`],
    [`Tax file number: 123 456 782`],
  ])('stay out of the head of the file: %s', (line) => {
    const d = parseResume(lines(line));
    expect(JSON.stringify(d.fields)).not.toMatch(leak);
  });

  it.each([
    ['a summary', ['Summary', `Reliable. Passport number E1234567, ID ${ID}.`]],
    ['a job', ['Experience', 'Acme Pty Ltd 2019-01 - 2021-02', `• Verified as ID number ${ID}`]],
    ['a bare number in a job', ['Experience', 'Acme Pty Ltd 2019-01 - 2021-02', `• Staff record ${ID}`]],
    ['a skill', ['Skills', `Excel, 身份证号 ${ID}, Word`]],
    ['a major', ['Education', '2015-09 - 2019-06', `示例大学, 本科, 身份证 ${ID}`]],
    ['a project', ['Projects', 'Portal 2019-01 - 2020-01', `Passport number E1234567`]],
  ] as const)('stay out of %s', (_name, body) => {
    const d = parseResume(lines('Mia Harper', ...body));
    expect(JSON.stringify(d.fields)).not.toMatch(leak);
  });

  it('stay out of the cell after their label', () => {
    const d = parseResume([row('姓名：', '张三', '身份证号：', ID), row('Passport:', 'E1234567')]);
    expect(JSON.stringify(d.fields)).not.toMatch(leak);
    expect(value(d, 'basics.givenName')).toBe('三');
  });

  it('leave a line alone when no number follows the word', () => {
    const d = parseResume(lines('Mia Harper', 'Summary', 'Passport holder, happy to travel.'));
    expect(value(d, 'selfIntroduction')).toContain('Passport holder');
  });
});

describe('a Word file', () => {
  it('keeps lines apart that a table cell or a break holds together', () => {
    const got = linesOfHtml('<p>Contact</p><table><tr><td><p>jane@example.com</p><p>Brisbane</p></td><td>678<br />jane2@example.com</td></tr></table><p>LinkedIn<br />Second line</p>');
    expect(got.flatMap((l) => l.cells)).toEqual(['Contact', 'jane@example.com Brisbane', '678 jane2@example.com', 'LinkedIn', 'Second line']);
    expect(value(parseResume(linesOfHtml('<table><tr><td><p>jane@example.com</p><p>Brisbane</p></td></tr></table>')), 'contact.email')).toBe('jane@example.com');
  });
});

describe('a file made to hang the page', () => {
  it.each([
    ['spaces after a label', `x:${' '.repeat(40_000)}:`],
    ['one long word', 'a'.repeat(40_000)],
    ['spaces after a plus', `+1${' '.repeat(40_000)}`],
    ['many labels', 'x: '.repeat(14_000)],
    ['full-width spaces', `x:${'　'.repeat(40_000)}:`],
  ])('reads quickly: %s', (_name, line) => {
    const started = Date.now();
    parseResume(lines('Mia Harper', line, line, line));
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
