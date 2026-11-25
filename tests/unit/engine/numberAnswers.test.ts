// A number answer on a list of choices: the option whose count or range holds it, and never a guess between two.
import { describe, expect, it } from 'vitest';
import type { FillIntent } from '../../../src/drivers/types';
import { matchNumber } from '../../../src/dictionary/options';
import type { Control, OptionInfo } from '../../../src/engine/types';
import { toIntent } from '../../../src/engine/values';
import { getFieldKeyDef } from '../../../src/schema/fieldKeys';

const opts = (...labels: string[]): OptionInfo[] => labels.map((label) => ({ label }));
const pick = (n: number, ...labels: string[]): string => {
  const m = matchNumber(n, opts(...labels));
  return m.status === 'matched' ? labels[m.index]! : m.status;
};

describe('matchNumber', () => {
  it('takes the option that says the number', () => {
    expect(pick(2, '0', '1', '2', '3')).toBe('2');
    expect(pick(1, '无', '1份', '2份', '3份及以上')).toBe('1份');
  });

  it('reads 无, None and 0 as nothing', () => {
    expect(pick(0, '无', '1-2份', '3份以上')).toBe('无');
    expect(pick(0, 'None', '1-2', '3+')).toBe('None');
  });

  it('takes the range that holds it, written in either language', () => {
    expect(pick(2, '0', '1-2份', '3份以上')).toBe('1-2份');
    expect(pick(4, 'Less than 1 year', '1–3 years', '3 to 5 years', 'More than 5 years')).toBe('3 to 5 years');
    expect(pick(6, '1年以下', '1~3年', '3-5年', '5年以上')).toBe('5年以上');
    expect(pick(7, '0-2 years', '3-5 years', '5+ years')).toBe('5+ years');
    expect(pick(3, '1至2天', '3到4天', '5天')).toBe('3到4天');
  });

  it('keeps 以下 and less than below the number they name', () => {
    expect(pick(0.5, 'Less than 1 year', '1-3 years')).toBe('Less than 1 year');
    expect(pick(1, '1年以下', '1-3年')).toBe('1-3年');
  });

  it('reads k and 万 as thousands and ten thousands', () => {
    expect(pick(18000, '10k-15k', '15k-20k', '20k以上')).toBe('15k-20k');
    expect(pick(250000, '10-20万', '20-30万', '30万以上')).toBe('20-30万');
  });

  it('says ambiguous when two ranges hold it, and none when no option does', () => {
    expect(pick(3, '1-3年', '3-5年', '5年以上')).toBe('ambiguous');
    expect(pick(9, '1-2', '3-4')).toBe('none');
    expect(pick(2, 'Yes', 'No')).toBe('none');
  });
});

describe('a number question on a list', () => {
  const select: Control = { id: 'c1', el: document.createElement('select'), kind: 'select', lib: 'native' };
  const choice = (key: string, raw: number, ...labels: string[]): string => {
    const i: FillIntent | null = toIntent(getFieldKeyDef(key)!, raw, select, 'zh-CN');
    if (!i || i.kind !== 'choice') throw new Error(`not a choice: ${JSON.stringify(i)}`);
    const m = i.match(opts(...labels));
    return m.status === 'matched' ? labels[m.index]! : m.status;
  };

  it('picks by range', () => {
    expect(choice('questions.offerCount', 2, '无', '1-2份', '3份及以上')).toBe('1-2份');
    expect(choice('questions.yearsExperience', 4, '1年以下', '1-3年', '3-5年', '5年以上')).toBe('3-5年');
  });
});
