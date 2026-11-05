// The second round of resumes that read as something they are not: what the first set of rules still let through.
import { describe, expect, it } from 'vitest';
import { draftToResume } from '../../../src/import/draft';
import type { TextLine } from '../../../src/import/extract/types';
import { MAX_DRAFT_FIELDS, parseResume, type Draft } from '../../../src/import/parse';

const lines = (...texts: string[]): TextLine[] => texts.map((text) => ({ text, cells: [text], page: 1, fontSize: 0 }));
const row = (...cells: string[]): TextLine => ({ text: cells.join(' '), cells, page: 1, fontSize: 0 });
const value = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.value;
const certainty = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.certainty;
const highs = (d: Draft): Record<string, string> => Object.fromEntries(d.fields.filter((f) => f.certainty === 'high').map((f) => [f.path, f.value]));

describe('identity numbers, however they are written', () => {
  const forms: [string, RegExp][] = [
    ['Passport | E12345678', /E12345678/],
    ['Passport No - E12345678', /E12345678/],
    ['Passport: E 12345678', /12345678/],
    ['Passport number is E12345678', /E12345678/],
    ['Passport (E12345678)', /E12345678/],
    ['TFN - 123 456 782', /456/],
    ['Tax File No. 123.456.782', /456/],
    ['SSN 123.45.6789', /6789/],
    ['E12345678 (passport)', /E12345678/],
    ['123 456 782 (TFN)', /456/],
    ['Passport: C01X00T47', /C01X00T47/],
    ['身份證字號：A123456789', /A123456789/],
    ['護照號碼：300123456', /300123456/],
    ['NRIC: S1234567A', /S1234567A/],
    ['HKID: A123456(7)', /A123456/],
    ['Aadhaar: 1234 5678 9012', /5678/],
    ['SIN: 123 456 789', /456/],
    ['National Insurance: QQ123456C', /QQ123456C/],
    ['NI Number: QQ 12 34 56 C', /QQ 12/],
    ['CPF: 123.456.789-09', /456/],
    ['DNI: 12345678Z', /12345678Z/],
    ['港澳通行证：C12345678', /C12345678/],
    ['Driving licence: 12345678', /12345678/],
    ["Driver's licence no. 12345678", /12345678/],
    ['110105 19491231 002X', /19491231/],
    ['110105-1949-1231-002X', /1949/],
  ];

  it.each(forms)('%s stays out of every free-text part', (line, leak) => {
    for (const body of [['Summary', line], ['Skills', line], ['Experience', 'Acme Pty Ltd 2019-01 - 2021-02', `• ${line}`], ['Projects', 'Portal 2019-01 - 2020-01', line]]) {
      const d = parseResume(lines('Mia Harper', ...body));
      expect(JSON.stringify(d.fields), body[0]).not.toMatch(leak);
    }
  });

  it.each([
    [['Passport Number', 'E12345678']],
    [['身份证号', '110105194912310021']],
    [['Tax File Number', '123 456 782']],
  ])('stay out when the number is on the line after the word: %j', (pair) => {
    const d = parseResume(lines('Mia Harper', 'Skills', ...pair, 'Excel'));
    expect(JSON.stringify(d.fields)).not.toMatch(/E12345678|110105|456/);
    expect(value(d, 'skills.0.name')).toBe('Excel');
  });

  it.each([
    [row('Passport No (China)', 'E12345678')],
    [row('ID Number*', '12345678')],
    [row('Tax File Number', '123 456 782')],
  ])('stay out of the cell beside a label that is not word for word: %j', (cells) => {
    const d = parseResume([row('Mia Harper'), cells]);
    expect(JSON.stringify(d.fields)).not.toMatch(/E12345678|12345678|456/);
  });

  it('keep what stands before the word on the line', () => {
    const d = parseResume(lines('姓名：张三 身份证号 110101199001011234'));
    expect(value(d, 'basics.givenName')).toBe('三');
  });

  it.each([
    ['Grew revenue to $1,200,000 in two years', '$1,200,000'],
    ['Cut costs by 12.5% across 3 teams', '12.5%'],
    ['Passport holder, happy to travel', 'Passport holder'],
    ['Handled the ID checks for 200 staff', 'ID checks'],
    ['Reduced load time from 4000 ms to 900 ms', '4000 ms'],
    ['Worked with the medicare team through 2019', 'medicare team'],
  ])('leave ordinary numbers and words alone: %s', (line, kept) => {
    const d = parseResume(lines('Mia Harper', 'Summary', line));
    expect(value(d, 'selfIntroduction')).toContain(kept);
  });
});

