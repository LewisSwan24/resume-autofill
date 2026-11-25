// The planner turns a long-text question into a draft row for the side panel and never into a step: nothing is written
// until the applicant says so. A self evaluation that fits is filled as before; one that had to be cut is a draft.
import { describe, expect, it } from 'vitest';
import { createSampleProfile, ResumeSchema, type Resume } from '../../../src/schema';
import { scanDocument } from '../../../src/engine/scan';
import { planFill } from '../../../src/engine/plan';

const [zh] = createSampleProfile().resumes as [Resume, Resume];
const job = { company: '示例科技', position: '后端开发工程师' };

function plan(boxes: string, resume: Resume = zh, opts: Parameters<typeof planFill>[4] = { job }) {
  document.body.innerHTML = `<form>${boxes}</form>`;
  const { contexts, classifications } = scanDocument(document);
  return planFill(contexts, classifications, resume, {}, opts);
}

const box = (id: string, label: string, attrs = '') =>
  `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" ${attrs}></textarea></div>`;

describe('long-text questions in the plan', () => {
  it('makes a draft row with the page’s company and job, and no step', () => {
    const p = plan(box('cl', '求职信'));
    expect(p.steps.find((s) => s.fieldId.includes('cl'))).toBeUndefined();
    const row = p.reports.find((r) => r.fieldKey === 'answers.coverLetter')!;
    expect(row.outcome).toBe('needs_review');
    expect(row.note).toBe('draft');
    expect(row.value).toContain('示例科技');
    expect(row.value).toContain('后端开发工程师');
  });

  it('keeps a draft inside the box’s maxlength', () => {
    const row = plan(box('cl', '求职信', 'maxlength="40"')).reports.find((r) => r.fieldKey === 'answers.coverLetter')!;
    expect([...row.value!].length).toBeLessThanOrEqual(40);
  });

  it('uses the applicant’s own template in the resume’s language', () => {
    const p = plan(box('w', '为什么选择我们'), zh, { job, answerTemplates: { zh: { whyUs: '我想加入{公司}。' } } });
    expect(p.reports.find((r) => r.fieldKey === 'answers.whyUs')!.value).toBe('我想加入示例科技。');
  });

  it('fills a self evaluation that fits, and drafts one that had to be cut', () => {
    expect(plan(box('se', '自我评价')).steps.map((s) => s.fieldKey)).toContain('misc.selfIntroduction');
    const cut = plan(box('se', '自我评价（20字以内）'));
    expect(cut.steps.map((s) => s.fieldKey)).not.toContain('misc.selfIntroduction');
    const row = cut.reports.find((r) => r.fieldKey === 'misc.selfIntroduction')!;
    expect(row.note).toBe('draft');
    expect([...row.value!].length).toBeLessThanOrEqual(20);
  });

  it('has nothing to draft from a blank resume', () => {
    const blank = ResumeSchema.parse({ id: 'b', title: 'B', locale: 'zh-CN' });
    expect(plan(box('s', '个人优势'), blank).reports.find((r) => r.fieldKey === 'answers.strengths')!.outcome).toBe('no_data');
  });
});
