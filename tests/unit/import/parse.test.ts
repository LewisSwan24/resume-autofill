// Parsing made-up resumes end to end. Everything marked high has to be right: that is the hard limit of the design.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { draftToResume } from '../../../src/import/draft';
import { extractDocx } from '../../../src/import/extract/docx';
import { extractPdf, type PdfLoader } from '../../../src/import/extract/pdf';
import type { TextLine } from '../../../src/import/extract/types';
import { findDateRange } from '../../../src/import/parse/dates';
import { findPhone } from '../../../src/import/parse/contact';
import { parseResume, type Draft } from '../../../src/import/parse';

const CMAPS = `${path.resolve('node_modules/pdfjs-dist/cmaps').replace(/\\/g, '/')}/`;

async function linesOf(name: string): Promise<TextLine[]> {
  const data = new Uint8Array(readFileSync(path.join('fixtures', 'resume-samples', name)));
  const r = name.endsWith('.pdf')
    ? await extractPdf(data, getDocument as unknown as PdfLoader, CMAPS)
    : await extractDocx(data, (i) => mammoth.convertToHtml({ buffer: Buffer.from(i.arrayBuffer) } as never));
  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
  return r.lines;
}

const value = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.value;
const certainty = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.certainty;

/** Every field the parser calls certain, and what it must say. A certain field not listed here fails the test. */
const CERTAIN: Record<string, Record<string, string>> = {
  'zh-single.pdf': {
    'contact.email': 'zhiyuan.lin@example.com',
    'contact.phone': '13800138000',
    'contact.website': 'https://zhiyuan.example.com',
    'education.0.startDate': '2015-09',
    'education.0.endDate': '2019-06',
    'work.0.startDate': '2021-03',
    'work.0.current': 'true',
    'work.1.startDate': '2019-07',
    'work.1.endDate': '2021-02',
  },
  'en-single.pdf': {
    'contact.email': 'zhiyuan.lin@example.com',
    'contact.phone': '0412345678',
    'contact.linkedin': 'https://linkedin.com/in/zhiyuan-lin-example',
    'work.0.startDate': '2021-03',
    'work.0.current': 'true',
    'work.1.startDate': '2019-07',
    'work.1.endDate': '2021-02',
  },
  'en-two-columns.pdf': {
    'contact.email': 'mia.harper@example.com',
    'contact.phone': '0400111222',
    'contact.phoneCountryCode': '+61',
    'work.0.startDate': '2020-02',
    'work.0.current': 'true',
    'work.1.startDate': '2018-01',
    'work.1.endDate': '2020-01',
  },
  'zh-table.docx': {
    'contact.email': 'zhiyuan.lin@example.com',
    'contact.phone': '13800138000',
    'education.0.startDate': '2015-09',
    'education.0.endDate': '2019-06',
    'work.0.startDate': '2021-03',
    'work.0.current': 'true',
    'work.1.startDate': '2019-07',
    'work.1.endDate': '2021-02',
  },
  'en.docx': {
    'contact.email': 'noah.bennett@example.com',
    'contact.phone': '0400222333',
    'work.0.startDate': '2019-06',
    'work.0.current': 'true',
    'work.1.startDate': '2017-02',
    'work.1.endDate': '2019-05',
  },
};

describe.each(Object.keys(CERTAIN))('what is certain in %s', (file) => {
  it('is exactly what the file says, with nothing else claimed', async () => {
    const draft = parseResume(await linesOf(file));
    const claimed = Object.fromEntries(draft.fields.filter((f) => f.certainty === 'high').map((f) => [f.path, f.value]));
    expect(claimed).toEqual(CERTAIN[file]);
  });
});

