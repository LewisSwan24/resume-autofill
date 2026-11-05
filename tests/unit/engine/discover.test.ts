import { afterEach, describe, expect, it } from 'vitest';
import { discover, groupInputs } from '../../../src/engine/discover';
import { isVisible, setVisibilityProbe } from '../../../src/engine/visibility';
import type { Control } from '../../../src/engine/types';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function scan(html: string): Control[] {
  mount(html);
  return discover(document);
}

afterEach(() => {
  document.body.innerHTML = '';
  setVisibilityProbe(null);
});

describe('custom controls found without taking others down', () => {
  it('pressable buttons beside other fields do not hide those fields', () => {
    const controls = scan(`<form>
      <label>Email<input name="email"></label>
      <label>Phone<input name="phone"></label>
      <button aria-pressed="false">Yes</button><button aria-pressed="false">No</button>
      <textarea name="note"></textarea>
    </form>`);
    expect(controls.map((c) => c.kind)).toEqual(['text', 'text', 'textarea']);
  });

  it('only Yes and No count as answer buttons', () => {
    const controls = scan('<div><button aria-pressed="false">B</button><button aria-pressed="false">I</button></div>');
    expect(controls).toEqual([]);
  });

  it('a hidden checkbox behind the buttons belongs to them', () => {
    const controls = scan('<div><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button><input type="checkbox" name="q" style="display:none"></div>');
    expect(controls.map((c) => [c.kind, c.lib])).toEqual([['radio', 'aria']]);
  });

  it.each(['nav', 'header', 'footer'])('a language switcher in a %s is not a field', (tag) => {
    const controls = scan(`<${tag}><button aria-haspopup="listbox" aria-label="Language">English</button></${tag}>`);
    expect(controls).toEqual([]);
  });

  it('a combobox in a form inside a page header still is', () => {
    const controls = scan('<header><form><input role="combobox" aria-label="City"></form></header>');
    expect(controls.map((c) => c.lib)).toEqual(['aria']);
  });
});

describe('visibility', () => {
  it('treats hidden attribute, display:none ancestors and visibility:hidden as invisible', () => {
    const host = mount(`
      <input id="a">
      <input id="b" hidden>
      <div style="display:none"><input id="c"></div>
      <input id="d" style="visibility:hidden">
      <div style="visibility:hidden"><input id="e" style="visibility:visible"></div>`);
    const vis = (id: string) => isVisible(host.querySelector('#' + id)!);
    expect(vis('a')).toBe(true);
    expect(vis('b')).toBe(false);
    expect(vis('c')).toBe(false);
    expect(vis('d')).toBe(false);
    expect(vis('e')).toBe(true);
  });

  it('lets a test override the probe', () => {
    const host = mount('<input id="a">');
    setVisibilityProbe(() => false);
    expect(isVisible(host.querySelector('#a')!)).toBe(false);
    expect(discover(document)).toEqual([]);
  });
});

