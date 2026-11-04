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

describe('valuesEquivalent: phone numbers a widget formats as it writes', () => {
  it.each([
    ['0412345678', '0412 345 678'],
    ['0412345678', '(04) 1234-5678'],
    ['+61 412 345 678', '+61412345678'],
    ['0412345678', '+61 412 345 678'],
  ])('%j reads back as %j', (expected, observed) => {
    expect(valuesEquivalent(expected, observed)).toBe(true);
  });

  it.each([
    ['0412345678', '0412 345 679'],
    ['0412345678', '412 345 678 9'],
    ['0412345678', '412345678'],
    ['12345678', '1234 5678 90'],
    ['2020-09-01', '20200901'],
    ['123 Queen Street', '123 Queen St'],
  ])('%j does not read back as %j', (expected, observed) => {
    expect(valuesEquivalent(expected, observed)).toBe(false);
  });
});
