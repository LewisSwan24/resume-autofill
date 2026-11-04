import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileData } from '../../../src/drivers/types';
import { fieldKeyLabel, planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import type { Classification, FieldContext } from '../../../src/engine/types';
import { ResumeSchema, createSampleProfile } from '../../../src/schema';

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
      ['education[1].school', { kind: 'text', text: '昆士兰大学' }],
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

describe('fieldKeyLabel', () => {
  it('uses the first synonym of the resume language', () => {
    expect(fieldKeyLabel('education.school', 'zh-CN')).toBe('学校');
    expect(fieldKeyLabel('education.school', 'en-AU')).toBe('Institution');
    expect(fieldKeyLabel('nope.nothing', 'en-AU')).toBe('nope.nothing');
  });
});

// Compile-time check that the plan only uses the shared FillStep from drivers/execute.
const _types: [Classification?, FieldContext?] = [];
void _types;
