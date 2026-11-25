// 应届/往届, when the applicant has not answered it: still at school, or graduating in the class a page recruits, is a
// fresh graduate; graduated before that class, a past one. The class is the page's (2026届) or, unsaid, the one
// recruited now (from August, next year's). What cannot be told stays unanswered.
import { describe, expect, it } from 'vitest';
import { classYearOf, resolveValue } from '../../../src/engine/values';
import { createSampleProfile, EducationSchema, type Resume } from '../../../src/schema';

const KEY = 'questions.graduateStatus';

function resumeWith(education: { endDate?: string | null; current?: boolean; startDate?: string }[], answer: string | null = null): Resume {
  const r = structuredClone(createSampleProfile().resumes[0]!) as Resume;
  r.questions.graduateStatus = answer as Resume['questions']['graduateStatus'];
  r.education = education.map((e) => EducationSchema.parse({ school: '示例大学', degree: 'bachelor', startDate: '2022-09', ...e }));
  return r;
}

const at = (resume: Resume, now: Date, classYear?: number) =>
  resolveValue(KEY, resume, 0, 'basics', { now, ...(classYear ? { classYear } : {}) });

describe('应届/往届 worked out', () => {
  it('keeps the applicant’s own answer', () => {
    expect(at(resumeWith([{ endDate: '2020-06' }], 'fresh_graduate'), new Date(2026, 10, 1))?.raw).toBe('fresh_graduate');
  });

  it('is a fresh graduate while still at school', () => {
    expect(at(resumeWith([{ endDate: null, current: true }]), new Date(2026, 2, 1))).toMatchObject({ raw: 'fresh_graduate' });
    expect(at(resumeWith([{ endDate: '2027-06' }]), new Date(2026, 2, 1))?.raw).toBe('fresh_graduate');
  });

  it('is a fresh graduate in the class recruited now, and a past one before it', () => {
    // March 2026 recruits 2026届; November 2026 recruits 2027届.
    expect(at(resumeWith([{ endDate: '2025-12' }]), new Date(2026, 2, 1))?.raw).toBe('past_graduate');
    expect(at(resumeWith([{ endDate: '2026-01' }]), new Date(2026, 2, 1))?.raw).toBe('fresh_graduate');
    expect(at(resumeWith([{ endDate: '2026-06' }]), new Date(2026, 10, 1))?.raw).toBe('past_graduate');
  });

  it('takes the class the page names', () => {
    expect(at(resumeWith([{ endDate: '2026-06' }]), new Date(2026, 10, 1), 2026)?.raw).toBe('fresh_graduate');
  });

  it('reads the latest schooling, not the first', () => {
    const r = resumeWith([{ startDate: '2018-09', endDate: '2022-06' }, { startDate: '2024-09', endDate: null, current: true }]);
    expect(at(r, new Date(2026, 2, 1))?.raw).toBe('fresh_graduate');
  });

  it('says nothing it cannot tell', () => {
    expect(at(resumeWith([]), new Date(2026, 2, 1))).toBeNull();
    expect(at(resumeWith([{ endDate: null, current: false }]), new Date(2026, 2, 1))).toBeNull();
  });
});

describe('classYearOf', () => {
  it.each([
    ['2026届校园招聘', 2026],
    ['字节跳动2027届秋季校园招聘', 2027],
    ['2026 届 应届生', 2026],
    ['社会招聘', null],
  ])('%s → %s', (text, year) => {
    expect(classYearOf(text)).toBe(year);
  });
});

describe('应届/往届 on a page', () => {
  it('answers by the class in the page title', async () => {
    const { scanDocument } = await import('../../../src/engine/scan');
    const { planFill } = await import('../../../src/engine/plan');
    document.body.innerHTML = '<form><label for="g">应届/往届</label><select id="g"><option value="">请选择</option><option>应届</option><option>往届</option></select></form>';
    const { contexts, classifications } = scanDocument(document);
    const resume = resumeWith([{ endDate: '2026-06' }]);
    const plan = (pageTitle: string) =>
      planFill(contexts, classifications, resume, {}, { now: new Date(2026, 10, 1), pageTitle }).steps.find((s) => s.fieldKey === KEY);
    expect(plan('2026届校园招聘')?.intent).toMatchObject({ kind: 'choice', query: '应届' });
    expect(plan('校园招聘')?.intent).toMatchObject({ kind: 'choice', query: '往届' });
  });
});
