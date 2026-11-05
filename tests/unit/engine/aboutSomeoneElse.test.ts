// Name and phone under a heading about someone else are that person's, however the page nests or numbers the heading.
import { afterEach, describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';

afterEach(() => {
  document.body.replaceChildren();
});

const sample = () => structuredClone(createSampleProfile().resumes.find((x) => x.id === 'sample-zh')!);

function answers(html: string): (string | null)[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
  const { contexts, classifications } = scanDocument(document);
  const { steps } = planFill(contexts, classifications, sample(), {});
  return contexts.map((c) => {
    const step = steps.find((s) => s.fieldId === c.control.id);
    return step?.intent.kind === 'text' ? step.intent.text : null;
  });
}

const item = (cls: string, id: string, label: string) => `<div class="${cls}"><label for="${id}">${label}</label><input id="${id}" type="text"></div>`;

const NAME = '林知远';
const PHONE = '13800138000';

function expectNoneOfTheApplicant(html: string): void {
  const got = answers(html);
  expect(got.length).toBeGreaterThan(0);
  expect(got).not.toContain(NAME);
  expect(got).not.toContain(PHONE);
}

describe('a heading inside a wrapper', () => {
  it.each(['el-form-item', 'ud-formily-item', 'ant-form-item'])('%s holding questions of its own', (cls) => {
    expectNoneOfTheApplicant(
      `<h2>基本信息</h2>${item('el-form-item', 'x', '邮箱')}<div class="${cls}"><div class="sub-title">紧急联系人</div>${item(cls, 'a', '姓名')}${item(cls, 'b', '电话')}</div>`,
    );
  });
});

describe('a card about someone else, under a heading about the applicant', () => {
  const card = (title: string, n: string) => `<div class="card"><div class="title">${title}</div>${item('row', `a${n}`, '姓名')}${item('row', `b${n}`, '电话')}</div>`;

  it.each([
    ['one numbered', card('家庭成员1', '1')],
    ['two numbered', card('家庭成员1', '1') + card('家庭成员2', '2')],
    ['two the same', card('家庭成员', '1') + card('家庭成员', '2')],
    ['numbered contacts', card('紧急联系人1', '1') + card('紧急联系人2', '2')],
    ['referees', card('推荐人1', '1') + card('推荐人2', '2')],
  ])('%s', (_name, cards) => {
    expectNoneOfTheApplicant(`<div class="wrap"><h2>基本信息</h2>${item('row', 'x', '邮箱')}<div class="list">${cards}</div></div>`);
  });

  it('the applicant’s own card keeps the applicant', () => {
    const got = answers(`<div class="wrap"><h2>基本信息</h2><div class="card"><div class="title">个人信息</div>${item('row', 'a', '姓名')}</div></div>`);
    expect(got).toContain(NAME);
  });
});

describe('联系人信息 asks about a contact person', () => {
  it('not the applicant', () => {
    expectNoneOfTheApplicant(`<h2>联系人信息</h2>${item('row', 'a', '姓名')}${item('row', 'b', '电话')}`);
  });

  it('联系信息 is still the applicant’s own', () => {
    expect(answers(`<h2>联系信息</h2>${item('row', 'b', '电话')}`)).toContain(PHONE);
  });
});

describe('a question that names someone else, among the applicant’s own', () => {
  it.each(['父亲姓名', '配偶姓名', '导师姓名', 'HR姓名', '母亲手机', '领导电话', '母亲邮箱', 'Father name', 'Guardian phone', 'Parent email'])('%s', (label) => {
    const got = answers(`<h2>基本信息</h2>${item('row', 'a', label)}${item('row', 'x', '姓名')}`);
    expect(got[0]).not.toBe(NAME);
    expect(got[0]).not.toBe(PHONE);
    expect(got[0]).not.toBe('zhiyuan.lin@example.com');
  });
});

describe('more words for a family', () => {
  const card = (title: string, n: string) => `<div class="card"><div class="title">${title}</div>${item('row', `a${n}`, '姓名')}${item('row', `b${n}`, '电话')}</div>`;

  it.each(['家属1', '直系亲属1', '家庭及社会关系1', '家庭成员及社会关系1', 'Parent 1', 'Guardian 1'])('%s', (title) => {
    expectNoneOfTheApplicant(`<div class="wrap"><h2>基本信息</h2>${item('row', 'x', '邮箱')}<div class="list">${card(title, '1')}${card(title.replace('1', '2'), '2')}</div></div>`);
  });

  it('a table captioned with one', () => {
    expectNoneOfTheApplicant(`<h2>基本信息</h2><table><caption>家庭成员</caption><tbody><tr><td><label for="a">姓名</label><input id="a" type="text"></td><td><label for="b">电话</label><input id="b" type="text"></td></tr></tbody></table>`);
  });

  it('Family name over its two boxes is no family', () => {
    const got = answers(`<h2>基本信息</h2><div class="ant-form-item"><div class="sub-title">Family name</div>${item('ant-form-item', 'a', '姓')}${item('ant-form-item', 'b', '名')}</div>`);
    expect(got).toContain('知远');
    expect(got).not.toContain('林建国');
  });
});

describe('联系人信息 does not say whose', () => {
  it.each(['联系人信息', '联系人'])('%s: neither the applicant nor anyone else without a look', (title) => {
    const got = answers(`<h2>${title}</h2>${item('row', 'a', '姓名')}${item('row', 'b', '电话')}`);
    expect(got).toEqual([null, null]);
  });
});

