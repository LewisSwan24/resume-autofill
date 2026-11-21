// Feishu's desktop form in its atsx- generation: antd 3 lists, a place tree, a school combobox that asks the site,
// and a span of months picked from panels. Markup as captured on 21 Nov 2026; the page's behaviour is a stand-in.
import { afterEach, describe, expect, it } from 'vitest';
import { discover } from '../../../src/engine/discover';
import { getDriver } from '../../../src/drivers/registry';
import { registerAllDrivers } from '../../../src/drivers';
import type { Control, OptionInfo } from '../../../src/engine/types';
import type { FillIntent, OptionMatch } from '../../../src/drivers/types';
import { FEISHU_DESKTOP_FORM, GENDERS, PLACES, SCHOOLS, aperiod, aschool, aselect, behave, type DesktopPage } from '../../shared/feishuDesktopForm';
import { choice, ctx1, mount } from './helpers';

registerAllDrivers();

let page: DesktopPage | undefined;
const start = (opts: Parameters<typeof behave>[1] = {}) => (page = behave(document, opts));
afterEach(() => {
  page?.stop();
  page = undefined;
  document.body.replaceChildren();
});

const row = (title: string, control: string) =>
  `<div class="atsx-row atsx-form-item"><div class="atsx-col atsx-form-item-label"><label title="${title}">${title}</label></div><div class="atsx-col atsx-form-item-control-wrapper">${control}</div></div>`;

