// What is promised about identity numbers now. A number beside the word for a document comes out, and so does a Chinese
// ID number, which has a shape nothing else has. Beyond that no pattern can promise anything: the ways to write a number
// have no end, and no shape tells one from a phone. So the source stays folded, nothing with such a number is called
// certain, and whatever has a format of its own has to meet it. Phones and dates are not to be harmed along the way.
import { describe, expect, it } from 'vitest';
import type { TextLine } from '../../../src/import/extract/types';
import { parseResume, type Draft } from '../../../src/import/parse';
import { cleanLines, titleFromFileName } from '../../../src/import/parse/clean';

const line = (text: string): TextLine => ({ text, cells: [text], page: 1, fontSize: 0 });
const row = (...cells: string[]): TextLine => ({ text: cells.join(' '), cells, page: 1, fontSize: 0 });
const read = (lines: TextLine[]): string => cleanLines(lines).map((l) => l.text).join('\n');
const kept = (d: Draft): string => JSON.stringify(d.fields);

/** The digits or code in a form that survives any spacing, to look for wherever it may have gone. */
const compact = (s: string): string => s.normalize('NFKC').replace(/[\s()（）–—-]/g, '');

const NUMBERS: [string, string][] = [
  ['身份证：１１０１０１１９９００３０７１２３４', '110101199003071234'],
  ['Passport：Ｅ１２３４５６７８', 'E12345678'],
  ['Reisepass: C01X00T47', 'C01X00T47'],
  ['身分證字號：A123456789', 'A123456789'],
  ['公民身份号码：E12345678', 'E12345678'],
  ['ID: S1234567D', 'S1234567D'],
  ['IC No: 900101-14-5678', '900101145678'],
  ['Tax ID: 12-3456789', '123456789'],
  ['Social Insurance Number: 046 454 286', '046454286'],
  ['Aadhar: 1234 5678 9012', '123456789012'],
  ['Pasaporte: AB123456', 'AB123456'],
  ['パスポート番号: TK1234567', 'TK1234567'],
  ['주민등록번호: 900101-1234567', '9001011234567'],
  ['HK ID: A123456(7)', 'A1234567'],
  ['驾驶执照：123456789012', '123456789012'],
  ['军官证：12345678', '12345678'],
  ['社会保险号：12345678', '12345678'],
  ['护 照：E12345678', 'E12345678'],
  ['身 份 证 号：E12345678', 'E12345678'],
  ['ID  Number: 123456789', '123456789'],
  ['ID Number: 123456789', '123456789'],
  ['passport: E12345678', 'E12345678'],
  ['Driver licence: S12345', 'S12345'],
  ['Driver licence: 12345', '12345'],
  ['Passport: X12345', 'X12345'],
  ['护照号：E1234', 'E1234'],
  ['SSN 123–45–6789', '123456789'],
  ['TFN 123—456—782', '123456782'],
  ['PAN: ABCDE1234F', 'ABCDE1234F'],
  ['E12345678 (passport)', 'E12345678'],
  // A word and something said about it before the colon, then a code that is only letters and digits to begin with.
  ['护照（中国）：E12345678', 'E12345678'],
  ['Passport (Australia): PA1234567', 'PA1234567'],
  ['Passport of China: E12345678', 'E12345678'],
  ['Passport: X-1234567', 'X1234567'],
  ['ID: A-123456', 'A123456'],
  ['护照号：ABCDEF1234', 'ABCDEF1234'],
  ['护照编号：E12345678', 'E12345678'],
  ['Passport Nr. E12345678', 'E12345678'],
  ['Passport No ABCDEF1234', 'ABCDEF1234'],
  ['护照 G12345678 家庭地址：上海', 'G12345678'],
  // A year inside a code is no date.
  ['Passport: E2012', 'E2012'],
  ['Driver licence: S1990', 'S1990'],
  ['ID: P2020A', 'P2020A'],
  ['Passport: 2012-34', '201234'],
  // A Chinese ID number has a shape of its own.
  ['110101199003071234', '110101199003071234'],
  ['1101 0119 9003 0712 34', '110101199003071234'],
  ['110105-1949-1231-002X', '110105194912310002X'.slice(0, 18)],
  ['110101900307123', '110101900307123'],
];

