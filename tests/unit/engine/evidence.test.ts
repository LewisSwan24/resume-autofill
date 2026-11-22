import { afterEach, describe, expect, it } from 'vitest';
import { discover } from '../../../src/engine/discover';
import { collectEvidence, collectRequired, cleanEvidenceText } from '../../../src/engine/evidence';
import type { Control, Evidence, EvidenceSource } from '../../../src/engine/types';

function scan(html: string): Control[] {
  document.body.innerHTML = html;
  return discover(document);
}

/** The control whose widget root is (or contains) the element matched by `selector`. */
function controlAt(controls: Control[], selector: string): Control {
  const target = document.querySelector(selector);
  if (!target) throw new Error(`no element for ${selector}`);
  const hit = controls.find((c) => c.el === target || c.el.contains(target));
  if (!hit) throw new Error(`no control for ${selector}`);
  return hit;
}

function evidenceAt(html: string, selector: string): Evidence[] {
  return collectEvidence(controlAt(scan(html), selector));
}

const texts = (ev: Evidence[], source: EvidenceSource) => ev.filter((e) => e.source === source).map((e) => e.text);
const weightOf = (ev: Evidence[], source: EvidenceSource) => ev.find((e) => e.source === source)?.weight;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('evidence sources (native)', () => {
  it('reads label[for] with weight 1.0', () => {
    const ev = evidenceAt('<label for="fn">First name</label><input id="fn">', '#fn');
    expect(texts(ev, 'label-for')).toEqual(['First name']);
    expect(weightOf(ev, 'label-for')).toBe(1);
  });

  it('reads a wrapping label without the control text', () => {
    const ev = evidenceAt('<label>Preferred name <input name="x"></label>', 'input');
    expect(texts(ev, 'label-wrap')).toEqual(['Preferred name']);
    expect(weightOf(ev, 'label-wrap')).toBe(1);
  });

  it('does not leak <option> text of a wrapped select into the label', () => {
    const ev = evidenceAt('<label>Pronouns <select><option>He</option><option>She</option></select></label>', 'select');
    expect(texts(ev, 'label-wrap')).toEqual(['Pronouns']);
  });

  it('joins several aria-labelledby ids in order', () => {
    const ev = evidenceAt(
      '<span id="a">Mobile</span> <span id="b">number</span><input aria-labelledby="a b" name="q">',
      'input',
    );
    expect(texts(ev, 'aria-labelledby')).toEqual(['Mobile number']);
    expect(weightOf(ev, 'aria-labelledby')).toBe(0.95);
  });

  it('reads aria-label', () => {
    const ev = evidenceAt('<input aria-label="Email" name="contact_email">', 'input');
    expect(texts(ev, 'aria-label')).toEqual(['Email']);
    expect(weightOf(ev, 'aria-label')).toBe(0.9);
  });

  it('reads a placeholder-only input', () => {
    const ev = evidenceAt('<input placeholder="Mobile number">', 'input');
    expect(ev).toEqual([{ source: 'placeholder', text: 'Mobile number', weight: 0.7 }]);
  });

  it('reads the title attribute', () => {
    const ev = evidenceAt('<input title="Date of birth">', 'input');
    expect(texts(ev, 'title-attr')).toEqual(['Date of birth']);
    expect(weightOf(ev, 'title-attr')).toBe(0.6);
  });

  it('splits name on underscores / hyphens / dots / brackets', () => {
    expect(texts(evidenceAt('<input name="linkedin_url">', 'input'), 'name-id')).toEqual(['linkedin url']);
    expect(texts(evidenceAt('<input name="user[contact].phone-number">', 'input'), 'name-id')).toEqual([
      'user contact phone number',
    ]);
  });

  it('splits camelCase ids and weights name-id at 0.5', () => {
    const ev = evidenceAt('<input id="githubProfile">', 'input');
    expect(texts(ev, 'name-id')).toEqual(['github profile']);
    expect(weightOf(ev, 'name-id')).toBe(0.5);
  });

  it('drops pure numbers and generated ids from name/id', () => {
    expect(texts(evidenceAt('<input name="education_0_school">', 'input'), 'name-id')).toEqual(['education school']);
    expect(evidenceAt('<input id="123456">', 'input')).toEqual([]);
    expect(evidenceAt('<input id="3f2b8c1e-9d4a-4c6b-8e1f-0a1b2c3d4e5f">', 'input')).toEqual([]);
    expect(evidenceAt('<input id=":r1:">', 'input')).toEqual([]);
    expect(evidenceAt('<input id="rc_select_4">', 'input')).toEqual([]);
  });

  it('collects the legend of a fieldset that owns only this control', () => {
    const ev = evidenceAt('<fieldset><legend>About you</legend><textarea name="t"></textarea></fieldset>', 'textarea');
    expect(texts(ev, 'legend')).toEqual(['About you']);
    expect(weightOf(ev, 'legend')).toBe(0.8);
  });

  it('ignores the legend of a fieldset that groups several controls', () => {
    const ev = evidenceAt(
      '<fieldset><legend>Address</legend><label for="s">Street</label><input id="s"><input id="p" name="postcode"></fieldset>',
      '#s',
    );
    expect(texts(ev, 'legend')).toEqual([]);
  });

  it('uses the fieldset legend for a radio group and never the option labels', () => {
    const ev = evidenceAt(
      `<fieldset><legend>Will you require sponsorship?</legend>
        <label><input type="radio" name="sponsorship" value="yes"> Yes</label>
        <label><input type="radio" name="sponsorship" value="no"> No</label></fieldset>`,
      'input[type=radio]',
    );
    expect(texts(ev, 'legend')).toEqual(['Will you require sponsorship?']);
    expect(texts(ev, 'label-wrap')).toEqual([]);
    expect(texts(ev, 'label-for')).toEqual([]);
    expect(texts(ev, 'name-id')).toEqual(['sponsorship']);
  });

  it('uses the wrapping label of a single checkbox', () => {
    const ev = evidenceAt('<label><input type="checkbox" name="privacy"> I agree to the privacy policy</label>', 'input');
    expect(texts(ev, 'label-wrap')).toEqual(['I agree to the privacy policy']);
  });

  it('reads aria-label of a contenteditable textbox', () => {
    const ev = evidenceAt('<div contenteditable="true" role="textbox" aria-label="Tell us about yourself"></div>', '[role=textbox]');
    expect(texts(ev, 'aria-label')).toEqual(['Tell us about yourself']);
  });
});

