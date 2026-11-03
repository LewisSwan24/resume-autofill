import { describe, expect, it } from 'vitest';
import { bestLabel, countOutcomes, needsAttention, shortLabel } from '../../../src/fill/report';

describe('countOutcomes', () => {
  it('counts every outcome and keeps zeros', () => {
    const counts = countOutcomes([
      { outcome: 'filled' },
      { outcome: 'filled' },
      { outcome: 'needs_review' },
      { outcome: 'no_data' },
    ]);
    expect(counts).toEqual({
      filled: 2, needs_review: 1, unmatched: 0, no_data: 1, no_control: 0, no_option: 0, action_failed: 0,
    });
  });

  it('is all zero for an empty list', () => {
    expect(Object.values(countOutcomes([])).every((n) => n === 0)).toBe(true);
  });
});

describe('labels', () => {
  it('bestLabel takes the first (heaviest) evidence', () => {
    const ev = [
      { source: 'label-for' as const, text: ' 姓名 ', weight: 1 },
      { source: 'placeholder' as const, text: '请输入姓名', weight: 0.7 },
    ];
    expect(bestLabel(ev)).toBe('姓名');
    expect(bestLabel([], 'c3')).toBe('c3');
  });

  it('shortLabel collapses whitespace and truncates', () => {
    expect(shortLabel('a   b\n c')).toBe('a b c');
    expect(shortLabel('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('needsAttention ignores filled and no_data', () => {
    expect(
      needsAttention([{ outcome: 'filled' }, { outcome: 'no_data' }, { outcome: 'needs_review' }, { outcome: 'unmatched' }]),
    ).toBe(2);
  });
});