describe('what stays for the applicant to check', () => {
  it('reads a Chinese single column', async () => {
    const d = parseResume(await linesOf('zh-single.pdf'));
    expect(d.locale).toBe('zh-CN');
    expect(value(d, 'basics.familyName')).toBe('林');
    expect(value(d, 'basics.givenName')).toBe('知远');
    expect(certainty(d, 'basics.givenName')).toBe('check');
    expect(value(d, 'education.0.school')).toBe('华东示例大学');
    expect(value(d, 'education.0.degree')).toBe('bachelor');
    expect(value(d, 'education.0.major')).toBe('计算机科学与技术');
    expect(value(d, 'work.0.company')).toBe('示例科技有限公司');
    expect(value(d, 'work.0.position')).toBe('高级前端工程师');
    expect(value(d, 'work.0.description')).toContain('页面加载时间缩短 40%');
    expect(value(d, 'work.1.company')).toBe('虚构网络有限公司');
    expect(d.fields.filter((f) => f.path.startsWith('skills.')).map((f) => f.value)).toEqual(['TypeScript', 'React', 'Node.js']);
  });

  it('reads an English single column and splits a name with a nickname', async () => {
    const d = parseResume(await linesOf('en-single.pdf'));
    expect(d.locale).toBe('en-AU');
    expect(value(d, 'basics.givenName')).toBe('Zhiyuan');
    expect(value(d, 'basics.familyName')).toBe('Lin');
    expect(value(d, 'basics.preferredName')).toBe('Leo');
    expect(value(d, 'contact.address.city')).toBe('Brisbane');
    expect(value(d, 'contact.address.province')).toBe('QLD');
    expect(value(d, 'work.0.company')).toBe('Example Software Pty Ltd');
    expect(value(d, 'work.0.position')).toBe('Senior Frontend Engineer');
    expect(value(d, 'education.0.school')).toBe('University of Example');
    expect(value(d, 'education.0.major')).toBe('Computer Science');
    expect(value(d, 'education.0.degree')).toBe('bachelor');
    // A year alone: the month is a guess, so it is not called certain.
    expect(certainty(d, 'education.0.startDate')).toBe('check');
  });

  it('does not mix the two columns', async () => {
    const d = parseResume(await linesOf('en-two-columns.pdf'));
    expect(value(d, 'basics.givenName')).toBe('Mia');
    expect(value(d, 'education.0.school')).toBe('Example Institute of Design');
    expect(value(d, 'education.0.degree')).toBe('bachelor');
    expect(value(d, 'work.0.company')).toBe('Fictional Studio');
    expect(value(d, 'work.0.position')).toBe('Lead Product Designer');
    expect(value(d, 'work.1.company')).toBe('Pretend Agency');
    expect(d.fields.filter((f) => f.path.startsWith('skills.')).map((f) => f.value)).toEqual(['Figma', 'User research', 'Prototyping']);
    expect(value(d, 'contact.address.city')).toBe('Melbourne');
  });

  it('reads labels in a Chinese table, and keeps sensitive ones in yellow', async () => {
    const d = parseResume(await linesOf('zh-table.docx'));
    expect(value(d, 'basics.gender')).toBe('male');
    expect(certainty(d, 'basics.gender')).toBe('check');
    expect(value(d, 'basics.politicalStatus')).toBe('masses');
    expect(certainty(d, 'basics.politicalStatus')).toBe('check');
    expect(value(d, 'education.0.school')).toBe('华东示例大学');
    expect(value(d, 'education.0.major')).toBe('计算机科学与技术');
    expect(value(d, 'education.0.degree')).toBe('bachelor');
    expect(value(d, 'work.0.company')).toBe('示例科技有限公司');
    expect(value(d, 'work.0.position')).toBe('高级前端工程师');
  });

  it('reads comma-separated entries', async () => {
    const d = parseResume(await linesOf('en.docx'));
    expect(value(d, 'work.0.company')).toBe('Sample Logistics');
    expect(value(d, 'work.0.position')).toBe('Operations Analyst');
    expect(value(d, 'work.1.company')).toBe('Imaginary Freight');
    expect(value(d, 'education.0.school')).toBe('University of Nowhere');
    expect(value(d, 'education.0.major')).toBe('Commerce');
  });
});

const lines = (...texts: (string | string[])[]): TextLine[] =>
  texts.map((t) => (Array.isArray(t) ? { text: t.join(' '), cells: t, page: 1, fontSize: 0 } : { text: t, cells: [t], page: 1, fontSize: 0 }));

