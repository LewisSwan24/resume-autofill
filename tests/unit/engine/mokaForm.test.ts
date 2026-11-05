// A real Moka application form: what each control is, and what it would be given.
import { afterEach, describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';
import type { Resume } from '../../../src/schema/resume';
import { MOKA_FORM } from '../../shared/mokaForm';

afterEach(() => {
  document.body.replaceChildren();
});

function show(html: string): void {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
}

function scan(change: (r: Resume) => void = () => undefined) {
  show(`<form>${MOKA_FORM}</form>`);
  const { contexts, classifications } = scanDocument(document);
  const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
  change(resume);
  const plan = planFill(contexts, classifications, resume, {});
  const at = (title: string) => {
    const i = contexts.findIndex((c) => c.control.el.closest('[class*="apply-field-"]')?.querySelector('[class*="title-"]')?.textContent?.trim() === title && !c.control.el.closest('[class*="code-"]'));
    if (i < 0) throw new Error(`no control under ${title}`);
    return { control: contexts[i]!.control, key: classifications[i]!.fieldKey, step: plan.steps.find((s) => s.fieldId === contexts[i]!.control.id) };
  };
  return { contexts, classifications, plan, at };
}

describe('every question on the form is read', () => {
  it.each([
    ['意向工作城市', 'select', 'jobIntention.cities'],
    ['姓名', 'text', 'basics.fullName'],
    ['手机号码', 'text', 'contact.phone'],
    ['邮箱', 'text', 'contact.email'],
    ['出生日期 (年龄)', 'date', 'basics.birthDate'],
    ['毕业时间', 'date', 'education.endDate'],
    ['最高学历', 'select', 'education.degree'],
    ['籍贯', 'cascader', 'basics.nativePlace'],
    ['就读时间', 'date', 'education.period'],
    ['学校名称', 'select', 'education.school'],
    ['专业名称', 'select', 'education.major'],
    ['学历', 'select', 'education.degree'],
  ])('%s', (title, kind, key) => {
    const { at } = scan();
    expect(at(title).control.kind).toBe(kind);
    expect(at(title).key).toBe(key);
  });

  it('the widgets belong to the Moka driver', () => {
    const { at } = scan();
    for (const title of ['意向工作城市', '最高学历', '籍贯', '就读时间', '毕业时间', '出生日期 (年龄)', '学校名称']) {
      expect(at(title).control.lib, title).toBe('moka');
    }
  });

  it('nothing the resume does not hold is claimed', () => {
    const { at } = scan();
    expect(at('推荐码').key).toBeNull();
    expect(at('在校导师').key).toBeNull();
    expect(at('上传附件').key).toBeNull();
  });

  it('the country code beside the phone number is left as it stands', () => {
    const { contexts } = scan();
    expect(contexts.some((c) => c.control.el.closest('[class*="code-"]'))).toBe(false);
  });

  it('the box to update the online resume is not touched', () => {
    const { contexts, classifications, plan } = scan();
    const i = contexts.findIndex((c) => c.control.kind === 'checkbox');
    expect(classifications[i]!.fieldKey).toBeNull();
    expect(plan.steps.some((s) => s.fieldId === contexts[i]!.control.id)).toBe(false);
  });
});

describe('what the form is given', () => {
  it('the study span is a span of the card it sits on', () => {
    const { control, step } = scan().at('就读时间');
    expect(control.dateRange).toBe(true);
    expect(step?.intent).toMatchObject({ kind: 'dateRange', start: { year: 2020, month: 9 }, end: { year: 2024, month: 6 } });
  });

  it('a single year and month holds one date', () => {
    const { control, step } = scan().at('毕业时间');
    expect(control.dateRange).toBeFalsy();
    expect(step?.intent).toMatchObject({ kind: 'date', year: 2026, month: 6 });
  });

  it('highest means the highest, whatever order the resume lists them in', () => {
    const { step } = scan().at('最高学历');
    expect(step?.intent?.kind).toBe('choice');
    if (step?.intent?.kind !== 'choice') return;
    const options = ['本科', '硕士', '博士', '大专', 'MBA', '其他'].map((label) => ({ label }));
    const m = step.intent.match(options);
    expect(m.status === 'matched' ? options[m.index]!.label : m.status).toBe('硕士');
  });

  it('with no higher one, the only one', () => {
    const { step } = scan((r) => {
      r.education = [r.education[0]!];
    }).at('最高学历');
    if (step?.intent?.kind !== 'choice') throw new Error('expected a choice');
    const options = ['本科', '硕士'].map((label) => ({ label }));
    const m = step.intent.match(options);
    expect(m.status === 'matched' ? options[m.index]!.label : m.status).toBe('本科');
  });

  it('the card still means its own school', () => {
    const { step } = scan().at('学历');
    if (step?.intent?.kind !== 'choice') throw new Error('expected a choice');
    const options = ['本科', '硕士'].map((label) => ({ label }));
    const m = step.intent.match(options);
    expect(m.status === 'matched' ? options[m.index]!.label : m.status).toBe('本科');
  });

  it('the home town follows the resume down its levels', () => {
    const { step } = scan((r) => {
      r.basics.nativePlace = { country: '中国', province: '浙江省', city: '杭州市', district: '' };
    }).at('籍贯');
    expect(step?.intent).toMatchObject({ kind: 'cascade', path: ['浙江省', '杭州市'] });
  });
});

describe('someone else’s card never gets the applicant', () => {
  const card = (title: string, label: string) => `<form><h2>${title}</h2><div><label for="x">${label}</label><input id="x" type="text"></div></form>`;

  it.each([
    ['家庭成员', '年龄'],
    ['家庭成员', '出生年月'],
    ['家庭成员', '性别'],
    ['家庭成员', '民族'],
    ['紧急联系人', '联系地址'],
    ['紧急联系人', '身份证号'],
    ['Emergency Contact', 'Address'],
    ['Emergency Contact', 'Date of birth'],
    ['Referees', 'Address'],
  ])('%s: %s', (title, label) => {
    show(card(title, label));
    const { contexts, classifications } = scanDocument(document);
    const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
    const { steps } = planFill(contexts, classifications, resume, {});
    expect(steps.map((s) => s.fieldKey)).toEqual([]);
  });
});
