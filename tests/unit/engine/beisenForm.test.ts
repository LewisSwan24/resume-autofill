// A real Beisen (北森) resume form: what each control is, and what it would be given.
import { afterEach, describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';
import type { Resume } from '../../../src/schema/resume';
import { BEISEN_FORM } from '../../shared/beisenForm';

afterEach(() => {
  document.body.replaceChildren();
});

function show(html: string): void {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
}

function scan(change: (r: Resume) => void = () => undefined) {
  show(BEISEN_FORM);
  const { contexts, classifications } = scanDocument(document);
  const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
  change(resume);
  const plan = planFill(contexts, classifications, resume, {});
  const at = (title: string, nth = 0) => {
    const all = contexts.flatMap((c, i) => (c.control.el.closest('.form-item')?.querySelector('.form-item__text')?.textContent?.trim() === title ? [i] : []));
    const i = all[nth];
    if (i === undefined) throw new Error(`no control under ${title} #${nth}`);
    return { control: contexts[i]!.control, key: classifications[i]!.fieldKey, step: plan.steps.find((s) => s.fieldId === contexts[i]!.control.id) };
  };
  return { contexts, classifications, plan, at };
}

describe('every question on the form is read', () => {
  it.each([
    ['姓名', 0, 'text', 'basics.fullName'],
    ['性别', 0, 'radio', 'basics.gender'],
    ['出生日期', 0, 'date', 'basics.birthDate'],
    ['现居住地', 0, 'select', 'basics.currentLocation'],
    ['户口所在地', 0, 'select', 'basics.household'],
    ['政治面貌', 0, 'select', 'basics.politicalStatus'],
    ['婚否', 0, 'radio', 'basics.maritalStatus'],
    ['期望工作地点', 0, 'select', 'jobIntention.cities'],
    ['生源地', 0, 'select', 'basics.studentOrigin'],
    ['开始时间', 0, 'date', 'education.startDate'],
    ['结束时间', 0, 'date', 'education.endDate'],
    ['学历', 0, 'select', 'education.degree'],
    ['学习成绩排名', 0, 'select', 'education.ranking'],
    ['期望工作城市', 0, 'select', 'jobIntention.cities'],
    ['技能名称', 0, 'text', 'skills.name'],
    ['项目名称', 0, 'text', 'projects.name'],
    ['开始时间', 1, 'date', 'campus.startDate'],
    ['实践描述', 0, 'textarea', 'campus.description'],
    ['开始时间', 2, 'date', 'projects.startDate'],
    ['项目名称', 1, 'text', 'projects.name'],
    ['获奖项', 0, 'text', 'awards.name'],
    ['获奖时间', 0, 'date', 'awards.date'],
    ['自我评价', 0, 'textarea', 'misc.selfIntroduction'],
    ['是否愿意服从公司分配', 0, 'radio', 'jobIntention.acceptAdjustment'],
  ] as const)('%s #%i', (title, nth, kind, key) => {
    const { at } = scan();
    expect(at(title, nth).control.kind).toBe(kind);
    expect(at(title, nth).key).toBe(key);
  });

  it('the Phoenix widgets belong to the Beisen driver', () => {
    const { at } = scan();
    for (const title of ['性别', '出生日期', '现居住地', '政治面貌', '婚否', '学历', '获奖时间', '是否愿意服从公司分配']) {
      expect(at(title).control.lib, title).toBe('beisen');
    }
  });

  it('a radio group with no inputs still offers its answers', () => {
    const { at } = scan();
    expect(at('性别').control.options?.map((o) => o.label)).toEqual(['男', '女', '保密']);
  });

  it('a box that takes several says so', () => {
    const { at } = scan();
    expect(at('期望从事行业').control.multiple).toBe(true);
    expect(at('期望工作城市').control.multiple).toBe(true);
    expect(at('政治面貌').control.multiple).toBeFalsy();
  });

  it('a date asks for the day, since the page only shows which panel it is once opened', () => {
    const { at } = scan();
    expect(at('出生日期').control.dateGranularity).toBe('day');
  });

  it('the number-type buttons beside the phone and ID boxes are not questions of their own', () => {
    const { contexts } = scan();
    expect(contexts.filter((c) => c.control.el.closest('.mobile-type-button'))).toHaveLength(0);
  });
});

describe('what the resume gives each', () => {
  it('the second project goes to the second set of boxes', () => {
    const { at } = scan();
    expect(at('项目名称', 0).step?.intent).toMatchObject({ kind: 'text', text: '校园二手交易平台' });
    expect(at('项目名称', 1).step?.intent).toMatchObject({ kind: 'text', text: '简历自动填写工具' });
  });

  // Live: with the add button inside the last entry's wrapper, the second entry's boxes went to review or unread.
  it.each([
    ['项目名称', 1, 'projects.name'],
    ['开始时间', 3, 'projects.startDate'],
    ['结束时间', 3, 'projects.endDate'],
    ['项目描述', 1, 'projects.description'],
  ] as const)('every box of the second project is filled from it: %s #%i', (title, nth, key) => {
    const { at } = scan();
    expect(at(title, nth).key).toBe(key);
    expect(at(title, nth).step, title).toBeDefined();
  });

  it('every city wanted goes to the box that takes several', () => {
    const { at } = scan();
    expect(at('期望工作城市').step?.intent).toMatchObject({ kind: 'multi', items: [{ query: '深圳' }, { query: '杭州' }] });
  });

  it('the identity number is never given, even when the resume holds one', () => {
    const { at } = scan();
    expect(at('证件号码').key).toBe('basics.idNumber');
    expect(at('证件号码').step?.intent).toBeUndefined();
  });

  it('a place on a list is asked for at each level', () => {
    const { at } = scan();
    const intent = at('户口所在地').step?.intent;
    expect(intent).toMatchObject({ kind: 'choice', query: '西湖区' });
    expect((intent as { wider?: { query: string }[] }).wider?.map((w) => w.query)).toEqual(['杭州市', '浙江省']);
  });
});
