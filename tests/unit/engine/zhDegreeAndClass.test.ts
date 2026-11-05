// Two things Chinese forms ask that foreign ones do not: 学位 apart from 学历, and 届别, the graduating class.
import { afterEach, describe, expect, it } from 'vitest';
import { expandFieldKeys } from '../../../src/engine/fieldDeps';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';
import type { Resume } from '../../../src/schema/resume';

afterEach(() => {
  document.body.replaceChildren();
});

function plan(html: string, change: (r: Resume) => void = () => undefined) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
  const { contexts, classifications } = scanDocument(document);
  const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);
  change(resume);
  return { contexts, classifications, ...planFill(contexts, classifications, resume, {}) };
}

/** What the plan would put in the field labelled so: the text, or the option a list would choose. */
function answer(out: ReturnType<typeof plan>, id: string): string | null {
  const index = out.contexts.findIndex((c) => c.control.el.id === id);
  const step = out.steps.find((s) => s.fieldId === out.contexts[index]?.control.id);
  if (!step) return null;
  const intent = step.intent;
  if (intent.kind === 'text') return intent.text;
  if (intent.kind === 'choice') {
    const options = out.contexts[index]!.control.options ?? [];
    const m = intent.match(options);
    return m.status === 'matched' ? options[m.index]!.label : `(${m.status})`;
  }
  return `(${intent.kind})`;
}

const select = (id: string, label: string, options: string[]) =>
  `<label for="${id}">${label}</label><select id="${id}"><option value="">请选择</option>${options
    .map((o) => `<option value="${o}">${o}</option>`)
    .join('')}</select>`;
const box = (id: string, label: string) => `<label for="${id}">${label}</label><input id="${id}" type="text">`;
const card = (body: string) => `<section><h2>教育经历</h2>${body}</section>`;
const onlyBachelor = (r: Resume) => {
  r.education = [{ ...r.education[0]!, degree: 'bachelor', endDate: '2024-06', current: false }];
};

describe('学位 is not 学历', () => {
  it('a typed answer names the degree, not the level of schooling', () => {
    const out = plan(card(box('a', '学历') + box('b', '学位')), onlyBachelor);
    expect(answer(out, 'a')).toBe('本科');
    expect(answer(out, 'b')).toBe('学士');
  });

  it('both lists get their own word', () => {
    const out = plan(card(select('a', '学历', ['大专', '本科', '硕士研究生']) + select('b', '学位', ['学士', '硕士', '博士'])), onlyBachelor);
    expect(answer(out, 'a')).toBe('本科');
    expect(answer(out, 'b')).toBe('学士');
  });

  it('a form that writes 本科 under 学位 still gets it', () => {
    expect(answer(plan(card(select('b', '学位', ['本科', '硕士', '博士'])), onlyBachelor), 'b')).toBe('本科');
  });

  it('a form asking for one thing under both words gets the level', () => {
    expect(answer(plan(card(box('c', '学历/学位')), onlyBachelor), 'c')).toBe('本科');
    expect(answer(plan(card(box('c', '学历学位')), onlyBachelor), 'c')).toBe('本科');
  });

  it('a 大专 has no 学位 to give, and none is made up', () => {
    const out = plan(card(select('a', '学历', ['大专', '本科']) + select('b', '学位', ['学士', '硕士', '无'])), (r) => {
      r.education = [{ ...r.education[0]!, degree: 'associate' }];
    });
    expect(answer(out, 'a')).toBe('大专');
    expect(['学士', '硕士', '无']).not.toContain(answer(out, 'b'));
    expect(answer(plan(card(box('b', '学位')), (r) => {
      r.education = [{ ...r.education[0]!, degree: 'associate' }];
    }), 'b')).toBeNull();
  });

  it.each(['学位证书编号', '学位证号', '学位授予单位', '学位授予时间', '学位论文题目'])('%s is another question', (label) => {
    const out = plan(card(box('b', label)), onlyBachelor);
    expect(answer(out, 'b')).not.toBe('学士');
  });
});