describe('table headers', () => {
  const table = `
    <table><thead><tr><th></th><th>Institution</th><th>Degree</th><th colspan="2">Dates</th></tr></thead>
    <tbody>
      <tr><th scope="row">Entry one</th><td><input id="a"></td><td><select id="b"><option>x</option></select></td><td><input id="c"></td><td><input id="d"></td></tr>
    </tbody></table>`;

  it('uses the column header from thead', () => {
    const controls = scan(table);
    expect(texts(collectEvidence(controlAt(controls, '#a')), 'table-header')).toContain('Institution');
    expect(texts(collectEvidence(controlAt(controls, '#b')), 'table-header')).toContain('Degree');
  });

  it('honours colspan when mapping columns', () => {
    const controls = scan(table);
    expect(texts(collectEvidence(controlAt(controls, '#c')), 'table-header')).toContain('Dates');
    expect(texts(collectEvidence(controlAt(controls, '#d')), 'table-header')).toContain('Dates');
  });

  it('adds the row header with the same weight', () => {
    const ev = collectEvidence(controlAt(scan(table), '#a'));
    expect(texts(ev, 'table-header')).toEqual(['Institution', 'Entry one']);
    expect(weightOf(ev, 'table-header')).toBe(0.85);
  });

  it('falls back to the first row when there is no thead', () => {
    const ev = evidenceAt(
      '<table><tr><td>School</td><td>Major</td></tr><tr><td><input id="x"></td><td><input id="y"></td></tr></table>',
      '#y',
    );
    expect(texts(ev, 'table-header')).toEqual(['Major']);
  });

  it('does not take a data row as the header row', () => {
    const ev = evidenceAt('<table><tr><td><input id="x"></td><td><input id="y"></td></tr></table>', '#y');
    expect(texts(ev, 'table-header')).toEqual([]);
  });
});