describe('discover: native controls', () => {
  it('finds the native set with kinds, input types and document-order ids', () => {
    const controls = scan(`
      <input type="text" name="name">
      <input type="email" name="email">
      <input name="plain">
      <input type="tel" name="phone">
      <input type="date" name="dob">
      <input type="month" name="start">
      <input type="file" name="cv">
      <textarea name="intro"></textarea>
      <select name="degree"><option value="">请选择</option><option value="bsc">Bachelor</option><option value="msc" disabled>Master</option></select>
      <div id="rt" contenteditable="true"></div>
      <div id="rt2" role="textbox" contenteditable=""></div>`);
    expect(controls.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11']);
    expect(controls.map((c) => [c.kind, c.inputType ?? null, c.lib])).toEqual([
      ['text', 'text', 'native'],
      ['text', 'email', 'native'],
      ['text', 'text', 'native'],
      ['text', 'tel', 'native'],
      ['date', 'date', 'native'],
      ['date', 'month', 'native'],
      ['file', 'file', 'native'],
      ['textarea', null, 'native'],
      ['select', null, 'native'],
      ['richtext', null, 'native'],
      ['richtext', null, 'native'],
    ]);
    expect(controls[4]!.dateGranularity).toBe('day');
    expect(controls[5]!.dateGranularity).toBe('month');
    const select = controls[8]!;
    expect(select.multiple).toBe(false);
    expect(select.options).toEqual([
      { label: '请选择', value: '', disabled: false },
      { label: 'Bachelor', value: 'bsc', disabled: false },
      { label: 'Master', value: 'msc', disabled: true },
    ]);
  });

  it('excludes hidden, submit, button, reset and image inputs', () => {
    const controls = scan(`
      <input type="hidden" name="csrf"><input type="submit"><input type="button"><input type="reset">
      <input type="image" src="x.png"><button>Go</button><input type="text" name="kept">`);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.el.getAttribute('name')).toBe('kept');
  });

  it('flags multiple selects', () => {
    const [c] = scan('<select multiple><option>a</option><option>b</option></select>');
    expect(c!.multiple).toBe(true);
  });

  it('skips disabled controls (attribute, aria-disabled, disabled fieldset)', () => {
    const controls = scan(`
      <input name="a" disabled>
      <input name="b" aria-disabled="true">
      <fieldset disabled><input name="c"></fieldset>
      <select name="d" disabled><option>x</option></select>
      <textarea name="e" disabled></textarea>
      <input name="ok">`);
    expect(controls.map((c) => c.el.getAttribute('name'))).toEqual(['ok']);
  });

  it('skips hidden controls', () => {
    const controls = scan(`
      <input name="a" hidden>
      <div style="display:none"><input name="b"><textarea name="c"></textarea></div>
      <div hidden><select name="d"><option>x</option></select></div>
      <input name="ok">`);
    expect(controls.map((c) => c.el.getAttribute('name'))).toEqual(['ok']);
  });

  it('does not report contenteditable="false" or nested contenteditable twice', () => {
    const controls = scan(`
      <div contenteditable="false">x</div>
      <div id="outer" contenteditable="true"><p contenteditable="true">inner</p></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.el.id).toBe('outer');
  });

  it('keeps file inputs hidden behind a visible upload container', () => {
    const controls = scan(`
      <label class="upload">Upload <input type="file" name="cv" style="display:none"></label>
      <div style="display:none"><label>Hidden <input type="file" name="x"></label></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.kind).toBe('file');
    expect(controls[0]!.el.getAttribute('name')).toBe('cv');
  });
});

describe('discover: radios and checkboxes', () => {
  it('groups radios by name into one control with options from labels', () => {
    const controls = scan(`
      <div id="g"><label><input type="radio" name="gender" value="m"> Male</label>
      <input type="radio" name="gender" value="f" id="f"><label for="f">Female</label>
      <label><input type="radio" name="gender" value="o" disabled> Other</label></div>
      <input type="text" name="after">`);
    expect(controls).toHaveLength(2);
    const radio = controls[0]!;
    expect(radio.kind).toBe('radio');
    expect(radio.lib).toBe('native');
    expect(radio.el.id).toBe('g'); // lowest common ancestor of the members
    expect(radio.options).toEqual([
      { label: 'Male', value: 'm', disabled: false },
      { label: 'Female', value: 'f', disabled: false },
      { label: 'Other', value: 'o', disabled: true },
    ]);
    expect(groupInputs(radio).map((i) => i.value)).toEqual(['m', 'f', 'o']);
    expect(controls[1]!.kind).toBe('text');
  });

  it('keeps two radio groups with different names apart', () => {
    const controls = scan(`
      <input type="radio" name="a" value="1" aria-label="A1"><input type="radio" name="a" value="2" aria-label="A2">
      <input type="radio" name="b" value="1" aria-label="B1"><input type="radio" name="b" value="2" aria-label="B2">`);
    expect(controls).toHaveLength(2);
    expect(controls.map((c) => groupInputs(c).map((i) => i.name + i.value))).toEqual([['a1', 'a2'], ['b1', 'b2']]);
  });

  it('groups nameless radios inside a role=radiogroup', () => {
    const controls = scan(`
      <div role="radiogroup" id="rg"><label><input type="radio" value="y"> Yes</label><label><input type="radio" value="n"> No</label></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.el.id).toBe('rg');
    expect(controls[0]!.options?.map((o) => o.label)).toEqual(['Yes', 'No']);
  });

  it('turns checkboxes sharing a name into one multiple control; a lone checkbox stays single', () => {
    const controls = scan(`
      <label><input type="checkbox" name="skill" value="js"> JS</label>
      <label><input type="checkbox" name="skill" value="ts"> TS</label>
      <label><input type="checkbox" name="agree" value="1"> I agree</label>`);
    expect(controls).toHaveLength(2);
    const group = controls[0]!;
    expect(group.kind).toBe('checkbox');
    expect(group.multiple).toBe(true);
    expect(group.options).toEqual([
      { label: 'JS', value: 'js', disabled: false },
      { label: 'TS', value: 'ts', disabled: false },
    ]);
    const single = controls[1]!;
    expect(single.kind).toBe('checkbox');
    expect(single.options).toBeUndefined();
    expect(single.multiple).toBeUndefined();
    expect(single.el.tagName).toBe('INPUT');
  });

  it('skips a radio group whose members are all disabled', () => {
    const controls = scan(`
      <input type="radio" name="a" value="1" disabled><input type="radio" name="a" value="2" disabled>`);
    expect(controls).toEqual([]);
  });

  it('finds radios whose input is hidden behind a visible label', () => {
    const controls = scan(`
      <label><input type="radio" name="a" value="1" style="display:none"> One</label>
      <label><input type="radio" name="a" value="2" style="display:none"> Two</label>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.options?.map((o) => o.label)).toEqual(['One', 'Two']);
  });
});

