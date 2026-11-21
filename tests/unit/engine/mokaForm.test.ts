// A real Moka application form: what each control is, and what it would be given.
import { afterEach, describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';
import type { Resume } from '../../../src/schema/resume';
import { MOKA_ENTRY_FIELDS, MOKA_ENTRY_FORM, MOKA_FORM, mokaEntryBlock } from '../../shared/mokaForm';

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
    expect(at('上传附件').key).toBeNull();
    // Starting an internship early is not a visa.
    expect(at('是否需要/可以提前实习').key).toBeNull();
  });

  it.each([
    ['是否接收组织调配', 'select', 'jobIntention.acceptAdjustment'],
    ['语言技能', 'select', 'languages.language'],
    ['英语等级', 'select', 'languages.certificate'],
    ['起止时间', 'date', 'work.period'],
    ['公司名称', 'text', 'work.company'],
    ['语言类型', 'select', 'languages.language'],
    ['所获证书', 'text', 'languages.certificate'],
    ['在校导师', 'text', 'education.supervisor'],
  ])('%s, on a block whose title carries a line of advice too', (title, kind, key) => {
    const { at } = scan();
    expect(at(title).control.kind).toBe(kind);
    expect(at(title).key).toBe(key);
  });

  it('a list that takes several answers is known as one', () => {
    const { at } = scan();
    expect(at('语言技能').control.multiple).toBe(true);
    expect(at('最高学历').control.multiple).toBeFalsy();
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

  it('a span with a box for 至今 is still a span, and a job still going ticks it', () => {
    const done = scan().at('起止时间');
    expect(done.control.dateRange).toBe(true);
    expect(done.step?.intent).toMatchObject({ kind: 'dateRange', start: { year: 2023, month: 6 }, end: { year: 2023, month: 9 } });
    const going = scan((r) => {
      r.work = r.work.filter((w) => w.current);
    }).at('起止时间');
    expect(going.step?.intent).toMatchObject({ kind: 'dateFrom', start: { year: 2025, month: 11 } });
  });

  it('accepting where the company puts you is the resume’s yes', () => {
    const { step } = scan().at('是否接收组织调配');
    if (step?.intent?.kind !== 'choice') throw new Error('expected a choice');
    const options = ['是', '否'].map((label) => ({ label }));
    const m = step.intent.match(options);
    expect(m.status === 'matched' ? options[m.index]!.label : m.status).toBe('是');
  });

  it('the languages someone speaks are ticked on a list that takes several', () => {
    const { step } = scan().at('语言技能');
    expect(step?.intent).toMatchObject({ kind: 'multi', items: [{ query: '英语' }] });
  });

  it('an English level on a list that takes several is left to the applicant, until the ranking is settled', () => {
    const { at, plan } = scan();
    const { control, step } = at('英语等级');
    expect(step).toBeUndefined();
    expect(plan.reports.find((r) => r.fieldId === control.id)?.outcome).toBe('needs_review');
  });

  it('a block for languages other than English gets nothing from an English entry', () => {
    const { at, plan } = scan();
    for (const title of ['语言类型', '所获证书']) {
      const { control, step } = at(title);
      expect(step, title).toBeUndefined();
      expect(plan.reports.find((r) => r.fieldId === control.id)?.outcome, title).toBe('no_data');
    }
  });

  it('a block for other languages still takes one that is not English', () => {
    const { at } = scan((r) => {
      r.languages = [...r.languages, { language: '日语', proficiency: 'basic', certificate: 'JLPT N2', score: '' }];
    });
    expect(at('语言类型').step?.intent).toMatchObject({ kind: 'choice', query: '日语' });
  });

  it('the supervisor at school comes from a referee who supervised there, and from no one else', () => {
    expect(scan().at('在校导师').step).toBeUndefined();
    const named = (school: string) =>
      scan((r) => {
        r.referees = [{ name: '示例导师', title: '教授', company: school, email: '', phone: '', relationship: '导师' }];
      }).at('在校导师').step?.intent;
    // The card is the first school on the resume.
    expect(named('浙江大学')).toEqual({ kind: 'text', text: '示例导师' });
    expect(named('另一所大学')).toBeUndefined();
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

describe('sections that take several entries', () => {
  function scanEntries(change: (r: Resume) => void = () => undefined) {
    show(`<form>${MOKA_ENTRY_FORM}</form>`);
    const { contexts, classifications } = scanDocument(document);
    const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
    change(resume);
    const plan = planFill(contexts, classifications, resume, {});
    return (block: string, title: string) => {
      const i = contexts.findIndex((c) => {
        const field = c.control.el.closest('[class*="apply-field-"]');
        return (
          field?.querySelector('[class*="title-"]')?.textContent?.trim() === title &&
          field.closest('[class*="apply-block-"]')?.querySelector('[class*="blockTitle-"] span span')?.textContent === block
        );
      });
      if (i < 0) throw new Error(`no control under ${block} ${title}`);
      return { control: contexts[i]!.control, key: classifications[i]!.fieldKey, step: plan.steps.find((s) => s.fieldId === contexts[i]!.control.id) };
    };
  }

  it.each([
    ['教育背景', '学历', 'education.degree'],
    ['教育背景', '学校名称', 'education.school'],
    ['教育背景', '专业名称', 'education.major'],
    ['教育背景', '就读时间', 'education.period'],
    ['工作经历', '公司名称', 'work.company'],
    ['工作经历', '职位名称', 'work.position'],
    ['工作经历', '起止时间', 'work.period'],
    ['工作经历', '工作职责', 'work.description'],
    ['项目经验', '项目名称', 'projects.name'],
    ['项目经验', '起止时间', 'projects.period'],
    ['项目经验', '项目描述', 'projects.description'],
    ['获奖情况', '奖项名称', 'awards.name'],
    ['获奖情况', '获奖时间', 'awards.date'],
  ])('%s %s', (block, title, key) => {
    expect(scanEntries()(block, title).key).toBe(key);
  });

  it('the one entry of each section takes the first entry of the resume, though its neighbours ask alike', () => {
    const at = scanEntries();
    const text = (block: string, title: string) => {
      const intent = at(block, title).step?.intent;
      return intent?.kind === 'text' ? intent.text : intent?.kind;
    };
    expect(text('工作经历', '公司名称')).toBe('腾讯');
    expect(text('项目经验', '项目名称')).toBe('校园二手交易平台');
    expect(text('获奖情况', '奖项名称')).toBe('国家奖学金');
  });

  it('an entry showing what was picked in it is still a card of its section', () => {
    show(`<form>${mokaEntryBlock('教育背景', MOKA_ENTRY_FIELDS.education, '', 2)}</form>`);
    const first = document.querySelector('[class*="apply-fields-"]')!;
    first.querySelectorAll('[class*="sd-Input-display-value"]').forEach((s, i) => (s.textContent = ['本科', '示例大学', '示例工程', '2019', '9', '2023', '6'][i]!));
    const groups = scanDocument(document).contexts.map((c) => c.group);
    expect(new Set(groups.map((g) => g?.key)).size).toBe(1);
    expect(groups.map((g) => g?.index)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });
});
