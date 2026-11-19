// Feishu's mobile form: lists and month spans are wheels in a drawer, schools a search in a drawer. Built from the
// markup captured on a phone (Android 13, WebView 156) on 9 Nov 2026; the page's behaviour is a stand-in.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discover } from '../../../src/engine/discover';
import { getDriver } from '../../../src/drivers/registry';
import { registerAllDrivers } from '../../../src/drivers';
import type { Control } from '../../../src/engine/types';
import type { FillIntent } from '../../../src/drivers/types';
import { behave, FEISHU_MOBILE_FORM, mcity, mperiod, mschool, mselect, type MobilePage } from '../../shared/feishuMobileForm';
import { byLabel, choice, ctx1, mount } from './helpers';

registerAllDrivers();

let page: MobilePage;
beforeEach(() => {
  page = behave(document);
});
afterEach(() => {
  page.stop();
  document.body.replaceChildren();
});

const row = (title: string, control: string) =>
  `<div class="atsx-row atsx-form-item"><div class="atsx-form-item-control"><span class="atsx-form-item-children"><div class="atsx-col atsx-form-item-label"><label title="${title}">${title}</label></div></span></div><div class="atsx-col atsx-form-item-control-wrapper">${control}</div></div>`;

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

const ym = (year: number, month: number) => ({ display: `${year}-${month}`, year, month });
const span = (from: [number, number], to: [number, number]): FillIntent => ({ kind: 'dateRange', display: '', start: ym(...from), end: ym(...to) });
const openDrawers = () => document.querySelectorAll('.atsx-drawer-open').length;

describe('what is a field', () => {
  it('each picker is one field, and the phone number shown from the login is none', () => {
    mount(FEISHU_MOBILE_FORM);
    const controls = discover(document);
    const pickers = controls.filter((c) => c.lib === 'feishu').map((c) => `${c.kind}${c.dateRange ? ':range:' + c.dateGranularity : ''}`);
    expect(pickers.sort()).toEqual(['date:range:month', 'select', 'select', 'select']);
    expect(controls.filter((c) => c.lib !== 'feishu')).toHaveLength(3); // 姓名, 邮箱, 专业
  });

  it('the search box of an open drawer is not a field', async () => {
    mount(FEISHU_MOBILE_FORM);
    const before = discover(document).length;
    document.querySelector<HTMLElement>('.atsx-m-input-select-placeholder')!.click();
    expect(openDrawers()).toBe(1);
    expect(discover(document)).toHaveLength(before);
  });
});

describe('a list on a wheel', () => {
  it('turns the wheel to the answer and confirms it', async () => {
    const control = only(mselect());
    const result = await fill(control, choice('硕士'));
    expect(result).toMatchObject({ ok: true, observed: '硕士' });
    expect(control.el.textContent).toBe('硕士');
    expect(openDrawers()).toBe(0);
  });

  it('reaches the last option as well as the first', async () => {
    const control = only(mselect());
    expect(await fill(control, choice('其他'))).toMatchObject({ ok: true, observed: '其他' });
  });

  it('leaves the very answer alone without opening anything', async () => {
    const control = only(mselect('硕士'));
    expect(await fill(control, choice('硕士'))).toMatchObject({ ok: true, observed: '硕士' });
    expect(page.opened).toEqual([]);
  });

  it('an answer the list does not have changes nothing and shuts the drawer', async () => {
    const control = only(mselect());
    const result = await fill(control, choice('博士后'));
    expect(result).toMatchObject({ ok: false, outcome: 'no_option' });
    expect(control.el.textContent).toBe('请选择');
    expect(openDrawers()).toBe(0);
  });

  it('several options that fit are left to the applicant', async () => {
    const control = only(mselect('', ['中文', '英语', '英语']));
    const result = await fill(control, { kind: 'choice', display: '英语', query: '英语', match: byLabel('英语') });
    expect(result).toMatchObject({ ok: false, outcome: 'needs_review' });
    expect(openDrawers()).toBe(0);
  });
});

