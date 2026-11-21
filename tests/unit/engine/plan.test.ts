import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileData } from '../../../src/drivers/types';
import { fieldKeyLabel, planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import type { Classification, FieldContext } from '../../../src/engine/types';
import { ResumeSchema, createSampleProfile } from '../../../src/schema';
import { LANGUAGES, mlist, mtext } from '../../shared/mokaMobileForm';

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  document.body.innerHTML = '';
});

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;
const row = (label: string, control: string, id: string) => `<div><label for="${id}">${label}</label>${control}</div>`;
const text = (label: string, id: string) => row(label, `<input id="${id}" type="text">`, id);

function plan(html: string, resume = zh, files: Record<string, FileData> = {}) {
  document.body.innerHTML = html;
  const scan = scanDocument(document);
  return { scan, plan: planFill(scan.contexts, scan.classifications, resume, files) };
}
const stepOf = (p: ReturnType<typeof plan>, label: string) =>
  p.plan.steps.find((s) => s.label === label);
const reportOf = (p: ReturnType<typeof plan>, label: string) =>
  p.plan.reports.find((r) => r.label === label);

describe('planFill on a small zh form', () => {
  const html = `
    <h3>基本信息</h3>
    ${text('姓名', 'a')}
    ${text('QQ', 'b')}
    ${row('出生年月', '<input id="c" type="month">', 'c')}
    ${row('政治面貌', '<select id="d"><option value="">请选择</option><option>中共党员</option><option>共青团员</option><option>群众</option></select>', 'd')}
    ${text('验证码', 'e')}
    ${text('完全无关的字段', 'f')}
    <h3>实习经历</h3>
    ${text('公司名称', 'g')}
    ${row('结束时间', '<input id="h" type="month">', 'h')}
    <label><input type="checkbox"> 至今</label>
  `;

  it('turns confident fields with data into steps', () => {
    const p = plan(html);
    expect(stepOf(p, '姓名')).toMatchObject({ fieldKey: 'basics.fullName', source: 'basics.familyName+givenName' });
    expect(stepOf(p, '姓名')!.intent).toEqual({ kind: 'text', text: '林知远' });
    expect(stepOf(p, '出生年月')!.intent).toMatchObject({ kind: 'date', display: '2002-03', year: 2002, month: 3 });
    expect(stepOf(p, '公司名称')).toMatchObject({ fieldKey: 'work.company', source: 'work[0].company', section: 'internship' });
  });

  it('resolves choices with matchOption against the page options', () => {
    const p = plan(html);
    const step = stepOf(p, '政治面貌')!;
    expect(step.intent.kind).toBe('choice');
    if (step.intent.kind !== 'choice') return;
    const options = p.scan.contexts[3]!.control.options!;
    const m = step.intent.match(options);
    expect(m.status === 'matched' && options[m.index]!.label).toBe('共青团员');
  });

  it('reports QQ as no_data (field known, resume empty)', () => {
    const p = plan(html);
    expect(stepOf(p, 'QQ')).toBeUndefined();
    expect(reportOf(p, 'QQ')).toMatchObject({ outcome: 'no_data', fieldKey: 'contact.qq' });
  });

  it('never fills captcha controls and reports them as unmatched', () => {
    const p = plan(html);
    expect(stepOf(p, '验证码')).toBeUndefined();
    expect(reportOf(p, '验证码')).toMatchObject({ outcome: 'unmatched', fieldKey: null });
  });

  it('leaves a control with nothing to call it by out of the report', () => {
    const p = plan(`${text('姓名', 'a')}<div><input type="file" tabindex="-1"></div>`);
    expect(p.plan.reports.map((r) => r.label)).toEqual(['姓名']);
    expect(p.plan.steps).toEqual([]);
  });

  it('still tells the user about a required control with nothing to call it by', () => {
    const p = plan('<div><input type="checkbox" required></div>');
    expect(p.plan.reports).toHaveLength(1);
    expect(p.plan.reports[0]!.label).not.toMatch(/^c\d+$/);
    expect(p.plan.reports[0]!.outcome).toBe('unmatched');
  });

  it('reports unknown labels as unmatched', () => {
    const p = plan(html);
    expect(reportOf(p, '完全无关的字段')).toMatchObject({ outcome: 'unmatched', fieldKey: null });
  });

  it('sends the 0.5–0.75 band to review with candidates and leaves the field empty', () => {
    // placeholder-only evidence (0.7) outside any section: below the fill threshold
    const p = plan('<input placeholder="邮箱">');
    const report = p.plan.reports.find((r) => r.outcome === 'needs_review')!;
    expect(report.label).toBe('邮箱');
    expect(report.candidates?.[0]).toMatchObject({ fieldKey: 'contact.email', label: '邮箱' });
    expect(p.plan.steps.some((s) => s.label === '邮箱')).toBe(false);
  });

  it('ticks 至今 for a current entry and gives its end date no step', () => {
    const resume = ResumeSchema.parse({
      id: 'r', title: 'r', locale: 'zh-CN',
      work: [{ kind: 'internship', company: '字节跳动', startDate: '2025-11', endDate: null, current: true }],
    });
    const p = plan(html, resume);
    expect(stepOf(p, '至今')).toMatchObject({ fieldKey: 'work.current', intent: { kind: 'check', checked: true } });
    expect(stepOf(p, '结束时间')).toBeUndefined();
    expect(reportOf(p, '结束时间')).toMatchObject({ outcome: 'no_data', fieldKey: 'work.endDate' });
  });

  it('every control is either a step or a report', () => {
    const p = plan(html);
    expect(p.plan.steps.length + p.plan.reports.length).toBe(p.scan.contexts.length);
    const ids = [...p.plan.steps.map((s) => s.fieldId), ...p.plan.reports.map((r) => r.fieldId)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('planFill: a gender question that lets you decline', () => {
  const form = row('性别', '<select id="a"><option value="">请选择</option><option>男</option><option>女</option><option>保密</option></select>', 'a');
  const pick = (resume: typeof zh) => {
    const p = plan(form, resume);
    const step = stepOf(p, '性别')!;
    if (step.intent.kind !== 'choice') throw new Error('not a choice');
    const options = p.scan.contexts[0]!.control.options!;
    const m = step.intent.match(options);
    return m.status === 'matched' ? options[m.index]!.label : m.status;
  };

  it('declines unless the resume says otherwise', () => {
    const { diversity: _, ...rest } = zh;
    expect(pick(ResumeSchema.parse(rest))).toBe('保密');
  });

  it('answers from the resume when the resume says so', () => {
    expect(pick({ ...zh, diversity: { ...zh.diversity, genderAnswer: 'from_resume' } })).toBe('男');
  });
});

describe('planFill: data that the control cannot take', () => {
  it('reports no_data instead of writing a wrong kind of value', () => {
    // A text box asking "是否服从调剂" with only a bool in the resume still gets the label text;
    // a file control without an uploaded file has nothing to write.
    const p = plan(`<h3>附件</h3>${row('上传简历', '<input id="a" type="file">', 'a')}`, zh, {});
    expect(reportOf(p, '上传简历')).toMatchObject({ outcome: 'no_data', fieldKey: 'attachments.resume' });
  });

  it('plans a file step when the payload carries the file', () => {
    const file: FileData = { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:,' };
    const p = plan(`<h3>附件</h3>${row('上传简历', '<input id="a" type="file">', 'a')}`, zh, { 'sample-resume-zh': file });
    expect(stepOf(p, '上传简历')!.intent).toEqual({ kind: 'file', file });
  });
});

describe('cardDemand', () => {
  const card = (n: number) =>
    `<div class="card"><h4>教育经历 ${n}</h4>${text('学校', `s${n}`)}${text('专业', `m${n}`)}</div>`;

  it('needs 2 cards when the page has 1 and the resume 2 education entries', () => {
    const p = plan(`<section><h3>教育经历</h3>${card(1)}<button type="button">添加教育经历</button></section>`);
    expect(p.plan.cardDemand).toHaveLength(1);
    expect(p.plan.cardDemand[0]).toMatchObject({ section: 'education', have: 1, need: 2 });
    expect(p.plan.cardDemand[0]!.groupKey).toEqual(expect.any(String));
  });

  it('counts existing cards and fills each from its own entry', () => {
    const p = plan(`<section><h3>教育经历</h3>${card(1)}${card(2)}</section>`);
    expect(p.plan.cardDemand[0]).toMatchObject({ section: 'education', have: 2, need: 2 });
    const schools = p.plan.steps.filter((s) => s.fieldKey === 'education.school').map((s) => [s.source, s.intent]);
    expect(schools).toEqual([
      ['education[0].school', { kind: 'text', text: '浙江大学' }],
      ['education[1].school', { kind: 'text', text: '澳大利亚国立大学' }],
    ]);
  });

  it('measures internship cards against internship entries only', () => {
    const intern = (n: number) => `<div class="c"><h4>实习经历 ${n}</h4>${text('公司名称', `i${n}`)}${text('职位名称', `p${n}`)}</div>`;
    const resume = ResumeSchema.parse({
      id: 'r', title: 'r', locale: 'zh-CN',
      work: [{ kind: 'full_time', company: 'A' }, { kind: 'internship', company: 'B' }, { kind: 'internship', company: 'C' }],
    });
    const p = plan(`<section><h3>实习经历</h3>${intern(1)}</section>`, resume);
    expect(p.plan.cardDemand[0]).toMatchObject({ section: 'internship', have: 1, need: 2 });
  });

  it('reports a section without repeated cards as one implicit card', () => {
    const p = plan(`<h3>语言能力</h3>${text('外语语种', 'a')}${text('英语等级', 'b')}`);
    expect(p.plan.cardDemand).toEqual([{ section: 'languages', groupKey: null, have: 1, need: 1 }]);
  });

  it('ignores sections that are not repeatable', () => {
    const p = plan(`<h3>基本信息</h3>${text('姓名', 'a')}`);
    expect(p.plan.cardDemand).toEqual([]);
  });
});

// Chinese forms ask for English by test: a level (CET-4/6, TEM-4/8) with or without a score, or a score per test.
// Each test someone sat is one language entry: English, the test as its certificate, and the score.
describe('a question about English or about one test', () => {
  const LEVELS = ['未参加', '未通过', 'CET-4', 'CET-6', 'TEM-4', 'TEM-8', '雅思', '托福', '托业', '其他'];
  const select = (label: string, id: string, options = LEVELS) =>
    row(label, `<select id="${id}"><option value="">请选择</option>${options.map((o) => `<option>${o}</option>`).join('')}</select>`, id);
  const withLanguages = (languages: object[]) => ResumeSchema.parse({ ...zh, languages });
  const japaneseFirst = withLanguages([
    { language: '日语', proficiency: 'native', certificate: 'JLPT N1', score: '170' },
    { language: '英语', proficiency: 'intermediate', certificate: '大学英语四级', score: '501' },
    { language: '英语', proficiency: 'proficient', certificate: 'CET-6', score: '502' },
  ]);
  const shown = (p: ReturnType<typeof plan>, label: string) => {
    const intent = stepOf(p, label)?.intent as { text?: string; display?: string } | undefined;
    return intent?.text ?? intent?.display ?? null;
  };

  it('answers an English level and its score from the same, highest test, whatever language comes first', () => {
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a')}${text('英语成绩', 'b')}`, japaneseFirst);
    expect(stepOf(p, '英语等级')).toMatchObject({ fieldKey: 'languages.certificate', source: 'languages[2].certificate' });
    expect(shown(p, '英语等级')).toBe('CET-6');
    expect(stepOf(p, '英语成绩')).toMatchObject({ fieldKey: 'languages.score', source: 'languages[2].score' });
    expect(shown(p, '英语成绩')).toBe('502');
  });

  it('gives the score of the test a question names, and nothing when that test was not sat', () => {
    const p = plan(`<h3>个人信息</h3>${text('四级成绩', 'a')}${text('六级成绩', 'b')}${text('专八成绩', 'c')}`, japaneseFirst);
    expect(stepOf(p, '四级成绩')).toMatchObject({ fieldKey: 'languages.score', source: 'languages[1].score' });
    expect(stepOf(p, '六级成绩')).toMatchObject({ fieldKey: 'languages.score', source: 'languages[2].score' });
    expect(stepOf(p, '专八成绩')).toBeUndefined();
    expect(reportOf(p, '专八成绩')).toMatchObject({ fieldKey: 'languages.score', outcome: 'no_data' });
  });

  it('gives a score asked for another language that language, and nothing to one the resume lacks', () => {
    const englishFirst = withLanguages([
      { language: '英语', certificate: 'CET-6', score: '502' },
      { language: '日语', certificate: 'JLPT N1', score: '170' },
    ]);
    const p = plan(`<h3>语言能力</h3>${text('英语成绩', 'a')}${text('日语成绩', 'b')}${text('韩语成绩', 'c')}`, englishFirst);
    expect(stepOf(p, '英语成绩')).toMatchObject({ source: 'languages[0].score' });
    expect(stepOf(p, '日语成绩')).toMatchObject({ source: 'languages[1].score' });
    expect(stepOf(p, '韩语成绩')).toBeUndefined();
  });

  it('keeps English out of a question about the other languages, as Beisen asks beside 英语水平', () => {
    const englishFirst = withLanguages([{ language: '英语', certificate: 'CET-6' }, { language: '日语', certificate: 'JLPT N1' }]);
    const p = plan(`<h3>语言能力</h3>${select('英语水平', 'a', ['一般', '良好', '熟练', '精通'])}${text('其他外语', 'b')}`, englishFirst);
    expect(stepOf(p, '其他外语')).toMatchObject({ fieldKey: 'languages.language', source: 'languages[1].language' });
  });

  it('keeps English out of a Moka phone block whose advice, under its title, asks for the other languages', () => {
    const englishOnly = withLanguages([{ language: '英语', certificate: 'CET-6' }]);
    // On a phone the advice is a line of its own between the title and the fields.
    const block = (advice: string) =>
      `<div class="block-Bk2Lw9Qz0x"><div class="count-Cn4Tq7Vb2m">Step: 8/10</div><div class="title-Zx81Kd0Qwe fix-title-Fx0Ld3Kq8w"><span>语言能力</span></div>` +
      `<div class="describe-Dz2Lq8Nn4c">${advice ? `<span>${advice}</span>` : ''}</div><div class="progress-Pg5Rt2Hy7u" style="width: 80%;"></div>` +
      `<div class="mobile-layout__panel field-block-Fb6Hs1Jd4k"><div class="applyFields-Af3Gm7Pq2r">${mlist('语言类型', LANGUAGES)}${mtext('所获证书')}</div></div></div>`;
    const besides = plan(block('除英语外的其他外语能力'), englishOnly);
    expect(stepOf(besides, '语言类型')).toBeUndefined();
    expect(stepOf(besides, '所获证书')).toBeUndefined();
    const any = plan(block(''), englishOnly);
    expect(stepOf(any, '语言类型')).toMatchObject({ source: 'languages[0].language' });
  });

  it('reads 四六级 as English, not as one of the two tests', () => {
    const p = plan(`<h3>个人信息</h3>${text('四六级成绩', 'a')}`, japaneseFirst);
    expect(stepOf(p, '四六级成绩')).toMatchObject({ source: 'languages[2].score' });
  });

  it('takes the higher of two tests a question names, and tells 专业四级 from 四级', () => {
    const p = plan(`<h3>语言能力</h3>${text('四级/六级成绩', 'a')}${text('英语专业四级成绩', 'b')}`, japaneseFirst);
    expect(stepOf(p, '四级/六级成绩')).toMatchObject({ source: 'languages[2].score' });
    expect(stepOf(p, '英语专业四级成绩')).toBeUndefined();
  });

  it('gives nothing when none of the tests a question names was sat', () => {
    const p = plan(`<h3>语言能力</h3>${text('雅思/托福成绩', 'a')}`, japaneseFirst);
    expect(stepOf(p, '雅思/托福成绩')).toBeUndefined();
  });

  it('leaves an English question empty when the resume has no English', () => {
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a')}${text('英语成绩', 'b')}`, withLanguages([{ language: '日语', certificate: 'JLPT N1', score: '170' }]));
    expect(stepOf(p, '英语等级')).toBeUndefined();
    expect(stepOf(p, '英语成绩')).toBeUndefined();
  });

  it('answers how good the English is from the English entry, in a section of its own', () => {
    const p = plan(`<h3>语言能力</h3>${select('英语水平', 'a', ['一般', '良好', '熟练', '精通'])}`, japaneseFirst);
    expect(stepOf(p, '英语水平')).toMatchObject({ source: 'languages[2].proficiency' });
  });

  it('still takes language cards in order when a question names no language', () => {
    const p = plan(`<h3>语言能力</h3>${text('语种', 'a')}${text('成绩', 'b')}`, japaneseFirst);
    expect(stepOf(p, '语种')).toMatchObject({ source: 'languages[0].language' });
    expect(stepOf(p, '成绩')).toMatchObject({ source: 'languages[0].score' });
  });

  it('gives the overall score to 总分 only, never to the boxes for each skill beside it', () => {
    const ielts = withLanguages([{ language: '英语', certificate: '雅思', score: '7.5' }]);
    const skills = ['听力成绩', '阅读成绩', '写作成绩', '口语成绩'];
    const p = plan(`<h3>语言能力</h3>${text('语种', 'a')}${text('证书', 'b')}${text('总分', 'c')}${skills.map((l, i) => text(l, `s${i}`)).join('')}`, ielts);
    expect(stepOf(p, '总分')).toMatchObject({ fieldKey: 'languages.score', source: 'languages[0].score' });
    for (const label of skills) expect(stepOf(p, label)).toBeUndefined();
  });

  it('keeps an English form\'s skill scores empty too', () => {
    const ielts = withLanguages([{ language: 'English', certificate: 'IELTS', score: '7.5' }]);
    const skills = ['Listening score', 'Reading score', 'Writing score', 'Speaking score'];
    const p = plan(`<h3>Languages</h3>${text('Overall score', 'c')}${skills.map((l, i) => text(l, `s${i}`)).join('')}`, ielts);
    expect(stepOf(p, 'Overall score')).toMatchObject({ fieldKey: 'languages.score', source: 'languages[0].score' });
    for (const label of skills) expect(stepOf(p, label)).toBeUndefined();
  });

  it('lets two score boxes that ask for the same thing share nothing', () => {
    const two = withLanguages([{ language: '英语', certificate: 'CET-6', score: '502' }]);
    const p = plan(`<h3>语言能力</h3>${text('成绩', 'a')}${text('分数', 'b')}`, two);
    expect(p.plan.steps.filter((s) => s.fieldKey === 'languages.score')).toHaveLength(1);
  });

  it('does not put a test off the CET/TEM ladder below one on it: the resume order decides', () => {
    const ieltsFirst = withLanguages([
      { language: '英语', certificate: 'IELTS', score: '8.0' },
      { language: '英语', certificate: 'CET-4', score: '430' },
    ]);
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a')}${text('英语成绩', 'b')}`, ieltsFirst);
    expect(stepOf(p, '英语等级')).toMatchObject({ source: 'languages[0].certificate' });
    expect(shown(p, '英语等级')).toBe('IELTS');
    expect(stepOf(p, '英语成绩')).toMatchObject({ source: 'languages[0].score' });

    const toeicFirst = withLanguages([
      { language: '英语', certificate: 'TOEIC', score: '900' },
      { language: '英语', certificate: 'CET-4', score: '500' },
    ]);
    expect(stepOf(plan(`<h3>个人信息</h3>${text('英语成绩', 'b')}`, toeicFirst), '英语成绩')).toMatchObject({ source: 'languages[0].score' });
  });

  it('gives a test the form names only that test, TOEIC included', () => {
    const p = plan(`<h3>语言能力</h3>${text('托业成绩', 'a')}`, japaneseFirst);
    expect(stepOf(p, '托业成绩')).toBeUndefined();
  });

  it('knows a language by any of its names, on the form and on the resume', () => {
    const written = withLanguages([{ language: '日文', certificate: 'JLPT N1', score: '170' }]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('日语成绩', 'a')}`, written), '日语成绩')).toMatchObject({ source: 'languages[0].score' });
    const korean = withLanguages([
      { language: '英语', certificate: 'CET-6', score: '502' },
      { language: '朝鲜语', certificate: 'TOPIK 5', score: '210' },
    ]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('韩语成绩', 'a')}`, korean), '韩语成绩')).toMatchObject({ source: 'languages[1].score' });
    const inEnglish = withLanguages([
      { language: 'English', certificate: 'CET-6', score: '502' },
      { language: 'Japanese', certificate: 'JLPT N2', score: '120' },
    ]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('日语成绩', 'a')}`, inEnglish), '日语成绩')).toMatchObject({ source: 'languages[1].score' });
  });

  it('finds the test in a certificate written with more words than its name', () => {
    const wordy = withLanguages([
      { language: '英语', certificate: '大学英语六级（CET-6）', score: '560' },
      { language: '英语', certificate: 'CET4', score: '600' },
    ]);
    const p = plan(`<h3>语言能力</h3>${text('六级成绩', 'a')}${text('四级成绩', 'b')}`, wordy);
    expect(stepOf(p, '六级成绩')).toMatchObject({ source: 'languages[0].score' });
    expect(stepOf(p, '四级成绩')).toMatchObject({ source: 'languages[1].score' });
    const withScore = withLanguages([{ language: '英语', certificate: 'CET-6 560分', score: '560' }]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('六级成绩', 'a')}`, withScore), '六级成绩')).toMatchObject({ source: 'languages[0].score' });
  });

  it('does not read an English test into another language\'s certificate', () => {
    const oldJapanese = withLanguages([
      { language: '日语', certificate: '日语四级', score: '300' },
      { language: '英语', certificate: 'CET-6', score: '502' },
    ]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('四级成绩', 'a')}`, oldJapanese), '四级成绩')).toBeUndefined();
    const bare = withLanguages([{ language: '日语', certificate: '四级', score: '300' }]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('四级成绩', 'a')}`, bare), '四级成绩')).toBeUndefined();
  });

  it('reads no one test from a certificate that names two', () => {
    const both = withLanguages([{ language: '英语', certificate: 'CET-4、CET-6', score: '560' }]);
    expect(stepOf(plan(`<h3>语言能力</h3>${text('四级成绩', 'a')}`, both), '四级成绩')).toBeUndefined();
  });
});

