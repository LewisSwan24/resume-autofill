// What was on the form before: left alone only when it really is the answer.
import { afterEach, describe, expect, it } from 'vitest';
import { feishuDrivers } from '../../../src/drivers/feishu';
import type { FillIntent } from '../../../src/drivers/types';
import { behaveAsPlaceTree, feishuList, feishuMonth, feishuPlaceList } from '../../shared/feishuForm';
import { ctx1, firstControl } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

const list = feishuDrivers.find((d) => d.id === 'feishu-list')!;
const answering = (query: string, confidence: number): FillIntent => ({
  kind: 'choice',
  display: query,
  query,
  match: () => ({ status: 'matched', index: 0, confidence }),
});

describe('an answer already there', () => {
  it('the very thing is left alone', async () => {
    const control = firstControl(feishuList('硕士'));
    expect((await list.fill(control, answering('硕士', 1), ctx1)).ok).toBe(true);
  });

  it('something merely containing it is not the answer', async () => {
    const control = firstControl(feishuList('浙江大学城市学院'));
    expect((await list.fill(control, answering('浙江大学', 0.8), ctx1)).ok).toBe(false);
  });
});

describe('a search that finds nothing', () => {
  it('leaves the box as it found it', async () => {
    const control = firstControl(feishuList('硕士').replace('ud__select__selector-readOnly', '').replace(' readonly', ''));
    const input = control.el.querySelector('input')!;
    input.readOnly = false;
    await list.fill(control, answering('博士', 0.8), ctx1);
    expect(input.value).toBe('');
  });
});

describe('a date box', () => {
  const dates = feishuDrivers.find((d) => d.id === 'feishu-date')!;
  const date: FillIntent = { kind: 'date', display: '2022-10', year: 2022, month: 10 };

  it('takes the year alone when its format asks only for a year', async () => {
    const control = firstControl(feishuMonth('YYYY'));
    expect(await dates.fill(control, date, ctx1)).toMatchObject({ ok: true, observed: '2022' });
  });

  it('takes the month when its format asks for one', async () => {
    const control = firstControl(feishuMonth());
    expect(await dates.fill(control, date, ctx1)).toMatchObject({ ok: true, observed: '2022-10' });
  });
});

describe('a list of places drawn as a tree', () => {
  const TREE = { 中国大陆: { 广东: ['广州', '深圳'], 浙江: ['杭州', '宁波'] }, 中国香港: { 香港: ['香港'] } };
  const city = (name: string) => ({ query: name, match: (options: { label: string }[]) => {
    const index = options.findIndex((o) => o.label === name);
    return index >= 0 ? { status: 'matched' as const, index, confidence: 1 } : { status: 'none' as const };
  } });
  const cities = (...names: string[]): FillIntent => ({ kind: 'multi', display: names.join('、'), items: names.map(city) });
  let stop = () => {};
  afterEach(() => stop());

  it('ticks each of the resume’s cities, found by searching', async () => {
    stop = behaveAsPlaceTree(document, TREE);
    const control = firstControl(feishuPlaceList());
    expect(await list.fill(control, cities('深圳', '杭州'), ctx1)).toMatchObject({ ok: true, observed: '深圳、杭州' });
    expect(control.el.querySelector('input')!.value).toBe('');
  });

  it('ticks what it finds and says the rest is missing', async () => {
    stop = behaveAsPlaceTree(document, TREE);
    const control = firstControl(feishuPlaceList());
    expect(await list.fill(control, cities('深圳', '成都'), ctx1)).toMatchObject({ ok: false, outcome: 'needs_review', observed: '深圳' });
  });

  it('leaves alone a city already ticked through its country', async () => {
    stop = behaveAsPlaceTree(document, TREE, ['中国大陆']);
    const control = firstControl(feishuPlaceList());
    control.el.querySelector('.ud__select__selector')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await list.fill(control, cities('深圳'), ctx1)).toMatchObject({ ok: true, observed: '中国大陆' });
  });

  it('ticks nothing when none of the cities is there', async () => {
    stop = behaveAsPlaceTree(document, TREE);
    const control = firstControl(feishuPlaceList());
    expect(await list.fill(control, cities('成都'), ctx1)).toMatchObject({ ok: false, outcome: 'no_option', observed: null });
  });
});

