// Moka's phone form: lists are readonly 「请选择」 inputs that open a sheet inside the field, dates are wheels that
// follow a finger. Built from the markup of a phone capture replayed in Chromium (Nov 2026); the page's behaviour is a
// stand-in for what was seen there.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discover } from '../../../src/engine/discover';
import { getDriver } from '../../../src/drivers/registry';
import { registerAllDrivers } from '../../../src/drivers';
import type { Control } from '../../../src/engine/types';
import type { FillIntent } from '../../../src/drivers/types';
import { behave, CITIES, LANGUAGES, LEVELS, mlist, mmonth, MOKA_MOBILE_FORM, mspan, YES_NO, type MobilePage } from '../../shared/mokaMobileForm';
import { choice, ctx1, mount, multi } from './helpers';

registerAllDrivers();

let page: MobilePage;
beforeEach(() => {
  page = behave(document);
});
afterEach(() => {
  page.stop();
  document.body.replaceChildren();
});

function only(html: string): Control {
  mount(html);
  const controls = discover(document);
  expect(controls).toHaveLength(1);
  return controls[0]!;
}

const fill = (control: Control, intent: FillIntent) => {
  const driver = getDriver(control);
  if (!driver) throw new Error('no driver');
  return driver.fill(control, intent, ctx1);
};
const read = (control: Control) => getDriver(control)!.read(control);

const ym = (year: number, month: number) => ({ display: `${year}-${month}`, year, month });
const month = (year: number, m: number): FillIntent => ({ kind: 'date', ...ym(year, m) });
const span = (from: [number, number], to: [number, number]): FillIntent => ({ kind: 'dateRange', display: '', start: ym(...from), end: ym(...to) });
const openSheets = () => document.querySelectorAll('[class*="mobile-dialog-"], [class*="selector-panel-"]').length;
const inputOf = (control: Control) => control.el.querySelector('input')!;
const dateShown = (control: Control) => Array.from(control.el.querySelectorAll('.mobile-text-input__input')).map((s) => s.textContent);

describe('what is a field', () => {
  it('each list and each date is one field of its own kind, and a text box stays a text box', () => {
    mount(MOKA_MOBILE_FORM);
    const controls = discover(document);
    const moka = controls.filter((c) => c.lib === 'moka').map((c) => `${c.kind}${c.multiple ? ':multi' : ''}${c.dateRange ? ':range' : ''}`);
    // Steps 2 and 3 are not showing yet.
    expect(moka.sort()).toEqual(['date', 'select', 'select']);
    expect(controls.filter((c) => c.lib !== 'moka').map((c) => c.kind)).toEqual(['text']);
  });

  it('a multi list says so, and a start and end are one range', () => {
    mount(mlist('期望城市', CITIES, 'multi_select_info') + mspan('就读时间'));
    const controls = discover(document);
    expect(controls.map((c) => `${c.kind}${c.multiple ? ':multi' : ''}${c.dateRange ? ':range' : ''}`)).toEqual(['select:multi', 'date:range']);
  });

  it('an open sheet holds nothing that is a field', () => {
    const control = only(mlist('性别', ['男', '女']));
    inputOf(control).click();
    expect(openSheets()).toBe(1);
    expect(discover(document)).toHaveLength(1);
  });
});