// An entry's test-score list is read before its certificate and score: one entry can hold every test sat.
describe('the test-score list of a language entry', () => {
  const LEVELS = ['未参加', '未通过', 'CET-4', 'CET-6', 'TEM-4', 'TEM-8', '雅思', '托福', '托业', '其他'];
  const select = (label: string, id: string, multiple = false) =>
    row(label, `<select id="${id}"${multiple ? ' multiple' : ''}>${multiple ? '' : '<option value="">请选择</option>'}${LEVELS.map((o) => `<option>${o}</option>`).join('')}</select>`, id);
  const withLanguages = (languages: object[]) => ResumeSchema.parse({ ...zh, languages });
  const bothCet = withLanguages([
    { language: '英语', proficiency: 'proficient', tests: [{ test: 'cet4', score: '560' }, { test: 'cet6', score: '520' }] },
  ]);
  const shown = (p: ReturnType<typeof plan>, label: string) => {
    const intent = stepOf(p, label)?.intent as { text?: string; display?: string } | undefined;
    return intent?.text ?? intent?.display ?? null;
  };
  /** The options a multi-select step would tick, by label. */
  const ticked = (p: ReturnType<typeof plan>, label: string, id: string) => {
    const intent = stepOf(p, label)?.intent;
    if (intent?.kind !== 'multi') return null;
    const options = p.scan.contexts.find((c) => c.control.el.id === id)!.control.options!;
    return intent.items.map((item) => {
      const m = item.match(options);
      return m.status === 'matched' ? options[m.index]!.label : `(${m.status})`;
    });
  };

  it('gives the score of the test a question names from the list', () => {
    const p = plan(`<h3>语言能力</h3>${text('四级成绩', 'a')}${text('六级成绩', 'b')}${text('专八成绩', 'c')}`, bothCet);
    expect(stepOf(p, '四级成绩')).toMatchObject({ fieldKey: 'languages.score', source: 'languages[0].tests[0].score' });
    expect(shown(p, '四级成绩')).toBe('560');
    expect(stepOf(p, '六级成绩')).toMatchObject({ source: 'languages[0].tests[1].score' });
    expect(shown(p, '六级成绩')).toBe('520');
    expect(stepOf(p, '专八成绩')).toBeUndefined();
  });

  it('answers a one-answer English level and its score from the same test, the highest on the CET/TEM ladder', () => {
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a')}${text('英语成绩', 'b')}`, bothCet);
    expect(stepOf(p, '英语等级')).toMatchObject({ fieldKey: 'languages.certificate', source: 'languages[0].tests[1].test' });
    expect(shown(p, '英语等级')).toBe('CET-6');
    expect(stepOf(p, '英语成绩')).toMatchObject({ source: 'languages[0].tests[1].score' });
  });

  it('keeps the resume order on a one-answer list when a test off the ladder is held', () => {
    const ieltsFirst = withLanguages([{ language: '英语', tests: [{ test: 'ielts', score: '7.5' }, { test: 'cet6', score: '520' }] }]);
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a')}${text('英语成绩', 'b')}`, ieltsFirst);
    expect(shown(p, '英语等级')).toBe('IELTS');
    expect(shown(p, '英语成绩')).toBe('7.5');
  });

  it('still reads the certificate of an entry with no list', () => {
    const p = plan(`<h3>语言能力</h3>${text('六级成绩', 'a')}`, withLanguages([{ language: '英语', certificate: 'CET-6', score: '502' }]));
    expect(stepOf(p, '六级成绩')).toMatchObject({ source: 'languages[0].score' });
  });

  it('ticks every English test held on a list that takes several, from the list and from older entries alike', () => {
    const resume = withLanguages([
      { language: '日语', certificate: 'JLPT N1', score: '170', tests: [{ test: 'jlpt_n1', score: '170' }] },
      { language: '英语', tests: [{ test: 'cet4', score: '560' }, { test: 'cet6', score: '520' }] },
      { language: '英语', certificate: '雅思', score: '7.0' },
    ]);
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a', true)}`, resume);
    expect(stepOf(p, '英语等级')).toMatchObject({ fieldKey: 'languages.certificate' });
    expect(ticked(p, '英语等级', 'a')).toEqual(['CET-4', 'CET-6', '雅思']);
    expect(reportOf(p, '英语等级')).toBeUndefined();
  });

  it('knows TOEIC by its Chinese name on a list', () => {
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a', true)}`, withLanguages([{ language: '英语', tests: [{ test: 'toeic', score: '900' }] }]));
    expect(ticked(p, '英语等级', 'a')).toEqual(['托业']);
  });

  it('ticks the one English test of the sample resume', () => {
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a', true)}`);
    expect(ticked(p, '英语等级', 'a')).toEqual(['CET-6']);
  });

  it('ticks nothing on a list that takes several when no English test is held', () => {
    const p = plan(`<h3>个人信息</h3>${select('英语等级', 'a', true)}`, withLanguages([{ language: '日语', certificate: 'JLPT N1', score: '170' }]));
    expect(stepOf(p, '英语等级')).toBeUndefined();
  });
});