describe('the word id is no reason to touch a line', () => {
  it.each([
    ['Email ID: xyz12345.smith@example.com', 'xyz12345.smith@example.com'],
    ['E-mail ID: ab1234_lee@example.com', 'ab1234_lee@example.com'],
    ['id12345.lee@example.com', 'id12345.lee@example.com'],
    ['Email ID: abc1234@example.com', 'abc1234@example.com'],
  ])('%s keeps the whole address', (line, email) => {
    expect(value(parseResume(lines('Mia Harper', line)), 'contact.email')).toBe(email);
  });

  it('keeps a link with an id in it', () => {
    expect(value(parseResume(lines('Mia Harper', 'www.example.com/id12345/portfolio')), 'contact.website')).toBe('https://www.example.com/id12345/portfolio');
  });

  it('keeps dates on a line that names a government scheme', () => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Medicare 2019 - 2021'));
    expect(value(d, 'work.0.startDate')).toBe('2019-01');
  });
});

describe('a phone number', () => {
  it('stands alone in its cell', () => {
    const d = parseResume([row('Mia Harper'), row('+61 412 345 678', '15 George St')]);
    expect(value(d, 'contact.phone')).toBe('0412345678');
  });

  it.each([
    '+1 415 555 2671 12 Main St',
    '+44 20 7946 0958 12 High St',
    '+1000000 users',
    '学号：16307130123',
    'ABN 13456789012',
    'Student number 13800138000',
  ])('is not read out of a line that goes on about something else: %s', (line) => {
    expect(value(parseResume(lines('Mia Harper', line)), 'contact.phone')).toBeUndefined();
  });

  it('keeps the real mobile below a number that is something else', () => {
    const d = parseResume(lines('张三', '学号：16307130123', '13800138000'));
    expect(value(d, 'contact.phone')).toBe('13800138000');
  });

  it('has a country code to check when only its shape suggests one', () => {
    const d = parseResume(lines('Mia Harper', '0412-345678'));
    expect(value(d, 'contact.phoneCountryCode')).toBe('+61');
    expect(certainty(d, 'contact.phoneCountryCode')).toBe('check');
    const us = parseResume(lines('Mia Harper', '14155552671'));
    expect(certainty(us, 'contact.phoneCountryCode')).toBe('check');
  });

  it('has a certain code when it was written with one', () => {
    const d = parseResume(lines('Mia Harper', '+61 412 345 678'));
    expect(certainty(d, 'contact.phone')).toBe('high');
    expect(certainty(d, 'contact.phoneCountryCode')).toBe('high');
  });

  it('under a label further down does not replace the one at the top', () => {
    const d = parseResume(lines('Asha Rao', 'asha@example.com | +61 412 345 678', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', 'Phone: 07 3000 1234'));
    expect(value(d, 'contact.phone')).toBe('0412345678');
    expect(JSON.stringify(d.fields)).not.toContain('0730001234');
  });
});

describe('someone else’s details', () => {
  it('on a line that says whose they are stay out', () => {
    const d = parseResume(lines('张三', '13800138000', '紧急联系人：王芳　电话：13900139000'));
    expect(value(d, 'contact.phone')).toBe('13800138000');
    expect(JSON.stringify(d.fields)).not.toContain('13900139000');
  });

  it.each(['Referee details', 'Referees', 'Reference contacts', 'Emergency contact details'])('under %s stay out', (heading) => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02', heading, 'Alex Doe', 'alex.doe@example.com', '0400 111 222'));
    expect(JSON.stringify(d.fields)).not.toMatch(/alex|0400111222/i);
  });

  it('under a subheading inside that part stay out too', () => {
    const d = parseResume(lines('Mia Harper', 'Referees', 'Contact', 'alex.doe@example.com', '0400 111 222'));
    expect(JSON.stringify(d.fields)).not.toMatch(/alex|0400111222/i);
  });

  it('a section after them is the applicant’s again', () => {
    const d = parseResume(lines('Mia Harper', 'Referees', 'Alex Doe', 'Skills', 'Excel'));
    expect(value(d, 'skills.0.name')).toBe('Excel');
  });

  it('in a note above the resume are not called certain', () => {
    const d = parseResume(lines('Please reply to careers@acme.example or call 0499 111 222.', 'Mia Harper', 'Experience', 'Acme Pty Ltd 2019-01 - 2021-02'));
    expect(certainty(d, 'contact.email')).not.toBe('high');
    expect(value(d, 'contact.phone')).toBeUndefined();
  });
});

describe('a value is only certain when its shape proves it', () => {
  it.each(['微信：同手机号', '微信：wx123 QQ 12345', 'WeChat: abc123 Email asha@example.com', '微信：wxid_abc123'])('%s is one to check', (line) => {
    expect(certainty(parseResume(lines('Mia Harper', line)), 'contact.wechat')).toBe('check');
  });

  it.each(['asha@example.comLinkedIn', 'asha@example.com1'])('%s is not called certain', (line) => {
    expect(certainty(parseResume(lines('Mia Harper', line)), 'contact.email')).not.toBe('high');
  });

  it('a plain address on the top line is', () => {
    expect(highs(parseResume(lines('Mia Harper', 'asha@example.com')))).toEqual({ 'contact.email': 'asha@example.com' });
  });
});

describe('a line that says what someone did', () => {
  it.each([
    'Led the migration Mar 2019 - Jun 2019',
    'Managed the rollout 2019-03 - 2019-06',
    'Built the portal 2019 - 2020',
    'Delivered training Jan 2020 - Mar 2020',
  ])('is no new job: %s', (line) => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2018-01 - 2021-02', line, 'Other Pty Ltd 2016-01 - 2017-12'));
    expect(d.fields.filter((f) => f.path.endsWith('.startDate')).map((f) => f.value)).toEqual(['2018-01', '2016-01']);
  });
});