describe('nearby text', () => {
  it('takes the previous sibling text block', () => {
    const ev = evidenceAt('<div><span id="s">Suburb/City</span><input name="q1"></div>', 'input');
    expect(texts(ev, 'nearby-text')).toEqual(['Suburb/City']);
    expect(weightOf(ev, 'nearby-text')).toBe(0.8);
  });

  it('takes a bare preceding text node', () => {
    const ev = evidenceAt('<div>Email: <input name="q1"></div>', 'input');
    expect(texts(ev, 'nearby-text')).toEqual(['Email']);
  });

  it('walks up ancestors, e.g. label in the previous table cell', () => {
    const ev = evidenceAt('<table><tr><td>Company</td><td><div><input id="x"></div></td></tr></table>', '#x');
    expect(texts(ev, 'nearby-text')).toEqual(['Company']);
  });

  it('skips text longer than 40 characters', () => {
    const ev = evidenceAt(`<div><p>${'long '.repeat(12)}</p><span>Nickname</span><input id="x"></div>`, '#x');
    expect(texts(ev, 'nearby-text')).toEqual(['Nickname']);
  });

  it('stops at the previous control instead of borrowing its label', () => {
    const controls = scan('<div><span>First</span><input id="a"><input id="b"></div>');
    expect(texts(collectEvidence(controlAt(controls, '#b')), 'nearby-text')).toEqual([]);
  });

  it('does not climb into an ancestor that holds another control', () => {
    const controls = scan('<div><span>Outer</span><div><input id="a"></div><div><input id="b"></div></div>');
    expect(texts(collectEvidence(controlAt(controls, '#b')), 'nearby-text')).toEqual([]);
  });

  it('never uses headings or buttons as nearby text', () => {
    const ev = evidenceAt('<div><h3>Employment 1</h3><button type="button">+ Add</button><input id="x"></div>', '#x');
    expect(texts(ev, 'nearby-text')).toEqual([]);
  });

  it('takes the question that opens a block of its own, past a note under it (Breezy)', () => {
    const ev = evidenceAt(
      '<div><h3><span>Thanks! What about your last name?</span><span>*</span></h3><div><p>We use it on your contract.</p></div><input id="x"></div>',
      '#x',
    );
    expect(texts(ev, 'nearby-text')).toEqual(['Thanks! What about your last name?']);
  });

  it('never uses a card header block as nearby text', () => {
    const ev = evidenceAt(
      '<div class="ant-card"><div class="ant-card-head"><div class="ant-card-head-title">基本信息</div></div><div class="ant-card-body"><input id="x"></div></div>',
      '#x',
    );
    expect(texts(ev, 'nearby-text')).toEqual([]);
  });
});

describe('questions as application forms write them', () => {
  const LONG = 'Do you have full legal working rights within Australia or New Zealand and do not require further visa sponsorship now or in the future?';

  it('keeps a long question when it is the label of the control', () => {
    const ev = evidenceAt(`<label for="q">${LONG}<span>*</span></label><input id="q">`, '#q');
    expect(texts(ev, 'label-for')).toEqual([LONG]);
  });

  it('still drops a paragraph posing as a label', () => {
    const ev = evidenceAt(`<label for="q">${LONG.repeat(3)}</label><input id="q">`, '#q');
    expect(texts(ev, 'label-for')).toEqual([]);
  });

  it('reads a one-line question above a control as its label', () => {
    const ev = evidenceAt(
      '<div><div class="q"><div>What are your current work rights in Australia?<span>✱</span></div></div><div><div><select id="q"><option>Yes</option></select></div></div></div>',
      '#q',
    );
    expect(texts(ev, 'nearby-text')).toEqual(['What are your current work rights in Australia?']);
  });

  it('takes a wrapping label up to the control, not the messages after it', () => {
    const ev = evidenceAt(
      '<label><div>Current location <span>✱</span></div><div><input id="q"><div>No location found. Try another</div></div></label>',
      '#q',
    );
    expect(texts(ev, 'label-wrap')).toEqual(['Current location']);
  });

  it('keeps consent wording that follows the control, so the field stays untouched', () => {
    const ev = evidenceAt('<label>Willing to relocate <input id="q" type="checkbox"> I agree to the terms and conditions</label>', '#q');
    expect(texts(ev, 'label-wrap')[0]).toContain('I agree to the terms and conditions');
  });

  it('keeps a wrapping label whose text follows the control', () => {
    const ev = evidenceAt('<label><input id="q" type="text"> Nickname</label>', '#q');
    expect(texts(ev, 'label-wrap')).toEqual(['Nickname']);
  });
});