describe('a label with its code in the next cell or on the next line', () => {
  it.each([
    ['护照号码', 'X-1234567'],
    ['Passport No.', 'ABCDEF1234'],
  ])('%s %s', (label, code) => {
    expect(compact(read([row(label, code)]))).not.toContain(compact(code));
    expect(compact(read([line(label), line(code)]))).not.toContain(compact(code));
  });

  it('a skill on the next line is no code', () => {
    expect(read([line('Passport No.'), line('Redis 7 and Kafka')])).toContain('Redis 7 and Kafka');
  });
});

describe('a number with the word for a document beside it', () => {
  it.each(NUMBERS)('comes out: %s', (text, number) => {
    const lines = [line('Mia Harper'), line('Skills'), line(text), line('Summary'), line(text), line('Experience'), line(`Fictional Studio, ${text}, 2020-01 - 2021-01`)];
    expect(compact(read(lines))).not.toContain(number);
    expect(compact(kept(parseResume(lines)))).not.toContain(number);
  });

  it.each([
    ['a colon in a cell of its own', [row('Passport', ':', 'E12345678')]],
    ['the label on the line above', [line('Passport'), line('E12345678')]],
    ['the digits in cells of their own', [row('身份证号', '1101', '0119', '9003', '0712', '34')]],
    ['the code in cells of its own', [row('Passport', 'E123', '45678')]],
  ])('comes out with %s', (_name, lines) => {
    expect(compact(read(lines))).not.toMatch(/E12345678|110101199003071234/);
  });
});

describe('a number with nothing to say what it is', () => {
  it.each([
    ['a row of headings over a row of values', [row('Name', 'Passport No.', 'Phone'), row('Mia', 'E12345678', '0412 345 678')]],
    ['the number before its label, in cells', [row('E12345678', 'Passport')]],
    ['the number on the line above its label', [line('E12345678'), line('Passport')]],
    ['a table read as all labels and then all values', [line('Name'), line('Passport No.'), line('Mia'), line('E12345678')]],
    ['a long sentence', [line('Passport'), line('Number issued to me is E12345678 and stays valid')]],
    ['no word at all', [line('E12345678')]],
  ])('is never called certain, with %s', (_name, lines) => {
    const d = parseResume([line('Mia Harper'), line('Summary'), ...lines, line('Experience'), ...lines]);
    for (const f of d.fields) if (f.value.includes('E12345678')) expect(f.certainty, f.path).toBe('check');
  });
});

describe('ordinary things with numbers in them', () => {
  it.each([
    '杭州市人力资源和社会保障局 实习生 2021年9月-2022年6月',
    '办理 300 名员工社会保险',
    'Implemented OAuth 2.0 with Passport.js',
    'Express, Passport, Redis 7',
    'Processed 1200 passport applications for clients',
    'ISO27001 social security audit lead',
    '负责社保 2.0 系统开发',
    'Upgraded Passport 0.6 to 0.7 across services',
    'Upgraded Passport v2.1 for the login service',
    '负责社保 300 人的缴纳工作',
    'Passport.js: v0.6 upgrade',
    'Passport.js: OAuth2 login',
    '身份证识别准确率:99%',
    '社保专员:2年',
    'Passport, Python3, Redis',
  ])('a word beside numbers that are not its number stays whole: %s', (text) => {
    expect(read([line(text)])).toBe(text);
  });

  it.each(['Medicare 2019 - 2021', 'Passport renewed 2019-03'])('keep a real date beside the word: %s', (text) => {
    expect(read([line(text)])).toBe(text);
  });

  it.each(['13812345678', '+8613812345678', '0412345678', '(02) 9876 5432', '03/2019 - 06/2023', '07/03/1990', '2018.09 - 2020.06', 'Started on 2019-01-15', 'Grew revenue by 40%, $120,000 in all', 'mia.harper@example.com', 'https://example.com/u/12345678', 'Python3, K8s, Web3, Q3 2019, S3', 'ISO9001', 'CS1234567 database systems'])('stay as they are: %s', (text) => {
    expect(read([line(text)])).toBe(text);
  });

  it.each([
    ['微信：lewis123456', 'lewis123456'],
    ['负责 100-200 人团队，年薪 200000', '负责 100-200 人团队,年薪 200000'],
  ])('stay whole in what is kept: %s', (text, part) => {
    expect(kept(parseResume([line('Mia Harper'), line('Summary'), line(text)]))).toContain(part);
  });

  it.each([
    [['驾驶证：C1 手机：13812345678'], '13812345678'],
    [['驾照 C1', '电话：010-12345678'], '01012345678'],
  ])('keep the phone beside a licence: %j', (texts, phone) => {
    const d = parseResume([line('Mia Harper'), ...texts.map(line)]);
    expect(d.fields.find((f) => f.path === 'contact.phone')?.value.replace(/\D/g, '')).toBe(phone);
  });
});

