import { describe, expect, it } from 'vitest';
import { summarize } from '../../../entrypoints/fab.content/summarize';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';

const OUTCOMES: Outcome[] = ['filled', 'needs_review', 'unmatched', 'no_data', 'no_control', 'no_option', 'action_failed'];

function field(fieldId: string, outcome: Outcome, extra: Partial<FieldReport> = {}): FieldReport {
  return { fieldId, label: `label-${fieldId}`, fieldKey: null, section: null, outcome, confidence: 0.5, ...extra };
}

function report(fields: FieldReport[]): FillReport {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const f of fields) counts[f.outcome]++;
  return { url: 'https://example.test/', startedAt: 0, finishedAt: 1, fields, counts };
}

describe('summarize', () => {
  it('returns zero counts and no items for an empty report', () => {
    expect(summarize(report([]))).toEqual({ filled: 0, review: 0, unrecognized: 0, noData: 0, items: [] });
  });

  it('groups outcomes: review = needs_review + no_option, unrecognized = unmatched + action_failed', () => {
    const s = summarize(
      report([
        field('a', 'filled'),
        field('b', 'filled'),
        field('c', 'needs_review'),
        field('d', 'no_option'),
        field('e', 'unmatched'),
        field('f', 'action_failed'),
        field('g', 'no_data'),
      ]),
    );
    expect(s).toMatchObject({ filled: 2, review: 2, unrecognized: 2, noData: 1 });
  });

  it('lists only the fields that need a look (never filled, never no_data), review group first, stable within a group', () => {
    const s = summarize(
      report([
        field('1', 'no_data'),
        field('2', 'filled'),
        field('3', 'unmatched'),
        field('4', 'no_option'),
        field('5', 'needs_review'),
        field('6', 'action_failed'),
      ]),
    );
    expect(s.items.map((i) => i.fieldId)).toEqual(['4', '5', '3', '6']);
    expect(s.items.map((i) => i.outcome)).toEqual(['no_option', 'needs_review', 'unmatched', 'action_failed']);
    expect(s.noData).toBe(1); // counted for the sentence, not listed
  });

  it('carries label and frame id; a missing frame id defaults to the top frame (0)', () => {
    const s = summarize(
      report([
        field('x', 'needs_review', { label: '  学校  ', frameId: 3 }),
        field('y', 'unmatched', { label: '' }),
      ]),
    );
    expect(s.items).toEqual([
      { fieldId: 'x', frameId: 3, label: '学校', outcome: 'needs_review' },
      { fieldId: 'y', frameId: 0, label: '', outcome: 'unmatched' },
    ]);
  });

  it('ignores no_control (the control vanished; nothing the user can act on)', () => {
    const s = summarize(report([field('z', 'no_control'), field('w', 'filled')]));
    expect(s).toEqual({ filled: 1, review: 0, unrecognized: 0, noData: 0, items: [] });
  });

  it('counts from the field list, not from the (possibly stale) counts record', () => {
    const r = report([field('a', 'filled')]);
    r.counts.filled = 99;
    expect(summarize(r).filled).toBe(1);
  });

  it('does not expose resume values: items only contain id, frame, label and outcome', () => {
    const s = summarize(report([field('a', 'needs_review', { value: 'secret', observed: 'secret2', source: 'basics.email' })]));
    expect(Object.keys(s.items[0]!).sort()).toEqual(['fieldId', 'frameId', 'label', 'outcome']);
  });
});
