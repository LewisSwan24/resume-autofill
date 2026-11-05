// What was on the form before: left alone only when it really is the answer.
import { afterEach, describe, expect, it } from 'vitest';
import { feishuDrivers } from '../../../src/drivers/feishu';
import type { FillIntent } from '../../../src/drivers/types';
import { feishuList } from '../../shared/feishuForm';
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