describe('a list in a sheet', () => {
  it('marks the answer and confirms it, so the input takes it', async () => {
    const control = only(mlist('最高学历', LEVELS));
    const result = await fill(control, choice('硕士'));
    expect(result).toMatchObject({ ok: true, observed: '硕士' });
    expect(inputOf(control).value).toBe('硕士');
    expect(page.tapped).toEqual(['硕士']);
    expect(openSheets()).toBe(0);
  });

  it('answers a yes-or-no list the same way', async () => {
    const control = only(mlist('是否接收组织调配', YES_NO, 'bool_info'));
    expect(await fill(control, choice('是'))).toMatchObject({ ok: true, observed: '是' });
    expect(page.tapped).toEqual(['是']);
  });

  it('leaves the very answer alone without opening anything', async () => {
    const control = only(mlist('最高学历', LEVELS, 'select', '硕士'));
    expect(await fill(control, choice('硕士'))).toMatchObject({ ok: true, observed: '硕士' });
    expect(page.opened).toEqual([]);
  });

  it('keeps another answer the page already holds and asks for a look', async () => {
    const control = only(mlist('最高学历', LEVELS, 'select', '本科'));
    const result = await fill(control, choice('硕士'));
    expect(result).toMatchObject({ ok: false, outcome: 'needs_review' });
    expect(inputOf(control).value).toBe('本科');
    expect(openSheets()).toBe(0);
  });

  it('says there is no such option, and closes the sheet with nothing changed', async () => {
    const control = only(mlist('最高学历', LEVELS));
    const result = await fill(control, choice('博士后'));
    expect(result).toMatchObject({ ok: false, outcome: 'no_option' });
    expect(inputOf(control).value).toBe('');
    expect(page.tapped).toEqual([]);
    expect(openSheets()).toBe(0);
  });

  it('marks every answer on a multi list, in one go', async () => {
    const control = only(mlist('语言技能', LANGUAGES, 'multi_select_info'));
    const result = await fill(control, multi('日语', '英语'));
    expect(result).toMatchObject({ ok: true, observed: '英语，日语' });
    expect(openSheets()).toBe(0);
  });

  it('marks what the list has of a multi answer, and asks for a look naming the rest', async () => {
    const control = only(mlist('期望城市', CITIES, 'multi_select_info'));
    const result = await fill(control, multi('深圳', '武汉'));
    expect(result).toMatchObject({ ok: false, outcome: 'needs_review', observed: '深圳' });
    expect(result.detail).toContain('武汉');
    expect(inputOf(control).value).toBe('深圳');
    expect(openSheets()).toBe(0);
  });

  it('says the same of a multi answer the list lacks part of, however often it is filled', async () => {
    const control = only(mlist('期望城市', CITIES, 'multi_select_info'));
    const first = await fill(control, multi('深圳', '武汉'));
    const second = await fill(control, multi('深圳', '武汉'));
    expect(second).toEqual(first);
    expect(inputOf(control).value).toBe('深圳');
    expect(page.tapped).toEqual(['深圳']);
    expect(openSheets()).toBe(0);
  });

  it('says there is no such option when the list has none of a multi answer', async () => {
    const control = only(mlist('期望城市', CITIES, 'multi_select_info'));
    const result = await fill(control, multi('武汉', '南京'));
    expect(result).toMatchObject({ ok: false, outcome: 'no_option' });
    expect(inputOf(control).value).toBe('');
    expect(page.tapped).toEqual([]);
  });

  it('takes one answer on a multi list as one mark', async () => {
    const control = only(mlist('语言技能', LANGUAGES, 'multi_select_info'));
    expect(await fill(control, choice('英语'))).toMatchObject({ ok: true, observed: '英语' });
    expect(page.tapped).toEqual(['英语']);
  });

  it('never unmarks what a multi list already holds', async () => {
    const control = only(mlist('语言技能', LANGUAGES, 'multi_select_info', '德语'));
    const result = await fill(control, multi('英语'));
    expect(result).toMatchObject({ ok: true, observed: '英语，德语' });
    expect(page.tapped).toEqual(['英语']);
  });

  it('reads an empty list as nothing, not as its placeholder', () => {
    const control = only(mlist('性别', ['男', '女']));
    expect(read(control)).toBeNull();
  });
});

describe('dates on wheels', () => {
  it('turns the year and the month to a birth date and confirms it', async () => {
    const control = only(mmonth('出生日期 (年龄)'));
    const result = await fill(control, month(2001, 4));
    expect(result).toMatchObject({ ok: true, observed: '2001-04' });
    expect(dateShown(control)[0]).toMatch(/^2001-04/);
    expect(openSheets()).toBe(0);
  });

  it('reaches the first and the last row of a wheel', async () => {
    const control = only(mmonth('出生日期 (年龄)'));
    expect(await fill(control, month(1932, 12))).toMatchObject({ ok: true, observed: '1932-12' });
  });

  it('fills a start and an end, each in its own wheels', async () => {
    const control = only(mspan('就读时间'));
    const result = await fill(control, span([2019, 9], [2023, 6]));
    expect(result).toMatchObject({ ok: true, observed: '2019-09 ~ 2023-06' });
    expect(dateShown(control)).toEqual(['2019-09', '2023-06']);
    expect(page.opened).toEqual(['date', 'date']);
  });

  it('sets a date the page shows to the month the resume gives, as the other date drivers do', async () => {
    const control = only(mmonth('出生日期 (年龄)', '1999-01 (27岁)'));
    const result = await fill(control, month(2001, 4));
    expect(result).toMatchObject({ ok: true, observed: '2001-04' });
    expect(dateShown(control)[0]).toMatch(/^2001-04/);
  });

  it('leaves dates already right alone', async () => {
    mount(mspan('就读时间', '2019-09', '2023-06'));
    const control = discover(document)[0]!;
    expect(await fill(control, span([2019, 9], [2023, 6]))).toMatchObject({ ok: true });
    expect(page.opened).toEqual([]);
  });

  it('fills the start of something still going, and asks for a look at the end the wheels cannot say', async () => {
    const control = only(mspan('起止时间'));
    const result = await fill(control, { kind: 'dateFrom', display: '', start: ym(2025, 11) });
    expect(result).toMatchObject({ ok: false, outcome: 'needs_review' });
    expect(dateShown(control)).toEqual(['2025-11', '']);
  });

  it('says so when the year is not on the wheel, and closes it', async () => {
    const control = only(mmonth('出生日期 (年龄)'));
    const result = await fill(control, month(1890, 1));
    expect(result).toMatchObject({ ok: false });
    expect(dateShown(control)).toEqual(['']);
    expect(openSheets()).toBe(0);
  });
});
