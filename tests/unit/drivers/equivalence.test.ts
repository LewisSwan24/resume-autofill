import { describe, expect, it } from 'vitest';
import { valuesEquivalent } from '../../../src/drivers/execute';

describe('valuesEquivalent', () => {
  it('ignores whitespace, case and width', () => {
    expect(valuesEquivalent('Alice  Zhang', ' alice zhang\n')).toBe(true);
    expect(valuesEquivalent('ＡＢＣ１２３', 'abc123')).toBe(true);
    expect(valuesEquivalent('a\u200bb', 'ab')).toBe(true);
  });

  it('never matches a null observation or different text', () => {
    expect(valuesEquivalent('x', null)).toBe(false);
    expect(valuesEquivalent('', null)).toBe(false);
    expect(valuesEquivalent('Master', 'Doctor')).toBe(false);
    expect(valuesEquivalent('', '')).toBe(true);
  });

  it('compares dates by their digits across formats', () => {
    expect(valuesEquivalent('2020-09', '2020/9')).toBe(true);
    expect(valuesEquivalent('2020-09', '2020年9月')).toBe(true);
    expect(valuesEquivalent('2020-09-01', '2020.09.01')).toBe(true);
    expect(valuesEquivalent('2020-09-01', '2020年9月1日')).toBe(true);
    expect(valuesEquivalent('2020-09-01', '2020-09')).toBe(false);
    expect(valuesEquivalent('2020-09', '2020-10')).toBe(false);
    expect(valuesEquivalent('2020', '2020')).toBe(true);
  });
});
