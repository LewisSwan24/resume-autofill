import { describe, expect, it } from 'vitest';
import type { OptionInfo } from '../../../src/engine/types';
import { buildApplyIntent, exactLabelMatcher } from '../../../src/content/intent';

const opts = (...labels: (string | OptionInfo)[]): OptionInfo[] =>
  labels.map((l) => (typeof l === 'string' ? { label: l } : l));

describe('exactLabelMatcher', () => {
  it('matches the unique option whose normalized label equals the wanted one', () => {
    const match = exactLabelMatcher('  Master ');
    expect(match(opts('Bachelor', 'MASTER', 'Doctor'))).toEqual({ status: 'matched', index: 1, confidence: 1 });
  });

  it('normalizes full-width forms, noise and CJK spacing', () => {
    expect(exactLabelMatcher('硕士 研究生')(opts('本科', '硕士研究生'))).toMatchObject({ status: 'matched', index: 1 });
    expect(exactLabelMatcher('ＭＡＳＴＥＲ')(opts('master'))).toMatchObject({ status: 'matched', index: 0 });
    expect(exactLabelMatcher('请选择 男')(opts('男', '女'))).toMatchObject({ status: 'matched', index: 0 });
  });

  it('is exact, not fuzzy: a prefix or superset does not match', () => {
    expect(exactLabelMatcher('Master')(opts('Master of Science', 'Masters'))).toEqual({ status: 'none' });
  });

  it('reports ambiguity instead of picking when several options normalize equal', () => {
    expect(exactLabelMatcher('Beta')(opts('Alpha', 'Beta', 'beta ', 'Gamma'))).toEqual({
      status: 'ambiguous',
      candidates: [1, 2],
    });
  });

  it('skips disabled options', () => {
    expect(exactLabelMatcher('A')(opts({ label: 'A', disabled: true }, 'A'))).toMatchObject({ status: 'matched', index: 1 });
    expect(exactLabelMatcher('A')(opts({ label: 'A', disabled: true }))).toEqual({ status: 'none' });
  });

  it('returns none for an empty wanted label or empty options', () => {
    expect(exactLabelMatcher('')(opts('', 'A'))).toEqual({ status: 'none' });
    expect(exactLabelMatcher('A')([])).toEqual({ status: 'none' });
  });
});

describe('buildApplyIntent', () => {
  it('text → text intent (empty string included, to clear a field)', () => {
    expect(buildApplyIntent({ text: 'hello' })).toEqual({ kind: 'text', text: 'hello' });
    expect(buildApplyIntent({ text: '' })).toEqual({ kind: 'text', text: '' });
  });

  it('optionLabel → choice intent with the exact matcher and the label as display / query', () => {
    const intent = buildApplyIntent({ optionLabel: 'Male' });
    expect(intent).toMatchObject({ kind: 'choice', display: 'Male', query: 'Male' });
    if (intent?.kind !== 'choice') throw new Error('expected a choice intent');
    expect(intent.match(opts('Female', 'male'))).toMatchObject({ status: 'matched', index: 1 });
  });

  it('optionLabel wins when both are given; neither → null', () => {
    expect(buildApplyIntent({ text: 'x', optionLabel: 'y' })?.kind).toBe('choice');
    expect(buildApplyIntent({})).toBeNull();
  });
});