describe('what is never read', () => {
  it('leaves identity numbers out, in any form', () => {
    const d = parseResume(lines(['身份证号：', '110101199001011234', '护照：', 'E12345678'], '身份证号码：110101199001011234', 'Passport number: E12345678'));
    expect(JSON.stringify(d.fields)).not.toContain('110101199001011234');
    expect(JSON.stringify(d.fields)).not.toContain('E12345678');
  });

  it('does not take an identity number or a long reference for a phone', () => {
    expect(findPhone('110101199001011234')).toBeNull();
    expect(findPhone('Student ID 20150912')).toBeNull();
    expect(findPhone('Order 04123456789012')).toBeNull();
  });

  it('does not infer gender or anything like it from the text', () => {
    const d = parseResume(lines('Noah Bennett', 'He has led teams. Married to the job.', 'noah@example.com'));
    for (const p of ['basics.gender', 'basics.maritalStatus', 'basics.ethnicity', 'basics.politicalStatus']) expect(value(d, p)).toBeUndefined();
  });

  it('keeps a referee away from the contact details of the applicant', () => {
    const d = parseResume(lines('Noah Bennett', 'Referees', 'Pat Example, Manager', 'pat@example.com', '0411 111 111'));
    expect(value(d, 'contact.email')).toBeUndefined();
    expect(value(d, 'contact.phone')).toBeUndefined();
  });

  it('takes the applicant details when a referee comes first', () => {
    const d = parseResume(lines('Noah Bennett', 'Referees', 'pat@example.com', 'Experience', 'Sample Co, Analyst, 2019 - 2020', 'noah@example.com'));
    expect(value(d, 'contact.email')).toBe('noah@example.com');
  });

  it('does not call a word like a label a value', () => {
    const d = parseResume(lines('Skills', 'Excel, SQL'));
    expect(value(d, 'basics.givenName')).toBeUndefined();
  });

  it('does not take the word for resume for a name', () => {
    const d = parseResume(lines('个人简历', 'Curriculum Vitae', 'Resume'));
    expect(value(d, 'basics.familyName')).toBeUndefined();
    expect(value(d, 'basics.givenName')).toBeUndefined();
  });
});

describe('dates', () => {
  it.each([
    ['2021.03 - 至今', '2021-03', null, true],
    ['2019.07-2021.02', '2019-07', '2021-02', false],
    ['2019/7 ~ 2021/2', '2019-07', '2021-02', false],
    ['2019年7月 - 2021年2月', '2019-07', '2021-02', false],
    ['2019-07 to 2021-02', '2019-07', '2021-02', false],
    ['Mar 2021 - Present', '2021-03', null, true],
    ['September 2015 – June 2019', '2015-09', '2019-06', false],
    ['Sept 2015 - Jun 2019', '2015-09', '2019-06', false],
    ['2015 - 2019', '2015-01', '2019-12', false],
  ])('reads %s', (text, start, end, current) => {
    expect(findDateRange(text)).toMatchObject({ start, end, current });
  });

  it.each(['13800138000', '2019', 'Summer 2019', '2021 - 2019', 'Grew revenue 3.5 - 4.2 times', '40% - 50%'])('finds no range in %s', (text) => {
    expect(findDateRange(text)).toBeNull();
  });
});

describe('a draft becoming a resume', () => {
  it('passes the schema and stores what was read', async () => {
    const d = parseResume(await linesOf('en-single.pdf'));
    const r = draftToResume(d, { id: 'x', title: 'Mine', now: 1 });
    expect(r.contact.email).toBe('zhiyuan.lin@example.com');
    expect(r.work[0]).toMatchObject({ company: 'Example Software Pty Ltd', current: true, startDate: '2021-03', endDate: null });
    expect(r.education).toHaveLength(1);
    expect(r.skills.map((s) => s.name)).toEqual(['TypeScript', 'React', 'Node.js']);
  });

  it('leaves out what the schema refuses and keeps the rest', () => {
    const r = draftToResume(
      { locale: 'en-AU', fields: [
        { path: 'contact.email', value: 'a@example.com', certainty: 'high', line: 0 },
        { path: 'work.0.company', value: 'Sample', certainty: 'check', line: 1 },
        { path: 'work.0.startDate', value: 'not a date', certainty: 'check', line: 1 },
        { path: 'basics.gender', value: 'unknown', certainty: 'check', line: 2 },
      ] },
      { id: 'x', title: 'T' },
    );
    expect(r.contact.email).toBe('a@example.com');
    expect(r.work[0]).toMatchObject({ company: 'Sample', startDate: '' });
    expect(r.basics.gender).toBeNull();
  });
});