describe('the check page gets one box per field', () => {
  it.each([
    [['Mia Harper', '0412 345 678']],
    [['Mia Harper', 'Phone: 0412 345 678', '0412 345 678']],
    [['Mia Harper', 'Experience', 'Acme Pty Ltd 2018-01 - 2021-02', 'ops@acme.example', 'Contact', 'mia@example.com']],
  ])('%j', (texts) => {
    const paths = parseResume(lines(...texts)).fields.map((f) => f.path);
    expect(paths.length).toBe(new Set(paths).size);
  });

  it('prefers what is certain when the same field turns up twice', () => {
    const d = parseResume(lines('Mia Harper', 'Experience', 'Acme Pty Ltd 2018-01 - 2021-02', 'ops@acme.example', 'Contact', 'mia@example.com'));
    expect(value(d, 'contact.email')).toBe('mia@example.com');
  });
});

describe('a resume with a phone that names no code', () => {
  it('saves the code that goes with its language, not the default for another', () => {
    const d = parseResume(lines('Mia Harper', 'Phone: 07 3000 1234'));
    const resume = draftToResume(d, { id: 'x', title: 't' });
    expect(resume.locale).toBe('en-AU');
    expect(resume.contact.phoneCountryCode).toBe('+61');
  });
});

describe('a file with far too much in it', () => {
  it.each([
    ['dated lines', Array.from({ length: 200_000 }, (_, i) => `Job ${i} 2019-01 - 2020-01`)],
    ['skills', ['Skills', ...Array.from({ length: 200_000 }, (_, i) => `Skill ${i}`)]],
    ['headings', Array.from({ length: 200_000 }, (_, i) => (i % 2 ? 'Experience' : 'Skills'))],
  ])('parses and saves quickly: %s', (_name, texts) => {
    const started = Date.now();
    const many = ['Mia Harper', 'Experience', ...texts].map((text) => ({ text, cells: [text], page: 1, fontSize: 0 }));
    const d = parseResume(many);
    expect(d.fields.length).toBeLessThanOrEqual(MAX_DRAFT_FIELDS);
    draftToResume(d, { id: 'x', title: 't' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('a resume in traditional characters', () => {
  const draft = parseResume(
    lines(
      '林知遠',
      '電話：+886 912 345 678',
      '電子郵箱：zhiyuan.lin@example.com',
      '性別：男',
      '婚姻狀況：未婚',
      '籍貫：四川成都',
      '身分證字號：A123456789',
      '自我介紹',
      '熱愛虛構的工作。',
      '教育背景',
      '虛構大學 碩士 資訊工程 2018.09 - 2020.06',
      '工作經歷',
      '虛構科技有限公司 軟體工程師 2020.07 - 至今',
      '負責虛構系統的開發。',
      '專業技能',
      'TypeScript、React',
      '緊急聯絡人',
      '電話：+886 987 654 321',
    ),
  );
  const value = (path: string) => draft.fields.find((f) => f.path === path)?.value;

  it('reads the labels and the headings', () => {
    expect(value('contact.email')).toBe('zhiyuan.lin@example.com');
    expect(value('contact.phone')).toBe('912345678');
    expect(value('contact.phoneCountryCode')).toBe('+886');
    expect(value('basics.gender')).toBe('male');
    expect(value('basics.maritalStatus')).toBe('single');
    expect(value('selfIntroduction')).toContain('虛構');
    expect(value('education.0.degree')).toBe('master');
    expect(value('work.0.current')).toBe('true');
    expect(value('skills.0.name')).toBe('TypeScript');
  });

  it('leaves what the applicant wrote in the characters they wrote it in', () => {
    expect(value('basics.familyName')).toBe('林');
    expect(value('basics.givenName')).toBe('知遠');
    expect(value('basics.nativePlace.city')).toBe('四川成都');
    expect(value('education.0.school')).toBe('虛構大學');
    expect(value('work.0.company')).toBe('虛構科技有限公司');
    expect(value('work.0.position')).toBe('軟體工程師');
  });

  it('keeps out the identity number and the other person', () => {
    expect(JSON.stringify(draft.fields)).not.toContain('A123456789');
    expect(JSON.stringify(draft.fields)).not.toContain('987');
  });
});

describe('one line for one school or job, parted by single spaces', () => {
  const value = (d: Draft, path: string) => d.fields.find((f) => f.path === path)?.value;

  it('tells school, degree and subject apart', () => {
    const d = parseResume(lines('林知远', '教育背景', '虚构大学 硕士 信息工程 2018.09 - 2020.06'));
    expect(value(d, 'education.0.school')).toBe('虚构大学');
    expect(value(d, 'education.0.degree')).toBe('master');
    expect(value(d, 'education.0.major')).toBe('信息工程');
  });

  it('tells company and title apart', () => {
    const d = parseResume(lines('林知远', '工作经历', '虚构科技有限公司 软件工程师 2020.07 - 至今'));
    expect(value(d, 'work.0.company')).toBe('虚构科技有限公司');
    expect(value(d, 'work.0.position')).toBe('软件工程师');
  });

  it('leaves English words together', () => {
    const d = parseResume(lines('Mia Harper', 'Education', 'Fictional University, Bachelor of Design, 2018 - 2020'));
    expect(value(d, 'education.0.school')).toBe('Fictional University');
    expect(value(d, 'education.0.major')).toBe('Design');
  });
});
