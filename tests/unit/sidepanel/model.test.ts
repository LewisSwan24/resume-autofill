import { describe, expect, it } from 'vitest';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';
import {
  OUTCOME_ORDER,
  countOutcomes,
  displayValue,
  fieldKey,
  filterByOutcomes,
  formatConfidence,
  hasCandidateChoices,
  isFillReport,
  outcomeTone,
  parseTabIdOverride,
  patchReport,
  reportStorageKey,
  sortBySeverity,
  toggleOutcome,
} from '../../../entrypoints/sidepanel/model';

const field = (fieldId: string, outcome: Outcome, extra: Partial<FieldReport> = {}): FieldReport => ({
  fieldId,
  label: fieldId,
  fieldKey: null,
  section: null,
  outcome,
  confidence: 0.5,
  ...extra,
});

describe('outcomeTone', () => {
  it('maps outcomes to chip tones', () => {
    expect(outcomeTone('filled')).toBe('success');
    expect(outcomeTone('needs_review')).toBe('warning');
    expect(outcomeTone('no_option')).toBe('warning');
    expect(outcomeTone('unmatched')).toBe('danger');
    expect(outcomeTone('action_failed')).toBe('danger');
    expect(outcomeTone('no_data')).toBe('muted');
    expect(outcomeTone('no_control')).toBe('muted');
  });

  it('OUTCOME_ORDER lists every outcome once', () => {
    expect(new Set(OUTCOME_ORDER).size).toBe(7);
  });
});

describe('sortBySeverity', () => {
  it('puts urgent outcomes first and keeps report order within an outcome', () => {
    const fields = [
      field('a', 'filled'),
      field('b', 'no_data'),
      field('c', 'needs_review'),
      field('d', 'action_failed'),
      field('e', 'needs_review'),
      field('f', 'unmatched'),
    ];
    expect(sortBySeverity(fields).map((f) => f.fieldId)).toEqual(['d', 'c', 'e', 'f', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const fields = [field('a', 'filled'), field('b', 'unmatched')];
    sortBySeverity(fields);
    expect(fields.map((f) => f.fieldId)).toEqual(['a', 'b']);
  });
});

describe('filterByOutcomes / toggleOutcome', () => {
  const fields = [field('a', 'filled'), field('b', 'unmatched'), field('c', 'needs_review')];

  it('empty selection keeps everything', () => {
    expect(filterByOutcomes(fields, new Set())).toHaveLength(3);
  });

  it('keeps only selected outcomes', () => {
    const result = filterByOutcomes(fields, new Set<Outcome>(['unmatched', 'needs_review']));
    expect(result.map((f) => f.fieldId)).toEqual(['b', 'c']);
  });

  it('toggles without mutating the previous set', () => {
    const empty = new Set<Outcome>();
    const one = toggleOutcome(empty, 'filled');
    expect([...one]).toEqual(['filled']);
    expect(empty.size).toBe(0);
    expect(toggleOutcome(one, 'filled').size).toBe(0);
  });
});

describe('countOutcomes', () => {
  it('counts every outcome, including zeros', () => {
    const counts = countOutcomes([field('a', 'filled'), field('b', 'filled'), field('c', 'no_data')]);
    expect(counts).toEqual({
      filled: 2,
      needs_review: 0,
      unmatched: 0,
      no_data: 1,
      no_control: 0,
      no_option: 0,
      action_failed: 0,
    });
  });
});

describe('formatConfidence', () => {
  it('formats as a rounded percentage', () => {
    expect(formatConfidence(0.856)).toBe('86%');
    expect(formatConfidence(0)).toBe('0%');
    expect(formatConfidence(1)).toBe('100%');
  });
  it('clamps and tolerates bad input', () => {
    expect(formatConfidence(1.4)).toBe('100%');
    expect(formatConfidence(-0.2)).toBe('0%');
    expect(formatConfidence(Number.NaN)).toBe('—');
    expect(formatConfidence(undefined)).toBe('—');
  });
});

describe('displayValue / hasCandidateChoices', () => {
  it('prefers the intended value, then the observed one', () => {
    expect(displayValue({ value: 'x', observed: 'y' })).toBe('x');
    expect(displayValue({ observed: 'y' })).toBe('y');
    expect(displayValue({ observed: null })).toBe('');
  });

  it('offers candidates only for needs_review / no_option rows that have some', () => {
    const candidates = [{ label: '本科' }];
    expect(hasCandidateChoices(field('a', 'needs_review', { candidates }))).toBe(true);
    expect(hasCandidateChoices(field('a', 'no_option', { candidates }))).toBe(true);
    expect(hasCandidateChoices(field('a', 'filled', { candidates }))).toBe(false);
    expect(hasCandidateChoices(field('a', 'needs_review', { candidates: [] }))).toBe(false);
    expect(hasCandidateChoices(field('a', 'needs_review'))).toBe(false);
  });
});

describe('patchReport', () => {
  it('replaces the matching field (frame + id) and recounts', () => {
    const report: FillReport = {
      url: 'https://x.test',
      startedAt: 1,
      finishedAt: 2,
      fields: [field('a', 'needs_review', { frameId: 3 }), field('a', 'unmatched', { frameId: 0 })],
      counts: countOutcomes([]),
    };
    const next = patchReport(report, field('a', 'filled', { frameId: 3, value: '本科' }));
    expect(next.fields.map((f) => f.outcome)).toEqual(['filled', 'unmatched']);
    expect(next.counts.filled).toBe(1);
    expect(next.counts.unmatched).toBe(1);
    expect(fieldKey(next.fields[0]!)).toBe('3:a');
  });
});

describe('tab helpers', () => {
  it('parseTabIdOverride', () => {
    expect(parseTabIdOverride('?tabId=12')).toBe(12);
    expect(parseTabIdOverride('?x=1&tabId=0')).toBe(0);
    expect(parseTabIdOverride('?tabId=abc')).toBeNull();
    expect(parseTabIdOverride('?tabId=-1')).toBeNull();
    expect(parseTabIdOverride('')).toBeNull();
  });

  it('reportStorageKey / isFillReport', () => {
    expect(reportStorageKey(5)).toBe('report:5');
    expect(isFillReport({ fields: [] })).toBe(true);
    expect(isFillReport(null)).toBe(false);
    expect(isFillReport({ fields: 'x' })).toBe(false);
  });
});