describe('届别', () => {
  it.each([
    [['2025届', '2026届', '2027届'], '2026届'],
    [['2025', '2026', '2027'], '2026'],
    [['2025年', '2026年'], '2026年'],
    [['2025届毕业生', '2026届毕业生'], '2026届毕业生'],
  ])('the latest graduation picks from %j', (options, want) => {
    expect(answer(plan(select('y', '毕业届别', options)), 'y')).toBe(want);
  });

  it.each(['届别', '毕业届别', '所属届别', '毕业届'])('%s in a text box', (label) => {
    expect(answer(plan(box('y', label)), 'y')).toBe('2026届');
  });

  it('a class that is not offered is left alone', () => {
    expect(answer(plan(select('y', '届别', ['2024届', '2025届'])), 'y')).toBe('(none)');
  });

  it('two options for the one year is for the applicant to settle', () => {
    expect(answer(plan(select('y', '届别', ['2026届春招', '2026届秋招'])), 'y')).toBe('(ambiguous)');
  });

  it('a year inside a longer number is not that year', () => {
    expect(answer(plan(select('y', '届别', ['120260', '2025届'])), 'y')).toBe('(none)');
  });

  it('still studying with an expected date counts; with none, nothing is invented', () => {
    const expected = (r: Resume) => {
      r.education = [{ ...r.education[0]!, endDate: '2027-06', current: true }];
    };
    expect(answer(plan(box('y', '届别'), expected), 'y')).toBe('2027届');
    const open = (r: Resume) => {
      r.education = [{ ...r.education[0]!, endDate: null, current: true }];
    };
    expect(answer(plan(box('y', '届别'), open), 'y')).toBeNull();
  });

  it('whichever card it sits on, it is the class of the schooling being finished', () => {
    expect(answer(plan(card(box('y1', '届别'))), 'y1')).toBe('2026届');
  });

  it('a frame is only sent what the answer needs', () => {
    expect([...expandFieldKeys(['education.classYear'])]).toEqual(expect.arrayContaining(['education.endDate']));
  });
});

describe('which schooling is meant, when the question sits with the name', () => {
  const basics = (body: string) => `<section><h2>基本信息</h2>${body}</section>`;
  const page = basics(box('s', '毕业院校') + box('y', '届别'));

  it('a later row with no level written down is not passed over for an older one that has one', () => {
    const out = plan(page, (r) => {
      r.education = [
        { ...r.education[0]!, school: '旧学校', degree: 'bachelor', endDate: '2019-06', current: false },
        { ...r.education[0]!, school: '新学校', degree: null, endDate: '2025-06', current: false },
      ];
    });
    expect(answer(out, 's')).not.toBe('旧学校');
    expect(answer(out, 'y')).not.toBe('2019届');
  });

  it('of two at the same level, the one still going is the one meant', () => {
    const out = plan(page, (r) => {
      r.education = [
        { ...r.education[0]!, school: '旧学校', degree: 'master', endDate: '2020-06', current: false },
        { ...r.education[0]!, school: '新学校', degree: 'master', endDate: null, current: true },
      ];
    });
    expect(answer(out, 's')).toBe('新学校');
    expect(answer(out, 'y')).not.toBe('2020届');
  });

  it('a level written down and finishing last still answers', () => {
    const out = plan(page, (r) => {
      r.education = [
        { ...r.education[0]!, school: '旧学校', degree: 'bachelor', endDate: '2019-06', current: false },
        { ...r.education[0]!, school: '新学校', degree: 'master', endDate: '2025-06', current: false },
      ];
    });
    expect(answer(out, 's')).toBe('新学校');
    expect(answer(out, 'y')).toBe('2025届');
  });

  it('the class is the year the last of them ends, whatever the level', () => {
    const out = plan(page, (r) => {
      r.education = [
        { ...r.education[0]!, school: '甲', degree: 'master', endDate: '2020-06', current: false },
        { ...r.education[0]!, school: '乙', degree: 'bachelor', endDate: '2024-06', current: false },
      ];
    });
    expect(answer(out, 'y')).toBe('2024届');
  });
});
