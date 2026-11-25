// Long-text answers: which kind of question, what of the resume answers it, how long it may be, and the page's company
// and job. A draft is never written by itself; these only make it.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  draftLongText,
  fitLength,
  jobContextOf,
  lengthLimitOf,
  longTextKindOf,
} from '../../../src/answers';
import { createSampleProfile, ResumeSchema, type Resume } from '../../../src/schema';
import { scanDocument } from '../../../src/engine/scan';
import { FILL_THRESHOLD } from '../../../src/engine/classify';

const [zh, en] = createSampleProfile().resumes as [Resume, Resume];

describe('longTextKindOf', () => {
  it('names the kind of each long-text key, and nothing for other keys', () => {
    expect(longTextKindOf('answers.coverLetter')).toBe('coverLetter');
    expect(longTextKindOf('answers.whyUs')).toBe('whyUs');
    expect(longTextKindOf('answers.strengths')).toBe('strengths');
    expect(longTextKindOf('answers.careerPlan')).toBe('careerPlan');
    expect(longTextKindOf('projects.duties')).toBe('projectDuties');
    expect(longTextKindOf('misc.selfIntroduction')).toBe('selfEvaluation');
    expect(longTextKindOf('contact.email')).toBeNull();
  });
});

describe('how forms ask for long text', () => {
  const classify = (label: string, inProject = false) => {
    const box = `<div class="field"><label for="q">${label}</label><textarea id="q"></textarea></div>`;
    document.body.innerHTML = inProject
      ? `<form><section><h3>项目经历</h3><div class="field"><label for="n">项目名称</label><input id="n"></div>${box}</section></form>`
      : `<form>${box}</form>`;
    const { contexts, classifications } = scanDocument(document);
    return classifications[contexts.findIndex((c) => c.control.el.id === 'q')]!;
  };

  it.each([
    ['求职信', 'answers.coverLetter'],
    ['Cover letter', 'answers.coverLetter'],
    ['为什么选择我们', 'answers.whyUs'],
    ['Why do you want to work for us?', 'answers.whyUs'],
    ['个人优势', 'answers.strengths'],
    ['What are your key strengths?', 'answers.strengths'],
    ['职业规划', 'answers.careerPlan'],
    ['Where do you see yourself in five years?', 'answers.careerPlan'],
    ['自我评价', 'misc.selfIntroduction'],
    ['求职信（不超过500字）', 'answers.coverLetter'],
    ['Cover letter (max 500 characters)', 'answers.coverLetter'],
    ['Why do you want to work for us? Answer in no more than 150 words', 'answers.whyUs'],
  ])('"%s" is %s', (label, key) => {
    const c = classify(label);
    expect(c.fieldKey).toBe(key);
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('"项目中职责" on a project card is the duties in that project', () => {
    expect(classify('项目中职责', true).fieldKey).toBe('projects.duties');
  });

  it.each(['求职意向', '期望职位', '项目描述'])('"%s" is not a long-text answer', (label) => {
    expect(longTextKindOf(classify(label).fieldKey ?? '')).toBeNull();
  });
});

describe('lengthLimitOf', () => {
  const box = (attrs = ''): HTMLTextAreaElement => {
    document.body.innerHTML = `<textarea ${attrs}></textarea>`;
    return document.querySelector('textarea')!;
  };

  it('reads maxlength', () => {
    expect(lengthLimitOf(box('maxlength="300"'), '自我评价')).toEqual({ max: 300, unit: 'chars' });
  });

  it.each([
    ['自我评价（200字以内）', { max: 200, unit: 'chars' }],
    ['求职信（不超过500字）', { max: 500, unit: 'chars' }],
    ['职业规划（100-300字）', { max: 300, unit: 'chars' }],
    ['Cover letter (max 500 characters)', { max: 500, unit: 'chars' }],
    ['Why us? Answer in no more than 150 words', { max: 150, unit: 'words' }],
    ['Tell us about yourself (250 words maximum)', { max: 250, unit: 'words' }],
  ])('reads the limit in "%s"', (label, limit) => {
    expect(lengthLimitOf(box(), label)).toEqual(limit);
  });

  it('takes the tighter of the two', () => {
    expect(lengthLimitOf(box('maxlength="100"'), '自我评价（200字以内）')).toEqual({ max: 100, unit: 'chars' });
  });

  it('says nothing when neither is there', () => {
    expect(lengthLimitOf(box(), '自我评价')).toBeNull();
  });
});

describe('fitLength', () => {
  it('keeps text that fits', () => {
    expect(fitLength('一句。两句。', { max: 10, unit: 'chars' })).toEqual({ text: '一句。两句。', cut: false });
  });

  it('drops whole Chinese sentences from the end until it fits', () => {
    expect(fitLength('第一句话。第二句话。第三句话。', { max: 11, unit: 'chars' })).toEqual({ text: '第一句话。第二句话。', cut: true });
  });

  it('drops whole English sentences, counting words or characters', () => {
    const text = 'I build tools. I test them well. I ship them often.';
    expect(fitLength(text, { max: 7, unit: 'words' })).toEqual({ text: 'I build tools. I test them well.', cut: true });
    expect(fitLength(text, { max: 20, unit: 'chars' })).toEqual({ text: 'I build tools.', cut: true });
  });

  it('cuts a first sentence that alone is too long at a word, never mid-word', () => {
    expect(fitLength('Building reliable tooling everywhere matters.', { max: 20, unit: 'chars' })).toEqual({ text: 'Building reliable', cut: true });
    expect(fitLength('这是一句很长很长的话没有标点', { max: 5, unit: 'chars' })).toEqual({ text: '这是一句很', cut: true });
  });
});

describe('jobContextOf', () => {
  const page = (title: string, head = '', body = ''): Document => {
    const doc = document.implementation.createHTMLDocument(title);
    doc.head.insertAdjacentHTML('beforeend', head);
    doc.body.innerHTML = body;
    return doc;
  };

  it('reads the job and the company from a title that names both', () => {
    expect(jobContextOf(page('后端开发工程师 - 示例科技有限公司校园招聘'))).toEqual({ position: '后端开发工程师', company: '示例科技有限公司' });
    expect(jobContextOf(page('Graduate Software Engineer | Example Pty Ltd Careers'))).toEqual({ position: 'Graduate Software Engineer', company: 'Example Pty Ltd' });
  });

  it('takes the company from og:site_name, and a page’s own job and company boxes first', () => {
    expect(jobContextOf(page('Data Analyst', '<meta property="og:site_name" content="Example Group">'))).toEqual({ position: 'Data Analyst', company: 'Example Group' });
    const workday = page('Apply', '', '<h2 data-automation-id="jobTitle">Platform Engineer</h2><div data-automation-id="company">Example Bank</div>');
    expect(jobContextOf(workday)).toEqual({ position: 'Platform Engineer', company: 'Example Bank' });
  });

  it('says nothing it cannot tell', () => {
    expect(jobContextOf(page('Apply now'))).toEqual({});
  });
});

describe('draftLongText', () => {
  const job = { company: '示例科技', position: '后端开发工程师' };

  it('writes a cover letter from the templates, the job and the resume', () => {
    const d = draftLongText('coverLetter', zh, { job })!;
    expect(d.text).toContain('示例科技');
    expect(d.text).toContain('后端开发工程师');
    expect(d.text).toContain(zh.selfIntroduction.trim().slice(0, 10));
    expect(d.cut).toBe(false);
  });

  it('drops a sentence whose company or job the page does not say, and leaves no empty braces', () => {
    const d = draftLongText('coverLetter', en, { job: {} })!;
    expect(d.text).not.toMatch(/[{}]/);
    expect(d.text).not.toMatch(/\bat\s*\.|role at\b/);
    expect(d.text).toContain(en.selfIntroduction.trim().slice(0, 10));
  });

  it('takes the duties of the project the card is for', () => {
    const d = draftLongText('projectDuties', zh, { entryIndex: 1 })!;
    expect(d.text).toContain(zh.projects[1]!.role);
    expect(d.text).toContain(zh.projects[1]!.description.slice(0, 8));
    expect(d.source).toBe('projects[1].description');
  });

  it('keeps to the length limit', () => {
    const d = draftLongText('coverLetter', zh, { job, limit: { max: 40, unit: 'chars' } })!;
    expect([...d.text].length).toBeLessThanOrEqual(40);
    expect(d.cut).toBe(true);
  });

  it('uses the applicant’s own template when there is one', () => {
    const d = draftLongText('whyUs', zh, { job, templates: { whyUs: '我想加入{公司}。' } })!;
    expect(d.text).toBe('我想加入示例科技。');
  });

  it('writes nothing for a resume with nothing to say', () => {
    const blank = ResumeSchema.parse({ id: 'b', title: 'B', locale: 'zh-CN' });
    expect(draftLongText('strengths', blank, { job })).toBeNull();
    expect(draftLongText('projectDuties', blank, {})).toBeNull();
  });

  it('has a template for every kind but self evaluation and project duties, in both languages', () => {
    for (const lang of ['zh', 'en'] as const) {
      expect(Object.keys(DEFAULT_TEMPLATES[lang]).sort()).toEqual(['careerPlan', 'coverLetter', 'strengths', 'whyUs']);
    }
  });
});