describe('a span of months', () => {
  it('sets the start, then the end, then confirms', async () => {
    const control = only(mperiod());
    const result = await fill(control, span([2020, 9], [2024, 7]));
    expect(result).toMatchObject({ ok: true, observed: '2020-09 – 2024-07' });
    expect(openDrawers()).toBe(0);
  });

  it('a span already there is left alone', async () => {
    const control = only(mperiod('2020-09', '2024-07'));
    expect(await fill(control, span([2020, 9], [2024, 7]))).toMatchObject({ ok: true });
    expect(page.opened).toEqual([]);
  });

  it('a span still going is for the applicant: the wheel has no word for it, and any month would be a lie', async () => {
    const control = only(mperiod());
    const result = await fill(control, { kind: 'dateFrom', display: '', start: ym(2025, 2) });
    expect(result).toMatchObject({ ok: false, outcome: 'needs_review' });
    expect(page.opened).toEqual([]);
  });
});

describe('a place', () => {
  it('taps the place that is the answer', async () => {
    const control = only(mcity());
    expect(await fill(control, choice('杭州'))).toMatchObject({ ok: true, observed: '杭州' });
    expect(openDrawers()).toBe(0);
  });

  it('takes the next city in the resume when the first is not offered', async () => {
    const control = only(mcity());
    const first = choice('上海');
    if (first.kind !== 'choice') throw new Error('choice expected');
    const result = await fill(control, { ...first, fallbacks: [{ query: '北京', match: byLabel('北京') }] });
    expect(result).toMatchObject({ ok: true, observed: '北京' });
    expect(openDrawers()).toBe(0);
  });

  it('a later city of the resume already chosen is left alone', async () => {
    const control = only(mcity(['北京', '杭州'], '北京'));
    const first = choice('上海');
    if (first.kind !== 'choice') throw new Error('choice expected');
    expect(await fill(control, { ...first, fallbacks: [{ query: '北京', match: byLabel('北京') }] })).toMatchObject({ ok: true, observed: '北京' });
    expect(page.opened).toEqual([]);
  });

  it('the place already chosen is left alone without opening anything', async () => {
    const control = only(mcity(['北京', '杭州'], '北京'));
    expect(await fill(control, choice('北京'))).toMatchObject({ ok: true, observed: '北京' });
    expect(page.opened).toEqual([]);
  });

  it('a place the job does not offer changes nothing and shuts the drawer', async () => {
    const control = only(mcity());
    expect(await fill(control, choice('上海'))).toMatchObject({ ok: false, outcome: 'no_option' });
    expect(openDrawers()).toBe(0);
  });
});

describe('a school', () => {
  it('searches and takes the option that is the school', async () => {
    const control = only(mschool('', ['北京大学', '北京大学医学部']));
    const result = await fill(control, choice('北京大学'));
    expect(result).toMatchObject({ ok: true, observed: '北京大学' });
    expect(openDrawers()).toBe(0);
  });

  it('a school the search does not know is kept as typed', async () => {
    const control = only(mschool('', ['清华大学']));
    const result = await fill(control, choice('某某学院'));
    expect(result).toMatchObject({ ok: true, observed: '某某学院' });
    expect(openDrawers()).toBe(0);
  });

  /** Holds back the search's answer behind a spinner, as a slow network does; `after` ms later it comes, or never. */
  let slow: AbortController | null = null;
  afterEach(() => slow?.abort());
  const slowSearch = (after: number | null) => {
    slow = new AbortController();
    document.addEventListener('input', (e) => {
      const warp = (e.target as Element).closest('.atsx-drawer')?.querySelector('.atsx-m-input-select-options-warp');
      if (!warp) return;
      const answer = [...warp.children];
      const spin = document.createElement('div');
      spin.className = 'atsx-spin atsx-spin-spinning';
      warp.replaceChildren(spin);
      if (after !== null) setTimeout(() => warp.replaceChildren(...answer), after);
    }, { signal: slow.signal });
  };

  it('a slow search is waited for while the page says it is still searching', async () => {
    slowSearch(400);
    const control = only(mschool('', ['某某大学']));
    expect(await fill(control, choice('某某大学'))).toMatchObject({ ok: true, observed: '某某大学' });
  });

  it('a search that never answers writes nothing as typed and is left to check', async () => {
    slowSearch(null);
    const control = only(mschool('', ['某某大学']));
    const result = await fill(control, choice('某某大学'));
    expect(result).toMatchObject({ ok: false, outcome: 'needs_review' });
    expect(control.el.querySelector('.atsx-m-input-select-hasValue')).toBeNull();
    expect(openDrawers()).toBe(0);
  }, 10_000);

  it('the school already there is left alone', async () => {
    const control = only(mschool('北京大学'));
    expect(await fill(control, choice('北京大学'))).toMatchObject({ ok: true, observed: '北京大学' });
    expect(page.opened).toEqual([]);
  });
});