function only(html: string): Control {
  mount(row('字段', html));
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

/** Matches any of the names given, the first being the place's own way of writing it. */
const oneOf =
  (...names: string[]) =>
  (options: OptionInfo[]): OptionMatch => {
    const hits = options.flatMap((o, i) => (names.includes(o.label) ? [i] : []));
    if (hits.length === 0) return { status: 'none' };
    return hits.length > 1 ? { status: 'ambiguous', candidates: hits } : { status: 'matched', index: hits[0]!, confidence: 1 };
  };
const place = (own: string[], ...wider: string[][]): FillIntent => ({
  kind: 'choice',
  display: own[0]!,
  query: own[0]!,
  match: oneOf(...own),
  ...(wider.length ? { wider: wider.map((w) => ({ query: w[0]!, match: oneOf(...w) })) } : {}),
});
const ym = (year: number, month: number) => ({ display: `${year}-${month}`, year, month });
const span = (from: [number, number], to: [number, number]): FillIntent => ({ kind: 'dateRange', display: '', start: ym(...from), end: ym(...to) });
const openDropdowns = () => document.querySelectorAll('.atsx-select-dropdown:not(.atsx-select-dropdown-hidden), .atsx-date-picker-dropdown').length;

describe('what is a field', () => {
  it('each atsx box is one Feishu field, and a span of months is one field by the month', () => {
    mount(FEISHU_DESKTOP_FORM);
    const controls = discover(document);
    const pickers = controls.filter((c) => c.lib === 'feishu').map((c) => `${c.kind}${c.dateRange ? ':range:' + c.dateGranularity : ''}`);
    expect(pickers.sort()).toEqual(['date:range:month', 'select', 'select', 'select']);
    expect(controls.filter((c) => c.lib !== 'feishu')).toHaveLength(1); // 姓名
  });
});

describe('a list', () => {
  it('picks the answer from the dropdown and closes it', async () => {
    start();
    const c = only(aselect('gender', GENDERS));
    expect(await fill(c, choice('男'))).toMatchObject({ ok: true, observed: '男' });
    expect(read(c)).toBe('男');
    expect(openDropdowns()).toBe(0);
  });

  it('leaves an answer the page already shows', async () => {
    start();
    const c = only(aselect('gender', GENDERS, '男'));
    expect(await fill(c, choice('男'))).toMatchObject({ ok: true, observed: '男' });
    expect(document.querySelectorAll('.atsx-select-dropdown')).toHaveLength(0);
  });

  it('says so when the list has no such answer, and closes the dropdown', async () => {
    start();
    const c = only(aselect('gender', GENDERS));
    expect(await fill(c, choice('未知'))).toMatchObject({ ok: false, outcome: 'no_option' });
    expect(read(c)).toBeNull();
    expect(openDropdowns()).toBe(0);
  });
});

describe('a place from the tree', () => {
  it('types the district and picks it under its own city', async () => {
    start({ trees: { city: PLACES } });
    const c = only(aselect('city'));
    expect(await fill(c, place(['南山区'], ['深圳市', '深圳'], ['广东省', '广东']))).toMatchObject({ ok: true, observed: '南山区' });
    expect(openDropdowns()).toBe(0);
  });

  it('tells two districts of one name apart by the city above them', async () => {
    start({ trees: { city: PLACES } });
    const c = only(aselect('city'));
    expect(await fill(c, place(['西湖区'], ['南昌市', '南昌'], ['江西省', '江西']))).toMatchObject({ ok: true, observed: '西湖区' });
    const picked = document.querySelector('.atsx-select-selection-selected-value');
    expect(picked?.textContent).toBe('西湖区');
  });

  it('goes up to the city when the tree stops there, typing the name as the tree writes it', async () => {
    start({ trees: { city: PLACES } });
    const c = only(aselect('city'));
    expect(await fill(c, place(['天河南街道'], ['广州市', '广州'], ['广东省', '广东']))).toMatchObject({ ok: true, observed: '广州' });
  });

  it('says so when no level of the place is in the tree', async () => {
    start({ trees: { city: PLACES } });
    const c = only(aselect('city'));
    expect(await fill(c, place(['布鲁克林'], ['纽约']))).toMatchObject({ ok: false, outcome: 'no_option' });
    expect(openDropdowns()).toBe(0);
  });
});

describe('a school', () => {
  it("types the school, waits for the site's answer and picks the one that is it", async () => {
    start({ schools: SCHOOLS });
    const c = only(aschool('education[0].school'));
    expect(await fill(c, choice('浙江大学'))).toMatchObject({ ok: true, observed: '浙江大学' });
    expect(page!.searches).toEqual(['浙江大学']);
    expect(openDropdowns()).toBe(0);
  });

  it('keeps a school the site does not know as written', async () => {
    start({ schools: SCHOOLS });
    const c = only(aschool('education[0].school'));
    expect(await fill(c, choice('澳大利亚国立大学'))).toMatchObject({ ok: true, observed: '澳大利亚国立大学' });
    expect(openDropdowns()).toBe(0);
  });

  it('leaves the school the page already shows', async () => {
    start({ schools: SCHOOLS });
    const c = only(aschool('education[0].school', '浙江大学'));
    expect(await fill(c, choice('浙江大学'))).toMatchObject({ ok: true, observed: '浙江大学' });
    expect(page!.searches).toEqual([]);
  });
});

describe('a span of months', () => {
  it('picks the start and then the end from their panels', async () => {
    start();
    const c = only(aperiod('education[0].periodInput'));
    expect(c.dateRange).toBe(true);
    expect(await fill(c, span([2020, 9], [2024, 6]))).toMatchObject({ ok: true, observed: '2020-09 – 2024-06' });
    expect(openDropdowns()).toBe(0);
  });

  it('leaves a span the page already shows', async () => {
    start();
    const c = only(aperiod('education[0].periodInput', '2020-09', '2024-06'));
    expect(await fill(c, span([2020, 9], [2024, 6]))).toMatchObject({ ok: true, observed: '2020-09 – 2024-06' });
    expect(openDropdowns()).toBe(0);
  });

  it('puts in the start of a span still going and leaves the end to the applicant', async () => {
    start();
    const c = only(aperiod('work[0].periodInput'));
    const intent: FillIntent = { kind: 'dateFrom', display: '', start: ym(2025, 11) };
    expect(await fill(c, intent)).toMatchObject({ ok: false, outcome: 'needs_review' });
    expect(read(c)).toBe('2025-11 –');
    expect(openDropdowns()).toBe(0);
  });
});