describe('cleaning and ordering', () => {
  it('trims, collapses whitespace and strips trailing colons / asterisks', () => {
    expect(cleanEvidenceText('  Full\n  name :  ')).toBe('Full name');
    expect(cleanEvidenceText('姓名：')).toBe('姓名');
    expect(cleanEvidenceText('* 邮箱 *')).toBe('邮箱');
    expect(cleanEvidenceText('Email *:')).toBe('Email');
  });

  it('drops empty and over-long text', () => {
    expect(cleanEvidenceText('  *  ')).toBe('');
    expect(cleanEvidenceText('x'.repeat(81))).toBe('');
    expect(cleanEvidenceText('x'.repeat(80))).toHaveLength(80);
  });

  it('applies cleaning to collected labels', () => {
    const ev = evidenceAt('<label for="a">Email address *:</label><input id="a">', '#a');
    expect(texts(ev, 'label-for')).toEqual(['Email address']);
  });

  it('de-duplicates by normalized text keeping the heaviest source and sorts by weight', () => {
    const ev = evidenceAt(
      '<div><label for="a">Email</label><input id="a" name="email" placeholder="EMAIL" aria-label="email:" title="Work address"></div>',
      '#a',
    );
    expect(ev.map((e) => e.source)).toEqual(['label-for', 'title-attr']);
    expect(ev.map((e) => e.weight)).toEqual([1, 0.6]);
    expect(ev[0]!.text).toBe('Email');
    expect(ev.map((e) => e.weight)).toEqual([...ev.map((e) => e.weight)].sort((a, b) => b - a));
  });

  it('drops boilerplate placeholders that normalise to nothing', () => {
    const ev = evidenceAt('<input placeholder="请输入">', 'input');
    expect(ev).toEqual([]);
  });
});

describe('required flag', () => {
  const required = (html: string, selector: string) => collectRequired(controlAt(scan(html), selector));

  it('is false by default', () => {
    expect(required('<label for="a">Name</label><input id="a">', '#a')).toBe(false);
  });

  it('reads the required attribute and aria-required', () => {
    expect(required('<input id="a" required>', '#a')).toBe(true);
    expect(required('<input id="a" aria-required="true">', '#a')).toBe(true);
    expect(required('<input id="a" aria-required="false">', '#a')).toBe(false);
  });

  it('reads an asterisk in the label', () => {
    expect(required('<label for="a">Name <span>*</span></label><input id="a">', '#a')).toBe(true);
    expect(required('<label>Name* <input id="a"></label>', '#a')).toBe(true);
  });

  it('reads antd .ant-form-item-required and Element .is-required', () => {
    const antd = `<div class="ant-form-item"><div class="ant-col ant-form-item-label"><label for="n" class="ant-form-item-required">姓名</label></div>
      <div class="ant-form-item-control"><input id="n" class="ant-input"></div></div>`;
    expect(required(antd, '#n')).toBe(true);
    const el = `<div class="el-form-item is-required"><label class="el-form-item__label" for="n">姓名</label><div class="el-form-item__content"><input id="n"></div></div>`;
    expect(required(el, '#n')).toBe(true);
  });

  it('is true when any radio of a group is required', () => {
    expect(
      required('<input type="radio" name="g" required><input type="radio" name="g">', 'input[type=radio]'),
    ).toBe(true);
  });
});

