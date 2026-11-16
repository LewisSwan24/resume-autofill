import { describe, expect, it } from 'vitest';
import type { FieldReport, FillReport, Outcome } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { buildReportModel } from '../../../../mobile/app/src/browser/model/reportModel';
import type { HandedOver } from '../../../../mobile/app/src/browser/model/fillPlan';

const row = (frameId: number, fieldId: string, outcome: Outcome, over: Partial<FieldReport> = {}): FieldReport => ({
  fieldId,
  frameId,
  label: `字段 ${fieldId}`,
  fieldKey: null,
  section: null,
  outcome,
  confidence: 0.9,
  ...(outcome === 'filled' || outcome === 'needs_review' ? { value: '张三' } : {}),
  ...over,
});
const report = (fields: FieldReport[]): FillReport => ({ url: 'https://jobs.example.com/apply', startedAt: 1, finishedAt: 2, fields, counts: countOutcomes(fields) });
const handed: HandedOver = { fields: [], wholeSections: [], files: [], total: 0, otherSites: [] };
const base = { liveFrames: new Set([0, 1]), unreachable: 0, fallback: false, isolated: false, handedOver: handed, undo: null };

describe('buildReportModel', () => {
  const fields = [
    row(0, 'c1', 'filled'),
    row(0, 'c2', 'no_data'),
    row(0, 'c3', 'needs_review'),
    row(1, 'c1', 'action_failed'),
    row(0, 'c4', 'no_control'),
    row(0, 'c5', 'unmatched'),
    row(0, 'c6', 'no_option'),
  ];

  it('puts outcomes in three groups and sorts attention by severity', () => {
    const m = buildReportModel({ ...base, report: report(fields) });
    expect(m.counts).toEqual({ filled: 1, attention: 4, skipped: 2 });
    expect(m.rows.attention.map((r) => r.outcome)).toEqual(['action_failed', 'needs_review', 'no_option', 'unmatched']);
    expect(m.rows.skipped.map((r) => r.key)).toEqual(['0:c2', '0:c4']);
    expect(m.rows.filled[0]).toMatchObject({ key: '0:c1', frame: 0, fieldId: 'c1', value: '张三', group: 'filled', focusable: true, undo: null });
    expect(m.rows.skipped[0]!.value).toBeNull();
  });

  it('opens on attention when it has rows, else filled', () => {
    expect(buildReportModel({ ...base, report: report(fields) }).initialGroup).toBe('attention');
    expect(buildReportModel({ ...base, report: report([row(0, 'c1', 'filled'), row(0, 'c2', 'no_data')]) }).initialGroup).toBe('filled');
  });

  it('section rows and rows of frames no longer live are not focusable', () => {
    const m = buildReportModel({
      ...base,
      liveFrames: new Set([0]),
      report: report([row(0, 'section:education', 'action_failed', { section: 'education' }), row(1, 'c9', 'filled'), row(0, 'c1', 'filled')]),
    });
    expect(m.rows.attention[0]!.focusable).toBe(false);
    expect(m.rows.filled.find((r) => r.key === '1:c9')!.focusable).toBe(false);
    expect(m.rows.filled.find((r) => r.key === '0:c1')!.focusable).toBe(true);
  });

  it('empty labels become null; long labels are cut to 60 with …', () => {
    const m = buildReportModel({ ...base, report: report([row(0, 'c1', 'filled', { label: '   ' }), row(0, 'c2', 'filled', { label: 'x'.repeat(80) })]) });
    expect(m.rows.filled[0]!.label).toBeNull();
    expect(m.rows.filled[1]!.label).toHaveLength(60);
    expect(m.rows.filled[1]!.label!.endsWith('…')).toBe(true);
  });

  it('an undo result marks rows restored / manual and fills the undo summary', () => {
    const m = buildReportModel({
      ...base,
      report: report(fields),
      undo: { restored: ['0:c1'], manual: ['0:c3', '1:c1'], addedCards: 2 },
    });
    expect(m.rows.filled[0]!.undo).toBe('restored');
    expect(m.rows.attention.find((r) => r.key === '0:c3')!.undo).toBe('manual');
    expect(m.undo).toEqual({ restored: 1, manual: expect.any(Array), addedCards: 2 });
    expect(m.undo!.manual.map((r) => r.key).sort()).toEqual(['0:c3', '1:c1']);
  });

  it('passes notes through', () => {
    const m = buildReportModel({ ...base, report: report(fields), unreachable: 2, fallback: true, isolated: null });
    expect(m).toMatchObject({ unreachable: 2, fallback: true, isolated: null, handedOver: handed, undo: null });
  });
});