describe('fieldKeyLabel', () => {
  it('uses the first synonym of the resume language', () => {
    expect(fieldKeyLabel('education.school', 'zh-CN')).toBe('学校');
    expect(fieldKeyLabel('education.school', 'en-AU')).toBe('Institution');
    expect(fieldKeyLabel('nope.nothing', 'en-AU')).toBe('nope.nothing');
  });
});

describe('a supervisor is asked only on a school card', () => {
  const form = `
    <h3>教育经历</h3>${text('学校名称', 'es')}${text('导师', 'ed')}
    <h3>项目经历</h3>${text('项目名称', 'pn')}${text('指导老师', 'pt')}
    <h3>校园经历</h3>${text('组织名称', 'cn')}${text('指导老师', 'ct')}
    <h3>实习经历</h3>${text('公司名称', 'ic')}${text('导师', 'im')}`;
  const withSupervisorAt = (school: string) => {
    const r = structuredClone(zh);
    r.referees = [{ name: '示例导师', title: '教授', company: school, email: '', phone: '', relationship: '导师' }];
    return r;
  };
  const at = (p: ReturnType<typeof plan>, id: string) => {
    const i = p.scan.contexts.findIndex((c) => c.control.el.id === id);
    return { key: p.scan.classifications[i]!.fieldKey, step: p.plan.steps.find((s) => s.fieldId === p.scan.contexts[i]!.control.id) };
  };

  it.each(['pt', 'ct', 'im'])('the mentor box %s outside education is not the school supervisor, and stays empty', (id) => {
    // Whichever school the supervisor is at, a project, campus or internship mentor is someone else.
    for (const school of [zh.education[0]!.school, zh.education[1]!.school]) {
      const p = plan(form, withSupervisorAt(school));
      expect(at(p, id).key).not.toBe('education.supervisor');
      expect(at(p, id).step).toBeUndefined();
    }
  });

  it("the school card takes the supervisor only from its own school", () => {
    expect(at(plan(form, withSupervisorAt(zh.education[0]!.school)), 'ed').step?.intent).toEqual({ kind: 'text', text: '示例导师' });
    expect(at(plan(form, withSupervisorAt(zh.education[1]!.school)), 'ed').step).toBeUndefined();
  });
});

// Compile-time check that the plan only uses the shared FillStep from drivers/execute.
const _types: [Classification?, FieldContext?] = [];
void _types;