describe('antd v5 markup', () => {
  const item = (label: string | null, inner: string, required = false) => `
    <div class="ant-form-item"><div class="ant-row ant-form-item-row">
      ${label === null ? '' : `<div class="ant-col ant-form-item-label"><label ${required ? 'class="ant-form-item-required"' : ''} for="__ID__" title="${label}">${label}</label></div>`}
      <div class="ant-col ant-form-item-control"><div class="ant-form-item-control-input"><div class="ant-form-item-control-input-content">${inner}</div></div></div>
    </div></div>`;
  const select = (id: string, placeholder: string) => `
    <div class="ant-select ant-select-single"><div class="ant-select-selector">
      <span class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" role="combobox" type="search" autocomplete="off"></span>
      <span class="ant-select-selection-placeholder">${placeholder}</span></div></div>`;

  it('resolves label[for] that points at the inner input of a Select', () => {
    const html = item('学校名称', select('education_0_school', '请选择')).replace('__ID__', 'education_0_school');
    const ev = evidenceAt(html, '.ant-select');
    expect(texts(ev, 'label-for')).toEqual(['学校名称']);
    expect(texts(ev, 'name-id')).toEqual(['education school']);
    // "请选择" is pure boilerplate and must not survive.
    expect(texts(ev, 'placeholder')).toEqual([]);
  });

  it('keeps a meaningful antd placeholder', () => {
    const html = select('rc_select_9', '区号');
    expect(texts(evidenceAt(html, '.ant-select'), 'placeholder')).toEqual(['区号']);
  });

  it('reads the placeholder of a DatePicker input', () => {
    const html = `<div class="ant-picker"><div class="ant-picker-input"><input id="birth" placeholder="选择日期" size="12" autocomplete="off"></div></div>`;
    const ev = evidenceAt(html, '.ant-picker');
    expect(texts(ev, 'placeholder')).toEqual(['选择日期']);
  });

  it('marks the form-item label as required via the label class', () => {
    const html = item('专业', '<input id="major" class="ant-input">', true).replace('__ID__', 'major');
    expect(collectRequired(controlAt(scan(html), '#major'))).toBe(true);
  });

  it('gives the Checkbox 至今 only its wrapping label', () => {
    const html = item(
      null,
      `<label class="ant-checkbox-wrapper"><span class="ant-checkbox"><input type="checkbox" class="ant-checkbox-input" id="internship_0_current"></span><span>至今</span></label>`,
    );
    const ev = evidenceAt(html, 'input[type=checkbox]');
    expect(texts(ev, 'label-wrap')).toEqual(['至今']);
    expect(texts(ev, 'label-for')).toEqual([]);
  });

  it('resolves label[for] pointing at the id of an antd Radio.Group', () => {
    const html = item(
      '性别',
      `<div class="ant-radio-group" id="gender"><label class="ant-radio-wrapper"><span class="ant-radio"><input type="radio" class="ant-radio-input" value="男"></span><span>男</span></label>
       <label class="ant-radio-wrapper"><span class="ant-radio"><input type="radio" class="ant-radio-input" value="女"></span><span>女</span></label></div>`,
    ).replace('__ID__', 'gender');
    const ev = evidenceAt(html, '.ant-radio-group');
    expect(texts(ev, 'label-for')).toEqual(['性别']);
    expect(texts(ev, 'label-wrap')).toEqual([]);
  });

  it('gives the phone country-code Select the form-item label at a lower weight', () => {
    const html = item(
      '手机号码',
      `<span class="ant-input-group-wrapper"><span class="ant-input-wrapper ant-input-group">
         <span class="ant-input-group-addon">${select('phoneCountryCode', '区号')}</span>
         <input id="phone" class="ant-input" placeholder="请输入手机号码"></span></span>`,
    ).replace('__ID__', 'phone');
    const controls = scan(html);
    const code = collectEvidence(controlAt(controls, '.ant-select'));
    const phone = collectEvidence(controlAt(controls, '#phone'));

    expect(texts(phone, 'label-for')).toEqual(['手机号码']);
    expect(weightOf(phone, 'label-for')).toBe(1);

    expect(texts(code, 'label-for')).toEqual([]);
    const structural = code.find((e) => e.text === '手机号码');
    expect(structural).toBeDefined();
    expect(structural!.source).toBe('nearby-text');
    expect(structural!.weight).toBeLessThan(0.8);
    expect(texts(code, 'placeholder')).toEqual(['区号']);
    // The country-code placeholder outranks the shared form-item label.
    expect(code.findIndex((e) => e.text === '区号')).toBeLessThan(code.findIndex((e) => e.text === '手机号码'));
  });

  it('counts a form-item label without a matching for as label-for when the item has one control', () => {
    const html = item('邮箱', '<input id="x" class="ant-input">').replace('__ID__', 'something-else');
    expect(texts(evidenceAt(html, '#x'), 'label-for')).toEqual(['邮箱']);
  });
});

describe('Element Plus markup', () => {
  it('reads .el-form-item__label and the el-select placeholder', () => {
    const html = `
      <div class="el-form-item is-required"><label class="el-form-item__label" for="el-id-1-5" style="width:100px">学历</label>
        <div class="el-form-item__content"><div class="el-select"><div class="el-select__wrapper">
          <div class="el-select__selection"><div class="el-select__selected-item el-select__placeholder is-transparent"><span>请选择</span></div>
          <div class="el-select__selected-item el-select__input-wrapper"><input class="el-select__input" id="el-id-1-5" role="combobox"></div></div></div></div></div></div>`;
    const ev = evidenceAt(html, '.el-select');
    expect(texts(ev, 'label-for')).toEqual(['学历']);
    expect(ev.some((e) => e.source === 'name-id')).toBe(false);
    expect(collectRequired(controlAt(scan(html), '.el-select'))).toBe(true);
  });

  it('reads a meaningful el-select placeholder', () => {
    const html = `<div class="el-select"><div class="el-select__wrapper"><div class="el-select__selected-item el-select__placeholder is-transparent"><span>所在城市</span></div><input class="el-select__input"></div></div>`;
    expect(texts(evidenceAt(html, '.el-select'), 'placeholder')).toEqual(['所在城市']);
  });

  it('reads the inner input placeholder of an el-date-editor', () => {
    const html = `<div class="el-date-editor el-date-editor--month"><div class="el-input__wrapper"><input class="el-input__inner" placeholder="开始月份"></div></div>`;
    expect(texts(evidenceAt(html, '.el-date-editor'), 'placeholder')).toEqual(['开始月份']);
  });

  it('reads the header cell for an el-input inside a plain table', () => {
    const html = `<table><thead><tr><th>学校</th><th>专业</th></tr></thead>
      <tbody><tr><td><div class="el-input"><div class="el-input__wrapper"><input class="el-input__inner"></div></div></td>
      <td><div class="el-input"><div class="el-input__wrapper"><input class="el-input__inner" id="m"></div></div></td></tr></tbody></table>`;
    expect(texts(evidenceAt(html, '#m'), 'table-header')).toEqual(['专业']);
  });
});