describe('discover: shadow DOM and ids', () => {
  it('descends into open shadow roots in document order and ignores closed ones', () => {
    const host = mount('<input name="before"><div id="host"></div><input name="after"><div id="closed"></div>');
    const open = host.querySelector('#host')!.attachShadow({ mode: 'open' });
    open.innerHTML = '<input name="inside"><div id="nested"></div>';
    open.querySelector('#nested')!.attachShadow({ mode: 'open' }).innerHTML = '<textarea name="deep"></textarea>';
    host.querySelector('#closed')!.attachShadow({ mode: 'closed' }).innerHTML = '<input name="secret">';
    const names = discover(document).map((c) => c.el.getAttribute('name'));
    expect(names).toEqual(['before', 'inside', 'deep', 'after']);
  });

  it('accepts a ShadowRoot as the scan root', () => {
    const host = mount('<div id="h"></div><input name="outside">');
    const sr = host.querySelector('#h')!.attachShadow({ mode: 'open' });
    sr.innerHTML = '<input name="inside">';
    expect(discover(sr).map((c) => c.el.getAttribute('name'))).toEqual(['inside']);
  });

  it('uses idFor to keep ids stable across rescans', () => {
    mount('<input name="a"><input name="b">');
    const ids = new WeakMap<Element, string>();
    let n = 100;
    const idFor = (el: Element) => {
      if (!ids.has(el)) ids.set(el, `c${++n}`);
      return ids.get(el)!;
    };
    const first = discover(document, { idFor }).map((c) => c.id);
    const second = discover(document, { idFor }).map((c) => c.id);
    expect(first).toEqual(['c101', 'c102']);
    expect(second).toEqual(first);
  });
});