describe('a file named after what is in it', () => {
  it.each([
    ['Mia Harper 110101199003071234.pdf', 'Mia Harper'],
    ['Mia_E12345678.docx', 'Mia_'],
    ['Mia １１０１０１１９９００３０７１２３４.pdf', 'Mia'],
    ['简历2024.pdf', '简历2024'],
    ['Mia Harper resume.pdf', 'Mia Harper resume'],
  ])('%s', (name, title) => {
    expect(titleFromFileName(name)).toBe(title);
  });
});

describe('what has a format of its own', () => {
  const value = (d: Draft, path: string) => d.fields.find((f) => f.path === path)?.value;

  it.each(['0412 345 678 123 456 782', '+61 412 345 678 123 456 782', '13812345678 123456'])('takes no phone out of a longer number: %s', (text) => {
    expect(value(parseResume([line('Mia Harper'), line(text)]), 'contact.phone')).toBeUndefined();
  });

  it('leaves free text to check', () => {
    const d = parseResume([line('Mia Harper'), line('Summary'), line('Built fictional things for fictional people.')]);
    expect(d.fields.find((f) => f.path === 'selfIntroduction')?.certainty).toBe('check');
  });
});

describe('what the words about identity no longer take with them', () => {
  const value = (d: Draft, path: string) => d.fields.find((f) => f.path === path)?.value;

  it('keeps a phone and an email on the line that mentions a licence', () => {
    const d = parseResume([line('Mia Harper'), line('0412 345 678 | mia.harper@example.com | Full driver’s licence')]);
    expect(value(d, 'contact.phone')).toBe('0412345678');
    expect(value(d, 'contact.email')).toBe('mia.harper@example.com');
  });

  it.each(['Australian passport holder', 'Driver’s licence', 'Full driver’s licence'])('keeps the phone on the line after: %s', (text) => {
    const d = parseResume([line('Mia Harper'), line(text), line('0412 345 678')]);
    expect(value(d, 'contact.phone')).toBe('0412345678');
  });

  it('keeps the rest of a list when one part of it names a document', () => {
    expect(read([line('Canberra ACT | Passport: E12345678 | Open to travel')])).toMatch(/Canberra ACT.*Open to travel/);
  });
});