describe('Feishu formily markup on a phone', () => {
  it('reads the row label of a formily-m-item as the label of its one box', () => {
    const html = `
      <div class="formily-m-item formily-m-item-vertical" data-form-field-id="7211"><div class="formily-m-item-label">
        <div class="formily-m-item-label-content"><span class="formily-m-item-asterisk">*</span><span>预计入职时间</span></div></div>
        <div class="formily-m-item-control"><div class="formily-m-item-control-content"><input class="ud__native-input" placeholder="请输入"></div></div></div>`;
    expect(texts(evidenceAt(html, 'input'), 'label-for')).toEqual(['预计入职时间']);
  });
});

describe('option-like wrapped labels (single checkbox)', () => {
  const epItem = (label: string, wrap: string) =>
    `<div class="el-form-item" role="group" aria-labelledby="el-id-1-1"><div id="el-id-1-1" class="el-form-item__label">${label}</div>` +
    `<div class="el-form-item__content"><label class="el-checkbox"><span class="el-checkbox__input"><input class="el-checkbox__original" type="checkbox"></span>` +
    `<span class="el-checkbox__label">${wrap}</span></label></div></div>`;

  it.each(['是', '否', 'Yes', 'No', '接受'])('ranks the form-item label above the wrapped option "%s"', (wrap) => {
    const ev = evidenceAt(epItem('是否接受外派', wrap), 'input');
    expect(ev[0]?.text).toBe('是否接受外派');
    expect(ev.map((e) => e.text)).toContain(wrap);
  });

  it('keeps a descriptive wrapped label as the best evidence', () => {
    const ev = evidenceAt(epItem('其他', '我愿意接受外派'), 'input');
    expect(ev[0]?.text).toBe('我愿意接受外派');
  });

  it('keeps "Yes" when it is the only evidence', () => {
    const ev = evidenceAt('<label><input type="checkbox"> Yes</label>', 'input');
    expect(ev[0]?.text).toBe('Yes');
  });
});

describe('dial-code selects keep their country-code evidence after being filled', () => {
  const antdPhone = (shown: string) =>
    `<div class="ant-form-item"><div class="ant-form-item-label"><label for="phone">手机号码</label></div>` +
    `<div class="ant-input-group-wrapper"><div class="ant-input-wrapper ant-input-group"><span class="ant-input-group-addon">` +
    `<div class="ant-select"><div class="ant-select-selector"><span class="ant-select-selection-search"><input id="cc" class="ant-select-selection-search-input" role="combobox"></span>` +
    `${shown}</div></div></span><input id="phone" class="ant-input"></div></div></div>`;

  it('adds 区号 when the select shows +86 and the placeholder is gone', () => {
    const ev = evidenceAt(antdPhone('<span class="ant-select-selection-item" title="+86">+86</span>'), '.ant-select');
    expect(ev.map((e) => e.text)).toContain('区号');
  });

  it('adds Country code for a Latin-only form', () => {
    const html = `<label for="cc">Mobile</label><select id="cc"><option value="">Select</option><option selected>+61 Australia</option></select>`;
    expect(evidenceAt(html, '#cc').map((e) => e.text)).toContain('Country code');
  });

  it('adds nothing for an empty or ordinary select', () => {
    const ev = evidenceAt(antdPhone('<span class="ant-select-selection-placeholder">区号</span>'), '.ant-select');
    expect(ev.filter((e) => e.text === '区号')).toHaveLength(1);
    const plain = evidenceAt('<label for="s">State</label><select id="s"><option selected>QLD</option></select>', '#s');
    expect(plain.map((e) => e.text)).toEqual(['State']);
  });
});
