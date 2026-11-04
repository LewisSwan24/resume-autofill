import { describe, expect, it } from 'vitest';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';
import { emptyCounts } from '../../../src/fill/report';
import {
  isFillReport,
  isSectionRow,
  mergeFrameReports,
  patchReportField,
} from '../../../src/background/merge';

const field = (fieldId: string, outcome: Outcome, extra: Partial<FieldReport> = {}): FieldReport => ({
  fieldId,
  label: `label ${fieldId}`,
  fieldKey: 'basics.email',
  section: 'basics',
  outcome,
  confidence: 0.9,
  ...extra,
});

const report = (url: string, fields: FieldReport[], startedAt = 10, finishedAt = 20): FillReport => ({
  url,
  startedAt,
  finishedAt,
  fields,
  counts: { ...emptyCounts() },
});

describe('mergeFrameReports', () => {
  it('sets frameId on every row, keeps field ids unprefixed and recomputes counts', () => {
    const top = report('https://jobs.example/apply', [field('c1', 'filled'), field('c2', 'needs_review')], 100, 200);
    const sub = report('https://forms.example/embed', [field('c1', 'filled'), field('c2', 'unmatched')], 90, 300);

    const merged = mergeFrameReports([
      { frameId: 0, report: top },
      { frameId: 7, report: sub },
    ]);

    expect(merged.fields.map((f) => [f.frameId, f.fieldId])).toEqual([
      [0, 'c1'],
      [0, 'c2'],
      [7, 'c1'],
      [7, 'c2'],
    ]);
    expect(merged.counts).toEqual({ ...emptyCounts(), filled: 2, needs_review: 1, unmatched: 1 });
    expect(merged.url).toBe('https://jobs.example/apply');
    expect(merged.startedAt).toBe(90);
    expect(merged.finishedAt).toBe(300);
  });

  it('uses the top frame url even when it is not first, and tolerates an empty list', () => {
    const merged = mergeFrameReports([
      { frameId: 3, report: report('https://sub', [field('c1', 'filled')]) },
      { frameId: 0, report: report('https://top', []) },
    ]);
    expect(merged.url).toBe('https://top');
    const empty = mergeFrameReports([]);
    expect(empty.fields).toEqual([]);
    expect(empty.counts).toEqual(emptyCounts());
  });

  it('does not mutate the per-frame reports', () => {
    const input = report('u', [field('c1', 'filled')]);
    mergeFrameReports([{ frameId: 2, report: input }]);
    expect(input.fields[0]!.frameId).toBeUndefined();
  });

  it('keeps section-level rows, which have no control', () => {
    const merged = mergeFrameReports([
      { frameId: 0, report: report('u', [field('section:education', 'action_failed', { fieldKey: null })]) },
    ]);
    expect(merged.counts.action_failed).toBe(1);
    expect(isSectionRow(merged.fields[0]!.fieldId)).toBe(true);
    expect(isSectionRow('c1')).toBe(false);
  });
});

describe('patchReportField', () => {
  it('keeps the reason a row needs the user until the row is filled', () => {
    const held = mergeFrameReports([{ frameId: 0, report: report('u', [field('c1', 'needs_review', { note: 'same_file_held' })]) }]);
    expect(patchReportField(held, 0, field('c1', 'action_failed')).fields[0]!.note).toBe('same_file_held');
    expect(patchReportField(held, 0, field('c1', 'filled')).fields[0]!.note).toBeUndefined();
  });

  const base = mergeFrameReports([
    { frameId: 0, report: report('u', [field('c1', 'needs_review', { candidates: [{ label: 'A' }], source: 'basics.email' })]) },
    { frameId: 4, report: report('u', [field('c1', 'unmatched')]) },
  ]);

  it('patches only the row of the given frame and recomputes counts', () => {
    const next = patchReportField(base, 4, field('c1', 'filled', { value: 'x' }));
    expect(next.fields.map((f) => f.outcome)).toEqual(['needs_review', 'filled']);
    expect(next.fields[1]!.frameId).toBe(4);
    expect(next.counts).toMatchObject({ filled: 1, needs_review: 1, unmatched: 0 });
  });

  it('replaces stale optional keys but falls back to stored label / key / section / source', () => {
    const answer: FieldReport = { fieldId: 'c1', label: '', fieldKey: null, section: null, outcome: 'filled', confidence: 1 };
    const next = patchReportField(base, 0, answer);
    const row = next.fields[0]!;
    expect(row.candidates).toBeUndefined();
    expect(row.label).toBe('label c1');
    expect(row.fieldKey).toBe('basics.email');
    expect(row.section).toBe('basics');
    expect(row.source).toBe('basics.email');
    expect(row.outcome).toBe('filled');
  });

  it('returns the same report for an unknown row', () => {
    expect(patchReportField(base, 9, field('c1', 'filled'))).toBe(base);
    expect(patchReportField(base, 0, field('nope', 'filled'))).toBe(base);
  });

  it('treats rows without frameId as frame 0', () => {
    const legacy = report('u', [field('c1', 'unmatched')]);
    expect(patchReportField(legacy, 0, field('c1', 'filled')).fields[0]!.outcome).toBe('filled');
  });
});

describe('isFillReport', () => {
  it('accepts reports and rejects junk', () => {
    expect(isFillReport(report('u', [field('c1', 'filled')]))).toBe(true);
    expect(isFillReport(undefined)).toBe(false);
    expect(isFillReport({ fields: [{ nope: 1 }] })).toBe(false);
    expect(isFillReport({})).toBe(false);
  });
});