describe('what the file does not prove stays to be checked', () => {
  const certainty = (lines: TextLine[], path: string) => parseResume(lines).fields.find((f) => f.path === path)?.certainty;

  it.each([
    ['someone else’s email above', [line('Mia Harper'), line('Agent: jane@agency.example'), line('mia@example.com')]],
    ['a manager in the contact part', [line('Mia Harper'), line('Contact'), line('Manager: bob@corp.example')]],
  ])('email: %s', (_name, lines) => {
    expect(certainty(lines, 'contact.email')).toBe('check');
  });

  it.each([
    ['a recruiter', [row('Recruiter: Jane Doe', '0412 345 678')]],
    ['a parent', [row('Father', '0412 111 222')]],
    ['父亲', [row('父亲', '13812345678')]],
  ])('phone beside %s', (_name, lines) => {
    expect(certainty([line('Mia Harper'), ...lines], 'contact.phone') ?? 'check').toBe('check');
  });

  it.each([
    ['Dad | 0412 111 222'],
    ['爸爸 | 13812345678'],
    ['李教授 | 13812345678'],
    ['Jane Doe | 0412 111 222'],
  ])('phone with a person on the line: %s', (text) => {
    expect(certainty([line('Mia Harper'), line(text)], 'contact.phone') ?? 'check').toBe('check');
  });

  it.each(['Mum mum@family.example', 'Prof. Wang | wang@uni.example', '学历：本科 导师 tutor@uni.example', '性别：男 联系人 li@x.example'])('email with a person on the line: %s', (text) => {
    expect(certainty([line('Mia Harper'), line(text)], 'contact.email') ?? 'check').toBe('check');
  });

  it('email under a line that says whose', () => {
    expect(certainty([line('Mia Harper'), line('Agent:'), line('agent@x.example')], 'contact.email')).toBe('check');
    expect(certainty([line('Mia Harper'), line('Father'), line('0412 111 222')], 'contact.phone') ?? 'check').toBe('check');
  });

  it.each(['Mob: 0412 345 678', 'Ph: 0412 345 678', 'Cell: 0412 345 678', '联系方式：13812345678', 'Mobile 0412 345 678'])('reads a phone under its own label: %s', (text) => {
    expect(certainty([line('Mia Harper'), line(text)], 'contact.phone')).toBe('high');
  });

  it('a town right after the name is no person', () => {
    const lines = [line('Mia Harper'), line('Canberra ACT | 0412 345 678 | mia@example.com')];
    expect(certainty(lines, 'contact.phone')).toBe('high');
    expect(certainty(lines, 'contact.email')).toBe('high');
  });

  it('a site on a line about somewhere else', () => {
    expect(certainty([line('Mia Harper'), line('Currently at Acme Pty Ltd | www.acme.example')], 'contact.website') ?? 'check').toBe('check');
  });

  it('two different emails: neither is certain', () => {
    expect(certainty([line('Mia Harper'), line('mia@example.com'), line('mia.h@example.org')], 'contact.email')).toBe('check');
  });

  it('dates on a line that says nothing about a job', () => {
    expect(certainty([line('Mia Harper'), line('Experience'), line('Visa valid 2023.01 - 2026.01')], 'work.0.startDate') ?? 'check').toBe('check');
  });

  it.each([
    'Mia Harper | 0412 345 678 | mia@example.com | Canberra, ACT 2600',
    '林知远  电话：13800138000  邮箱：mia@example.com  现居城市：上海',
    '林知遠 | 男 | 28歲 | 13800138000 | mia@example.com',
    '性别：女  年龄：28  微信：lin_zy  手机：13800138000  邮箱：mia@example.com',
    'Email: mia@example.com | Phone: 0412 345 678 | LinkedIn: https://linkedin.com/in/mia',
  ])('still trusts the applicant saying these things of themselves: %s', (text) => {
    const lines = [line(text)];
    expect(certainty(lines, 'contact.email')).toBe('high');
    expect(certainty(lines, 'contact.phone')).toBe('high');
  });

  it.each(['联系人：王小明  13800138000', '紧急联系人 13800138000', '导师电话：13800138000'])('leaves another person’s number to be checked: %s', (text) => {
    expect(certainty([line('林知远'), line(text)], 'contact.phone') ?? 'check').toBe('check');
  });

  it('still trusts a contact line of nothing but contact details', () => {
    const lines = [line('Mia Harper | 0412 345 678 | mia@example.com | Canberra ACT')];
    expect(certainty(lines, 'contact.email')).toBe('high');
    expect(certainty(lines, 'contact.phone')).toBe('high');
  });
});

describe('a line built to be heavy', () => {
  it('cuts a row of far too many cells', () => {
    const many = row(...Array.from({ length: 20_000 }, (_, i) => `cell ${i} with some words`));
    const [cleaned] = cleanLines([many]);
    expect(cleaned!.text.length).toBeLessThanOrEqual(4000);
    expect(cleaned!.cells.length).toBeLessThanOrEqual(50);
  });
});