describe('discover: antd v5 widgets', () => {
  const antdSelect = `
    <div class="ant-select ant-select-single ant-select-show-arrow ant-select-show-search" id="sel">
      <div class="ant-select-selector">
        <span class="ant-select-selection-search"><input type="search" role="combobox" class="ant-select-selection-search-input" aria-haspopup="listbox" autocomplete="off" id="degree" value=""></span>
        <span class="ant-select-selection-item" title="本科">本科</span>
      </div>
      <span class="ant-select-arrow"><span class="anticon"></span></span>
    </div>`;

  it('reports an antd Select once (inner search input not duplicated)', () => {
    const controls = scan(antdSelect);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'select', lib: 'antd' });
    expect(controls[0]!.el.id).toBe('sel');
    expect(controls[0]!.multiple).toBeFalsy();
  });

  it('flags antd multiple Select', () => {
    const [c] = scan(`<div class="ant-select ant-select-multiple"><div class="ant-select-selector"><span class="ant-select-selection-search"><input class="ant-select-selection-search-input"></span></div></div>`);
    expect(c).toMatchObject({ kind: 'select', lib: 'antd', multiple: true });
  });

  it('treats antd Cascader (.ant-select.ant-cascader) as a cascader, not a select', () => {
    const controls = scan(`
      <div class="ant-select ant-cascader ant-select-single"><div class="ant-select-selector">
        <span class="ant-select-selection-search"><input class="ant-select-selection-search-input" role="combobox"></span>
        <span class="ant-select-selection-placeholder">请选择</span></div></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'cascader', lib: 'antd' });
  });

  it('antd DatePicker: kind date, inner input not duplicated, granularity from placeholder', () => {
    const picker = (ph: string, extra = '') =>
      `<div class="ant-picker ${extra}"><div class="ant-picker-input"><input readonly placeholder="${ph}" title="" size="12" value=""><span class="ant-picker-suffix"></span></div></div>`;
    const controls = scan(picker('请选择日期') + picker('请选择月份') + picker('Select month') + picker('请选择年份') + picker('Select date'));
    expect(controls).toHaveLength(5);
    expect(controls.every((c) => c.kind === 'date' && c.lib === 'antd')).toBe(true);
    expect(controls.map((c) => c.dateGranularity)).toEqual(['day', 'month', 'month', 'year', 'day']);
  });

  it('antd DatePicker granularity: data-granularity override and input size fallback', () => {
    const controls = scan(`
      <div class="ant-picker" data-granularity="month"><div class="ant-picker-input"><input placeholder="选择"></div></div>
      <div class="ant-picker"><div class="ant-picker-input"><input placeholder="选择" size="7"></div></div>`);
    expect(controls.map((c) => c.dateGranularity)).toEqual(['month', 'month']);
  });

  it('antd range picker is one field, with both its inputs inside', () => {
    const controls = scan(`
      <div class="ant-picker ant-picker-range"><div class="ant-picker-input"><input placeholder="开始日期"></div>
      <div class="ant-picker-range-separator"></div><div class="ant-picker-input"><input placeholder="结束日期"></div></div>`);
    expect(controls.map((c) => [c.kind, c.lib, c.dateRange])).toEqual([['date', 'antd', true]]);
  });

  it('antd plain Input is a native text control', () => {
    const controls = scan('<span class="ant-input-affix-wrapper"><input class="ant-input" id="x" type="text"></span><textarea class="ant-input"></textarea>');
    expect(controls.map((c) => [c.kind, c.lib])).toEqual([['text', 'native'], ['textarea', 'native']]);
  });

  it('phone input with addonBefore Select: Select is its own widget, inner input is native text', () => {
    const controls = scan(`
      <span class="ant-input-group-wrapper"><span class="ant-input-wrapper ant-input-group">
        <span class="ant-input-group-addon">${antdSelect}</span>
        <input class="ant-input" id="phone" type="text">
      </span></span>`);
    expect(controls.map((c) => [c.kind, c.lib])).toEqual([['select', 'antd'], ['text', 'native']]);
    expect(controls[1]!.el.id).toBe('phone');
  });

  it('antd Radio.Group and Checkbox.Group are library radio / checkbox controls with options', () => {
    const controls = scan(`
      <div class="ant-radio-group" id="rg">
        <label class="ant-radio-wrapper"><span class="ant-radio"><input class="ant-radio-input" type="radio" value="m"><span class="ant-radio-inner"></span></span><span>男</span></label>
        <label class="ant-radio-wrapper"><span class="ant-radio"><input class="ant-radio-input" type="radio" value="f"><span class="ant-radio-inner"></span></span><span>女</span></label>
      </div>
      <div class="ant-checkbox-group" id="cg">
        <label class="ant-checkbox-wrapper"><span class="ant-checkbox"><input class="ant-checkbox-input" type="checkbox" value="a"><span class="ant-checkbox-inner"></span></span><span>篮球</span></label>
        <label class="ant-checkbox-wrapper"><span class="ant-checkbox"><input class="ant-checkbox-input" type="checkbox" value="b"><span class="ant-checkbox-inner"></span></span><span>阅读</span></label>
      </div>`);
    expect(controls).toHaveLength(2);
    expect(controls[0]).toMatchObject({ kind: 'radio', lib: 'antd' });
    expect(controls[0]!.el.id).toBe('rg');
    expect(controls[0]!.options).toEqual([
      { label: '男', value: 'm', disabled: false },
      { label: '女', value: 'f', disabled: false },
    ]);
    expect(controls[1]).toMatchObject({ kind: 'checkbox', lib: 'antd', multiple: true });
    expect(controls[1]!.options?.map((o) => o.label)).toEqual(['篮球', '阅读']);
  });

  it('antd Upload: one file control on the outermost .ant-upload', () => {
    const controls = scan(`
      <div class="ant-upload-wrapper"><div class="ant-upload ant-upload-select"><span class="ant-upload" role="button" tabindex="0"><input type="file" style="display:none"><button class="ant-btn">上传</button></span></div></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'file', lib: 'antd' });
    expect(controls[0]!.el.classList.contains('ant-upload-select')).toBe(true);
  });

  it('skips disabled antd widgets and does not leak their inputs as native', () => {
    const controls = scan(`
      <div class="ant-select ant-select-disabled"><div class="ant-select-selector"><span class="ant-select-selection-search"><input class="ant-select-selection-search-input" disabled></span></div></div>
      <div class="ant-picker ant-picker-disabled"><div class="ant-picker-input"><input disabled placeholder="请选择日期"></div></div>
      <div class="ant-radio-group"><label><input type="radio" value="1" disabled> A</label><label><input type="radio" value="2" disabled> B</label></div>
      <div class="ant-upload ant-upload-disabled"><input type="file"></div>`);
    expect(controls).toEqual([]);
  });

  it('skips hidden antd widgets', () => {
    const controls = scan(`<div style="display:none">${antdSelect}</div>`);
    expect(controls).toEqual([]);
  });

  it('ignores inputs inside teleported antd dropdown panels', () => {
    const controls = scan(`<div class="ant-select-dropdown"><input class="search"></div><div class="ant-picker-dropdown"><div class="ant-picker-panel"><input></div></div>`);
    expect(controls).toEqual([]);
  });

  it('antd AutoComplete stays a plain text control', () => {
    const controls = scan(`<div class="ant-select ant-select-auto-complete"><div class="ant-select-selector"><span class="ant-select-selection-search"><input class="ant-select-selection-search-input"></span></div></div>`);
    expect(controls.map((c) => [c.kind, c.lib])).toEqual([['text', 'native']]);
  });
});

