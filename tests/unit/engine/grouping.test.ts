import { afterEach, describe, expect, it } from 'vitest';
import { discover } from '../../../src/engine/discover';
import { buildFieldContext, findGroup, findSection, stripNumbering } from '../../../src/engine/grouping';
import type { Control, FieldContext } from '../../../src/engine/types';

function scan(html: string): Control[] {
  document.body.innerHTML = html;
  return discover(document);
}

const $ = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el;
};

function contextOf(controls: Control[], selector: string): FieldContext {
  const target = $(selector);
  const hit = controls.find((c) => c.el === target || c.el.contains(target));
  if (!hit) throw new Error(`no control for ${selector}`);
  return buildFieldContext(hit);
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ---- markup builders ---------------------------------------------------------------------------------
const antdItem = (label: string, id: string, inner?: string) => `
  <div class="ant-form-item"><div class="ant-row ant-form-item-row">
    <div class="ant-col ant-form-item-label"><label for="${id}" title="${label}">${label}</label></div>
    <div class="ant-col ant-form-item-control"><div class="ant-form-item-control-input"><div class="ant-form-item-control-input-content">
      ${inner ?? `<input id="${id}" class="ant-input">`}
    </div></div></div></div></div>`;
const antdSelect = (id: string) => `<div class="ant-select ant-select-single"><div class="ant-select-selector"><span class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" type="search"></span></div></div>`;
const antdHead = (title: string) =>
  `<div class="ant-card-head"><div class="ant-card-head-wrapper"><div class="ant-card-head-title">${title}</div></div></div>`;
const antdCard = (title: string, body: string) =>
  `<div class="ant-card ant-card-bordered">${antdHead(title)}<div class="ant-card-body">${body}</div></div>`;
const antdInner = (title: string, body: string) =>
  `<div class="ant-card ant-card-bordered ant-card-type-inner">${antdHead(title)}<div class="ant-card-body">${body}</div></div>`;
const addButton = (text: string) => `<button type="button" class="ant-btn ant-btn-dashed"><span>${text}</span></button>`;

const eduFields = (i: number) =>
  antdItem('学校名称', `edu_${i}_school`, antdSelect(`edu_${i}_school`)) +
  antdItem('专业', `edu_${i}_major`) +
  antdItem('GPA', `edu_${i}_gpa`);

describe('stripNumbering', () => {
  it.each([
    ['教育经历 1', '教育经历'],
    ['教育经历1', '教育经历'],
    ['Employment 2', 'Employment'],
    ['Education #3', 'Education'],
    ['实习经历（2）', '实习经历'],
    ['Project (10)', 'Project'],
    ['第2段教育经历', '教育经历'],
    ['第 一 段 教育经历'.replace(/ /g, ''), '教育经历'],
    ['教育经历', '教育经历'],
    ['统一', '统一'],
    ['2', '2'],
    ['教育经历一', '教育经历'],
    ['教育经历二', '教育经历'],
    ['实习经历十二', '实习经历'],
    ['教育经历（二）', '教育经历'],
    ['教育经历 (三)', '教育经历'],
    ['教育经历【四】', '教育经历'],
    ['教育经历　２', '教育经历'],
    ['实习经历（２）', '实习经历'],
    ['第二段教育经历', '教育经历'],
    ['唯一', '唯一'],
    ['ＡＢＣ 公司', 'ＡＢＣ 公司'],
  ])('%s -> %s', (input, expected) => {
    expect(stripNumbering(input)).toBe(expected);
  });
});

describe('findSection', () => {
  it('finds a preceding h3 and reports its parent as the root', () => {
    scan('<div id="sec"><h3>Skills</h3><div class="row"><label for="a">Skill</label><input id="a"></div></div>');
    const s = findSection($('#a'));
    expect(s?.title).toBe('Skills');
    expect(s?.root).toBe($('#sec'));
  });

  it('finds the legend of an enclosing fieldset', () => {
    scan('<fieldset id="f"><legend>Address</legend><div><div class="row"><input id="a"></div></div></fieldset>');
    const s = findSection($('#a'));
    expect(s?.title).toBe('Address');
    expect(s?.root).toBe($('#f'));
  });

  it('finds [role=heading]', () => {
    scan('<section id="s"><div role="heading" aria-level="2">Referees</div><input id="a"></section>');
    expect(findSection($('#a'))?.title).toBe('Referees');
  });

  it('finds antd .ant-card-head-title and returns the card as root', () => {
    scan(antdCard('基本信息', antdItem('姓名', 'name')));
    const s = findSection($('#name'));
    expect(s?.title).toBe('基本信息');
    expect(s?.root).toBe($('.ant-card'));
  });

  it('finds Element Plus .el-card__header and ignores buttons inside it', () => {
    scan(`<div class="el-card" id="card"><div class="el-card__header"><span>教育经历</span><button class="el-button">添加</button></div>
      <div class="el-card__body"><div class="el-form-item"><label class="el-form-item__label" for="s">学校</label><input id="s"></div></div></div>`);
    const s = findSection($('#s'));
    expect(s?.title).toBe('教育经历');
    expect(s?.root).toBe($('#card'));
  });

  it('finds .ant-divider-inner-text', () => {
    scan('<div id="r"><div class="ant-divider"><span class="ant-divider-inner-text">联系方式</span></div><input id="a"></div>');
    expect(findSection($('#a'))?.title).toBe('联系方式');
  });

  it('uses a short title/header/heading class block when it heads a group of controls', () => {
    scan('<div id="r"><div class="section-title">Skills</div><input id="a"><input id="b"></div>');
    expect(findSection($('#b'))?.title).toBe('Skills');
  });

  it('does not treat a field-level title block as a section heading', () => {
    scan('<div id="r"><div class="field"><span class="field-title">Name</span><input id="a"></div></div>');
    expect(findSection($('#a'))).toBeNull();
  });

  it('ignores class-based headings longer than 30 characters', () => {
    scan(`<div><div class="section-title">${'x'.repeat(31)}</div><input id="a"><input id="b"></div>`);
    expect(findSection($('#a'))).toBeNull();
  });

  it('returns the closest heading when several are in scope', () => {
    scan('<div id="outer"><h2>Outer</h2><div id="inner"><h3>Inner</h3><input id="a"></div></div>');
    const s = findSection($('#a'));
    expect(s?.title).toBe('Inner');
    expect(s?.root).toBe($('#inner'));
  });

  it('skips sibling blocks that contain controls (e.g. an earlier card) and keeps climbing', () => {
    scan(`<div id="list"><h3>Jobs</h3>
      <div class="card"><div class="row"><input id="a"></div></div>
      <div class="card"><div class="row"><input id="b"></div></div></div>`);
    expect(findSection($('#b'))?.title).toBe('Jobs');
  });

  it('strips decoration from the title text', () => {
    scan('<div><h3> Work experience : </h3><input id="a"></div>');
    expect(findSection($('#a'))?.title).toBe('Work experience');
  });

  it('returns null when nothing looks like a heading', () => {
    scan('<div><input id="a"></div>');
    expect(findSection($('#a'))).toBeNull();
  });
});

describe('findGroup', () => {
  const card = (n: number) => `
    <div class="card"><h3>Employment ${n}</h3>
      <div class="row"><label for="t${n}">Job title</label><input id="t${n}"></div>
      <div class="row"><label for="c${n}">Company</label><input id="c${n}"></div>
      <div class="row"><label for="d${n}">Description</label><textarea id="d${n}"></textarea></div>
    </div>`;

  it('indexes two identical cards 0 and 1 with a shared key', () => {
    scan(`<fieldset id="f"><legend>Employment</legend><div id="list">${card(1)}${card(2)}</div></fieldset>`);
    const root = $('#f');
    const g0 = findGroup($('#c1'), root);
    const g1 = findGroup($('#d2'), root);
    expect(g0?.index).toBe(0);
    expect(g1?.index).toBe(1);
    expect(g0?.root).toBe(document.querySelectorAll('.card')[0]);
    expect(g1?.root).toBe(document.querySelectorAll('.card')[1]);
    expect(g0?.key).toBe(g1?.key);
    expect(g0?.key).toContain('Employment');
    expect(g0?.key).toContain('div.card');
  });

  it('puts every control of one card in the same group', () => {
    scan(`<fieldset id="f"><legend>Employment</legend>${card(1)}${card(2)}</fieldset>`);
    const idx = ['t2', 'c2', 'd2'].map((id) => findGroup($(`#${id}`), $('#f'))?.index);
    expect(idx).toEqual([1, 1, 1]);
  });

  it('groups table rows by position', () => {
    scan(`<fieldset id="f"><legend>Education</legend><table><thead><tr><th>School</th><th>Degree</th></tr></thead><tbody>
      <tr><td><input id="a1"></td><td><input id="b1"></td></tr>
      <tr><td><input id="a2"></td><td><input id="b2"></td></tr>
      <tr><td><input id="a3"></td><td><input id="b3"></td></tr></tbody></table></fieldset>`);
    const root = $('#f');
    expect(findGroup($('#b1'), root)?.index).toBe(0);
    expect(findGroup($('#a2'), root)?.index).toBe(1);
    expect(findGroup($('#b3'), root)?.index).toBe(2);
    expect(findGroup($('#a2'), root)?.root).toBe(document.querySelectorAll('tbody tr')[1]);
  });

  it('reports a lone card next to an add button as index 0 with the card as root', () => {
    scan(`<fieldset id="f"><legend>Employment</legend><div id="list">${card(1)}</div><button type="button">+ Add another</button></fieldset>`);
    const g = findGroup($('#c1'), $('#f'));
    expect(g?.index).toBe(0);
    expect(g?.root).toBe($('.card'));
  });

  it('recognises Chinese add buttons such as 添加教育经历', () => {
    scan(`<div id="sec"><div class="entry"><input id="a"><input id="b"></div>${addButton('+ 添加教育经历')}</div>`);
    const g = findGroup($('#a'), $('#sec'));
    expect(g?.index).toBe(0);
    expect(g?.root).toBe($('.entry'));
  });

  it('keeps the single-card key identical to the key once a second card exists', () => {
    scan(`<fieldset id="f"><legend>Employment</legend><div id="list">${card(1)}</div><button type="button">+ Add another</button></fieldset>`);
    const single = findGroup($('#c1'), $('#f'), 'Employment');
    $('#list').insertAdjacentHTML('beforeend', card(2));
    const multi = findGroup($('#c2'), $('#f'), 'Employment');
    expect(multi?.index).toBe(1);
    expect(multi?.key).toBe(single?.key);
  });

  it('does not treat a lone card without an add button as a group', () => {
    scan(`<fieldset id="f"><legend>Employment</legend>${card(1)}</fieldset>`);
    expect(findGroup($('#c1'), $('#f'))).toBeNull();
  });

  it('does not group a plain section of single-control rows', () => {
    scan(`<fieldset id="f"><legend>Personal</legend>
      <div class="row"><label for="a">First</label><input id="a"></div>
      <div class="row"><label for="b">Last</label><input id="b"></div></fieldset>`);
    expect(findGroup($('#a'), $('#f'))).toBeNull();
  });

  it('does not group look-alike layout rows whose labels differ', () => {
    scan(`<fieldset id="f"><legend>Personal</legend>
      <div class="row"><label for="a">First name</label><input id="a"><label for="b">Last name</label><input id="b"></div>
      <div class="row"><label for="c">Email</label><input id="c"><label for="d">Mobile</label><input id="d"></div></fieldset>`);
    expect(findGroup($('#a'), $('#f'))).toBeNull();
    expect(findGroup($('#d'), $('#f'))).toBeNull();
  });

  it('does not treat sibling sections as repeated cards when the section root is unknown', () => {
    scan(`<form><fieldset><legend>Address</legend><input id="a" name="street"><input id="b" name="suburb"></fieldset>
      <fieldset><legend>Links</legend><input id="c" name="linkedin"><input id="d" name="github"></fieldset></form>`);
    expect(findGroup($('#a'), null)).toBeNull();
  });

  it('ignores state classes when comparing signatures', () => {
    scan(`<div id="s"><h3>Jobs</h3>
      <div class="card is-active"><label for="a">Title</label><input id="a"><label for="b">Company</label><input id="b"></div>
      <div class="card"><label for="c">Title</label><input id="c"><label for="d">Company</label><input id="d"></div></div>`);
    expect(findGroup($('#a'), $('#s'))?.index).toBe(0);
    expect(findGroup($('#c'), $('#s'))?.index).toBe(1);
  });

  it('does not count library inner inputs twice when sizing a card', () => {
    // A lone antd Select item has 1 control (its search input is consumed by the widget).
    scan(`<div id="s"><h3>Jobs</h3>${antdItem('A', 'a', antdSelect('a'))}${antdItem('B', 'b', antdSelect('b'))}</div>`);
    expect(findGroup($('#a'), $('#s'))).toBeNull();
  });

  it.each([
    ['教育经历一', '教育经历二'],
    ['教育经历（一）', '教育经历（二）'],
    ['教育经历１', '教育经历２'],
  ])('keeps %s and %s as two cards of one section', (first, second) => {
    const cnCard = (title: string, n: number) => `
      <div class="card"><h4>${title}</h4>
        <div class="row"><label for="s${n}">学校名称</label><input id="s${n}"></div>
        <div class="row"><label for="m${n}">专业</label><input id="m${n}"></div>
      </div>`;
    scan(`<fieldset id="f"><legend>教育经历</legend>${cnCard(first, 1)}${cnCard(second, 2)}</fieldset>`);
    const g0 = findGroup($('#s1'), $('#f'));
    const g1 = findGroup($('#m2'), $('#f'));
    expect(g0?.index).toBe(0);
    expect(g1?.index).toBe(1);
    expect(g0?.key).toBe(g1?.key);
  });
});

describe('buildFieldContext (native)', () => {
  const nativeEmployment = (n: number) => `
    <div class="card"><h3>Employment ${n}</h3>
      <div class="row"><label for="t${n}">Job title</label><input id="t${n}" required></div>
      <div class="row"><label for="c${n}">Company</label><input id="c${n}"></div>
      <div class="row"><label><input type="checkbox" id="cur${n}"> I currently work here</label></div>
    </div>`;

  it('uses the outer legend as section title and the numbered card as the group', () => {
    const controls = scan(`<fieldset id="f"><legend>Employment</legend><div id="list">${nativeEmployment(1)}${nativeEmployment(2)}</div>
      <button type="button" id="add-employment">+ Add another</button></fieldset>`);
    const a = contextOf(controls, '#c1');
    const b = contextOf(controls, '#t2');
    expect(a.sectionTitle).toBe('Employment');
    expect(b.sectionTitle).toBe('Employment');
    expect(a.sectionRoot).toBe($('#f'));
    expect(a.group?.index).toBe(0);
    expect(b.group?.index).toBe(1);
    expect(a.group?.key).toBe(b.group?.key);
    expect(a.evidence[0]).toEqual({ source: 'label-for', text: 'Company', weight: 1 });
    expect(b.required).toBe(true);
    expect(a.required).toBe(false);
    expect(a.control).toBe(controls.find((c) => c.el === $('#c1')));
  });

  it('supports a single card next to the add button', () => {
    const controls = scan(`<fieldset id="f"><legend>Employment</legend><div id="list">${nativeEmployment(1)}</div>
      <button type="button">+ Add another</button></fieldset>`);
    const ctx = contextOf(controls, '#c1');
    expect(ctx.sectionTitle).toBe('Employment');
    expect(ctx.group?.index).toBe(0);
    expect(ctx.group?.root).toBe($('.card'));
  });

  it('falls back to the card title with numbering stripped when there is no outer heading', () => {
    const controls = scan(`<div id="cards">${nativeEmployment(1)}${nativeEmployment(2)}</div>`);
    const ctx = contextOf(controls, '#c2');
    expect(ctx.sectionTitle).toBe('Employment');
    expect(ctx.group?.index).toBe(1);
    expect(ctx.sectionRoot).toBe($('#cards'));
  });

  it('handles repeated cards that carry the same un-numbered title', () => {
    const same = (n: number) => `<div class="card"><h3>Project</h3>
      <label for="n${n}">Name</label><input id="n${n}"><label for="u${n}">URL</label><input id="u${n}"></div>`;
    const controls = scan(`<div id="wrap">${same(1)}${same(2)}</div>`);
    const a = contextOf(controls, '#u1');
    const b = contextOf(controls, '#n2');
    expect(a.sectionTitle).toBe('Project');
    expect([a.group?.index, b.group?.index]).toEqual([0, 1]);
  });

  it('describes table cells with header evidence, section and row index', () => {
    const controls = scan(`<fieldset><legend>Education</legend><table><thead><tr><th>Institution</th><th>Degree</th></tr></thead><tbody>
      <tr><td><input id="a1"></td><td><select id="b1"><option value="">Select</option><option>Bachelor</option></select></td></tr>
      <tr><td><input id="a2"></td><td><select id="b2"><option value="">Select</option><option>Bachelor</option></select></td></tr>
      </tbody></table></fieldset>`);
    const ctx = contextOf(controls, '#b2');
    expect(ctx.sectionTitle).toBe('Education');
    expect(ctx.group?.index).toBe(1);
    expect(ctx.evidence.map((e) => e.text)).toContain('Degree');
    expect(ctx.evidence[0]!.source).toBe('table-header');
  });

  it('leaves section and group null for a bare control', () => {
    const controls = scan('<input id="a" placeholder="Anything">');
    const ctx = contextOf(controls, '#a');
    expect(ctx.sectionTitle).toBeNull();
    expect(ctx.sectionRoot).toBeNull();
    expect(ctx.group).toBeNull();
  });
});

describe('buildFieldContext (antd)', () => {
  const page = (entries: number) =>
    antdCard('基本信息', antdItem('姓名', 'name')) +
    antdCard(
      '教育经历',
      Array.from({ length: entries }, (_, i) => antdInner(`教育经历 ${i + 1}`, eduFields(i))).join('') +
        addButton('+ 添加教育经历'),
    );

  it('prefers the OUTER card title over the numbered inner card title', () => {
    const controls = scan(page(2));
    const school1 = contextOf(controls, '#edu_0_school');
    const gpa2 = contextOf(controls, '#edu_1_gpa');
    expect(school1.sectionTitle).toBe('教育经历');
    expect(gpa2.sectionTitle).toBe('教育经历');
    // .ant-card order: 基本信息, 教育经历 (outer), inner 1, inner 2
    expect(school1.sectionRoot).toBe(document.querySelectorAll('.ant-card')[1]);
  });

  it('groups by the inner card', () => {
    const controls = scan(page(2));
    const inner = document.querySelectorAll('.ant-card-type-inner');
    const a = contextOf(controls, '#edu_0_major');
    const b = contextOf(controls, '#edu_1_school');
    expect(a.group?.index).toBe(0);
    expect(a.group?.root).toBe(inner[0]);
    expect(b.group?.index).toBe(1);
    expect(b.group?.root).toBe(inner[1]);
    expect(a.group?.key).toBe(b.group?.key);
  });

  it('reports one inner card next to 添加教育经历 as group 0', () => {
    const controls = scan(page(1));
    const ctx = contextOf(controls, '#edu_0_major');
    expect(ctx.sectionTitle).toBe('教育经历');
    expect(ctx.group?.index).toBe(0);
    expect(ctx.group?.root).toBe($('.ant-card-type-inner'));
  });

  it('keeps the group key stable when the second inner card appears', () => {
    const one = contextOf(scan(page(1)), '#edu_0_major');
    const two = contextOf(scan(page(2)), '#edu_1_major');
    expect(two.group?.index).toBe(1);
    expect(two.group?.key).toBe(one.group?.key);
  });

  it('does not group the flat single-card sections', () => {
    const controls = scan(page(2));
    const ctx = contextOf(controls, '#name');
    expect(ctx.sectionTitle).toBe('基本信息');
    expect(ctx.group).toBeNull();
  });

  it('does not mistake a phone form-item (select + input) for a repeated card', () => {
    const phone = antdItem(
      '手机号码',
      'phone',
      `<span class="ant-input-group-wrapper"><span class="ant-input-wrapper ant-input-group"><span class="ant-input-group-addon">${antdSelect('phoneCountryCode')}</span><input id="phone" class="ant-input"></span></span>`,
    );
    const controls = scan(antdCard('基本信息', antdItem('姓名', 'name') + phone + antdItem('邮箱', 'email')));
    expect(contextOf(controls, '#phone').group).toBeNull();
    expect(contextOf(controls, '.ant-select').group).toBeNull();
    expect(contextOf(controls, '.ant-select').sectionTitle).toBe('基本信息');
  });

  it('falls back to a numbered card title (stripped) when no outer card exists', () => {
    const controls = scan(
      `<div id="wrap">${antdInner('教育经历 1', eduFields(0))}${antdInner('教育经历 2', eduFields(1))}</div>`,
    );
    const ctx = contextOf(controls, '#edu_1_major');
    expect(ctx.sectionTitle).toBe('教育经历');
    expect(ctx.group?.index).toBe(1);
  });
});

describe('buildFieldContext (Element Plus)', () => {
  const elItem = (label: string, id: string) =>
    `<div class="el-form-item"><label class="el-form-item__label" for="${id}">${label}</label><div class="el-form-item__content"><div class="el-input"><div class="el-input__wrapper"><input id="${id}" class="el-input__inner"></div></div></div></div>`;
  const elCard = (title: string, body: string) =>
    `<div class="el-card"><div class="el-card__header"><span>${title}</span></div><div class="el-card__body">${body}</div></div>`;

  it('finds the el-card header and repeated el-cards', () => {
    const entry = (i: number) => elCard(`项目经历 ${i + 1}`, elItem('项目名称', `p${i}n`) + elItem('项目角色', `p${i}r`));
    const controls = scan(elCard('项目经历', entry(0) + entry(1)));
    const ctx = contextOf(controls, '#p1r');
    expect(ctx.sectionTitle).toBe('项目经历');
    expect(ctx.group?.index).toBe(1);
    expect(contextOf(controls, '#p0n').group?.index).toBe(0);
  });

  it('indexes plain table rows with el-input cells', () => {
    const cell = (id: string) => `<td><div class="el-input"><div class="el-input__wrapper"><input id="${id}" class="el-input__inner"></div></div></td>`;
    const controls = scan(`<div class="el-card"><div class="el-card__header">教育经历</div><div class="el-card__body">
      <table><thead><tr><th>学校</th><th>专业</th></tr></thead><tbody>
      <tr>${cell('r0a')}${cell('r0b')}</tr><tr>${cell('r1a')}${cell('r1b')}</tr></tbody></table></div></div>`);
    const ctx = contextOf(controls, '#r1b');
    expect(ctx.sectionTitle).toBe('教育经历');
    expect(ctx.group?.index).toBe(1);
    expect(ctx.evidence.map((e) => e.text)).toContain('专业');
  });
});

describe('buildFieldContext (shadow DOM)', () => {
  it('works inside an open shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<fieldset><legend>Address</legend><label for="s">Street</label><input id="s"></fieldset>';
    const controls = discover(document);
    expect(controls).toHaveLength(1);
    const ctx = buildFieldContext(controls[0]!);
    expect(ctx.sectionTitle).toBe('Address');
    expect(ctx.evidence[0]).toEqual({ source: 'label-for', text: 'Street', weight: 1 });
  });
});
