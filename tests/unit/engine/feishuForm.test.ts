// A real Feishu recruiting form: every question found, each card its own entry, the consent box left alone.
import { afterEach, describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { entryCount } from '../../../src/engine/values';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';
import { FEISHU_ENTRY_FORM, FEISHU_FORM } from '../../shared/feishuForm';

afterEach(() => {
  document.body.replaceChildren();
});

function scan() {
  const doc = new DOMParser().parseFromString(`<body>${FEISHU_FORM}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
  const { contexts, classifications, fillableCount } = scanDocument(document);
  const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
  const plan = planFill(contexts, classifications, resume, {});
  const of = (title: string) =>
    contexts.flatMap((c, i) =>
      c.control.el.closest('.ud-formily-item')?.querySelector('label')?.textContent === title
        ? [{ control: c.control, key: classifications[i]!.fieldKey, step: plan.steps.find((s) => s.fieldId === c.control.id) }]
        : [],
    );
  return { contexts, classifications, fillableCount, plan, of };
}

describe('a language everyone assumes', () => {
  const languages = (locale: 'zh-CN' | 'en-AU', names: string[]) => {
    const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
    resume.locale = locale;
    resume.languages = names.map((language) => ({ ...resume.languages[0]!, language }));
    return resume;
  };

  it.each(['中文', '汉语', '普通话', '中文普通话', '中文（普通话）', '中文(普通话)', 'Chinese', 'Mandarin', 'Chinese (Mandarin)'])('%s takes no card on a Chinese resume', (name) => {
    expect(entryCount(languages('zh-CN', [name, '英语']), 'languages')).toBe(1);
  });

  it('other languages each keep theirs', () => {
    expect(entryCount(languages('zh-CN', ['英语', '日语']), 'languages')).toBe(2);
  });

  it('粤语 is a language someone may want to say they speak', () => {
    expect(entryCount(languages('zh-CN', ['粤语', '英语']), 'languages')).toBe(2);
  });

  it('on an English resume Chinese is a language like any other', () => {
    expect(entryCount(languages('en-AU', ['Chinese', 'English']), 'languages')).toBe(2);
  });
});

describe('every question on the form is read', () => {
  it.each([
    ['姓名', 'text', 'basics.fullName', 'feishu', 1],
    ['邮箱', 'text', 'contact.email', 'native', 1],
    ['性别', 'select', 'basics.gender', 'feishu', 1],
    ['出生日期', 'date', 'basics.birthDate', 'feishu', 1],
    ['学校名称', 'select', 'education.school', 'feishu', 2],
    ['学历', 'select', 'education.degree', 'feishu', 2],
    ['学历类型', 'select', 'education.educationType', 'feishu', 2],
    ['精通程度', 'select', 'languages.proficiency', 'feishu', 1],
    ['专业', 'text', 'education.major', 'native', 2],
    ['项目名称', 'text', 'projects.name', 'native', 2],
    ['项目角色', 'text', 'projects.role', 'native', 2],
    ['项目链接', 'text', 'projects.link', 'native', 2],
    ['描述', 'textarea', 'projects.description', 'native', 2],
    ['自我评价', 'textarea', 'misc.selfIntroduction', 'native', 1],
  ] as const)('%s', (title, kind, key, lib, count) => {
    const found = scan().of(title);
    expect(found).toHaveLength(count);
    for (const f of found) {
      expect(f.key).toBe(key);
      expect(f.control.kind).toBe(kind);
      if (title !== '姓名' && lib !== 'native') expect(f.control.lib).toBe(lib);
    }
  });

  it('nearly every box counts, not one or two', () => {
    expect(scan().fillableCount).toBeGreaterThanOrEqual(22);
  });

  it('the consent box is not touched', () => {
    const { contexts, plan } = scan();
    const box = contexts.find((c) => c.control.kind === 'checkbox');
    if (box) expect(plan.steps.some((s) => s.fieldId === box.control.id)).toBe(false);
  });
});

describe('what the form is given', () => {
  it('each school card is its own school, and its span is two ends', () => {
    const { of } = scan();
    const schools = of('学校名称').map((f) => f.step?.intent);
    expect(schools[0]).toMatchObject({ kind: 'choice', query: '浙江大学' });
    expect(schools[1]).toMatchObject({ kind: 'choice', query: '澳大利亚国立大学' });
    const spans = of('起止时间');
    expect(spans[0]!.control.dateRange).toBe(true);
    expect(spans[0]!.step?.intent).toMatchObject({ kind: 'dateRange', start: { year: 2020, month: 9 }, end: { year: 2024, month: 6 } });
    expect(spans[1]!.step?.intent).toMatchObject({ kind: 'dateRange', start: { year: 2024, month: 7 }, end: { year: 2026, month: 6 } });
  });

  it('a project span goes with its project, not with the schools', () => {
    const spans = scan().of('起止时间');
    expect(spans).toHaveLength(4);
    expect(spans[2]!.key).toBe('projects.period');
    expect(spans[3]!.key).toBe('projects.period');
  });

  it('a project still going keeps its start and does not keep the end of what was there before', () => {
    const doc = new DOMParser().parseFromString(`<body>${FEISHU_FORM}</body>`, 'text/html');
    document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
    const { contexts, classifications } = scanDocument(document);
    const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
    resume.projects = [{ ...resume.projects[0]!, startDate: '2026-07', endDate: null, current: true }];
    const plan = planFill(contexts, classifications, resume, {});
    const i = contexts.findIndex((c, k) => classifications[k]!.fieldKey === 'projects.period');
    expect(plan.steps.find((s) => s.fieldId === contexts[i]!.control.id)?.intent).toMatchObject({ kind: 'dateFrom', start: { year: 2026, month: 7 } });
  });

  it('the name field of a project is not the name of the person', () => {
    const names = scan().of('项目名称');
    expect(names.every((n) => n.step?.intent.kind === 'text' && n.step.intent.text !== '林知远')).toBe(true);
  });
});

describe('sections that take several entries', () => {
  function scanEntries() {
    const doc = new DOMParser().parseFromString(`<body>${FEISHU_ENTRY_FORM}</body>`, 'text/html');
    document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
    const { contexts, classifications } = scanDocument(document);
    const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
    const plan = planFill(contexts, classifications, resume, {});
    return (section: string, title: string) => {
      const i = contexts.findIndex(
        (c) =>
          c.control.el.closest('.ud-formily-item')?.querySelector('label')?.textContent === title &&
          c.control.el.closest('.applyFormModuleWrapper__d8a302')?.querySelector('.applyFormModuleWrapper-text')?.textContent === section,
      );
      if (i < 0) throw new Error(`no ${title} under ${section}`);
      const planned = plan.steps.some((s) => s.fieldId === contexts[i]!.control.id);
      return { key: classifications[i]!.fieldKey, planned };
    };
  }

  it('the 描述 of an internship is filled, not left to check', () => {
    expect(scanEntries()('实习经历', '描述')).toEqual({ key: 'work.description', planned: true });
  });

  it.each([
    ['实习经历', '公司名称', 'work.company'],
    ['实习经历', '职位名称', 'work.position'],
    ['实习经历', '起止时间', 'work.period'],
    ['实习经历', '描述', 'work.description'],
    ['项目经历', '描述', 'projects.description'],
    ['获奖经历', '奖项名称', 'awards.name'],
    ['获奖经历', '获奖时间', 'awards.date'],
    ['获奖经历', '描述', 'awards.description'],
  ])('%s %s', (section, title, key) => {
    expect(scanEntries()(section, title).key).toBe(key);
  });
});