describe('discover: Element Plus widgets', () => {
  const elSelect = `
    <div class="el-select" id="sel"><div class="el-select__wrapper el-tooltip__trigger"><div class="el-select__selection">
      <div class="el-select__selected-item el-select__placeholder is-transparent"><span>请选择</span></div>
      <div class="el-select__input-wrapper"><input type="text" class="el-select__input" role="combobox" aria-autocomplete="none" autocomplete="off"></div>
    </div><div class="el-select__suffix"><i class="el-icon"></i></div></div></div>`;

  it('reports an Element Select once', () => {
    const controls = scan(elSelect);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'select', lib: 'element' });
    expect(controls[0]!.el.id).toBe('sel');
    expect(controls[0]!.multiple).toBeFalsy();
  });

  it('flags Element multiple Select (tags present)', () => {
    const [c] = scan(`<div class="el-select"><div class="el-select__wrapper"><div class="el-select__selection"><div class="el-tag el-tag--info"><span class="el-tag__content">a</span></div><div class="el-select__input-wrapper"><input class="el-select__input"></div></div></div></div>`);
    expect(c).toMatchObject({ kind: 'select', lib: 'element', multiple: true });
  });

  it('Element Cascader is a cascader', () => {
    const controls = scan(`<div class="el-cascader"><div class="el-input el-input--default el-input--suffix"><div class="el-input__wrapper"><input class="el-input__inner" readonly placeholder="请选择" type="text"></div></div></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'cascader', lib: 'element' });
  });

  it('Element date editors: kind date, granularity from --type class, inner input not duplicated', () => {
    const editor = (type: string) =>
      `<div class="el-date-editor el-date-editor--${type} el-input el-input--default"><div class="el-input__wrapper"><input class="el-input__inner" type="text" placeholder="选择"></div></div>`;
    const controls = scan(editor('date') + editor('month') + editor('year') + editor('datetime'));
    expect(controls.every((c) => c.kind === 'date' && c.lib === 'element')).toBe(true);
    expect(controls.map((c) => c.dateGranularity)).toEqual(['day', 'month', 'year', 'day']);
  });

  it('Element ranges are one field each, and time pickers are left alone (consumed, not reported)', () => {
    const controls = scan(`
      <div class="el-date-editor el-date-editor--daterange el-range-editor el-input__wrapper"><input class="el-range-input" placeholder="开始"><span class="el-range-separator">-</span><input class="el-range-input" placeholder="结束"></div>
      <div class="el-date-editor el-date-editor--monthrange el-range-editor el-input__wrapper"><input class="el-range-input"><input class="el-range-input"></div>
      <div class="el-date-editor el-date-editor--time el-input"><div class="el-input__wrapper"><input class="el-input__inner"></div></div>`);
    expect(controls.map((c) => [c.kind, c.lib, c.dateRange, c.dateGranularity])).toEqual([['date', 'element', true, 'day'], ['date', 'element', true, 'month']]);
  });

  it('plain el-input exposes its inner native input / textarea as text', () => {
    const controls = scan(`
      <div class="el-input el-input--default"><div class="el-input__wrapper"><input class="el-input__inner" type="text" id="n"></div></div>
      <div class="el-textarea"><textarea class="el-textarea__inner"></textarea></div>`);
    expect(controls.map((c) => [c.kind, c.lib])).toEqual([['text', 'native'], ['textarea', 'native']]);
  });

  it('phone with el-select prepend: Select widget + native input', () => {
    const controls = scan(`
      <div class="el-input el-input-group el-input-group--prepend">
        <div class="el-input-group__prepend">${elSelect}</div>
        <div class="el-input__wrapper"><input class="el-input__inner" type="tel" id="phone"></div>
      </div>`);
    expect(controls.map((c) => [c.kind, c.lib])).toEqual([['select', 'element'], ['text', 'native']]);
    expect(controls[1]!.inputType).toBe('tel');
  });

  it('Element radio and checkbox groups with options', () => {
    const controls = scan(`
      <div class="el-radio-group" role="radiogroup" id="rg">
        <label class="el-radio"><span class="el-radio__input"><input class="el-radio__original" type="radio" value="m"><span class="el-radio__inner"></span></span><span class="el-radio__label">男</span></label>
        <label class="el-radio-button"><input class="el-radio-button__original-radio" type="radio" value="f"><span class="el-radio-button__inner">女</span></label>
      </div>
      <div class="el-checkbox-group" role="group">
        <label class="el-checkbox"><span class="el-checkbox__input"><input class="el-checkbox__original" type="checkbox" value="a"><span class="el-checkbox__inner"></span></span><span class="el-checkbox__label">篮球</span></label>
        <label class="el-checkbox"><span class="el-checkbox__input"><input class="el-checkbox__original" type="checkbox" value="b"><span class="el-checkbox__inner"></span></span><span class="el-checkbox__label">阅读</span></label>
      </div>`);
    expect(controls).toHaveLength(2);
    expect(controls[0]).toMatchObject({ kind: 'radio', lib: 'element' });
    expect(controls[0]!.el.id).toBe('rg');
    expect(controls[0]!.options?.map((o) => [o.label, o.value])).toEqual([['男', 'm'], ['女', 'f']]);
    expect(controls[1]).toMatchObject({ kind: 'checkbox', lib: 'element', multiple: true });
  });

  it('Element Upload: one file control, hidden file input not duplicated', () => {
    const controls = scan(`<div class="el-upload el-upload--text"><button class="el-button"><span>点击上传</span></button><input class="el-upload__input" type="file" name="file"></div>`);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'file', lib: 'element' });
  });

  it('skips disabled Element widgets', () => {
    const controls = scan(`
      <div class="el-select"><div class="el-select__wrapper is-disabled"><div class="el-select__selection"><div class="el-select__input-wrapper"><input class="el-select__input" disabled></div></div></div></div>
      <div class="el-date-editor el-date-editor--date el-input is-disabled"><div class="el-input__wrapper is-disabled"><input class="el-input__inner" disabled></div></div>
      <div class="el-cascader is-disabled"><div class="el-input is-disabled"><div class="el-input__wrapper"><input class="el-input__inner" disabled></div></div></div>`);
    expect(controls).toEqual([]);
  });

  it('ignores inputs inside teleported Element popper panels', () => {
    const controls = scan(`
      <div class="el-popper el-picker__popper"><div class="el-picker-panel"><div class="el-date-picker__header"><input class="el-input__inner"></div></div></div>
      <div class="el-select__popper"><div class="el-select-dropdown"><input></div></div>`);
    expect(controls).toEqual([]);
  });

  it('mixed form keeps document order across native and library controls', () => {
    const controls = scan(`
      <input name="first">${elSelect}<input name="mid"><div class="ant-picker"><div class="ant-picker-input"><input placeholder="日期"></div></div><textarea name="last"></textarea>`);
    expect(controls.map((c) => `${c.lib}:${c.kind}`)).toEqual([
      'native:text', 'element:select', 'native:text', 'antd:date', 'native:textarea',
    ]);
    expect(controls.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });
});
