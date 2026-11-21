import { describe, expect, it } from 'vitest';
import type { FieldReport, FillReport, Outcome } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { buildReportModel, neighbour, position } from '../../../../mobile/app/src/browser/model/reportModel';
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

describe('buildReportModel – reasons, entries, notes', () => {
  const fields = [
    row(0, 'n1', 'filled', { section: 'basics', label: '姓名' }),
    row(0, 's1', 'needs_review', { section: 'education', entry: 0, note: 'picked_other_name', observed: '星河理工', label: '学校' }),
    row(0, 'id', 'needs_review', { section: 'basics', fieldKey: 'basics.idNumber', note: 'sensitive_held', label: '证件号码', value: undefined }),
    row(0, 'o1', 'no_option', { section: 'jobIntention', label: '期望城市' }),
    row(0, 'u1', 'unmatched', { section: 'other', label: '推荐人工号' }),
    row(0, 'd1', 'no_data', { section: 'basics', label: 'QQ' }),
    row(0, 'd2', 'no_data', { section: 'education', entry: 0, label: '专业排名' }),
    row(0, 'd3', 'no_data', { section: 'education', entry: 1, label: 'GPA' }),
    row(0, 'k1', 'no_control', { label: '附件说明' }),
    row(0, 'e1', 'filled', { section: 'education', entry: 0, label: '学校名称' }),
    row(0, 'e2', 'filled', { section: 'education', entry: 1, label: '学校名称' }),
  ];
  const entries = [
    { section: 'education' as const, index: 0, state: 'existing' as const, label: '星河示例理工大学' },
    { section: 'education' as const, index: 1, state: 'added' as const, label: '云岭示例大学' },
    { section: 'internship' as const, index: 0, state: 'skipped' as const, reason: 'no_button' as const, label: '示例科技有限公司' },
  ];
  const m = buildReportModel({ ...base, report: { ...report(fields), entries } });

  it('splits each tab into its reasons, in severity order, each with its rows', () => {
    expect(m.reasons.attention.map((g) => [g.outcome, g.rows.map((r) => r.fieldId)])).toEqual([
      ['needs_review', ['s1', 'id']],
      ['no_option', ['o1']],
      ['unmatched', ['u1']],
    ]);
    expect(m.reasons.skipped.map((g) => [g.outcome, g.rows.length])).toEqual([
      ['no_data', 3],
      ['no_control', 1],
    ]);
  });

  it('each row knows its entry (第 n 条, 1-based), its note, and the name a search box picked', () => {
    const byId = new Map(Object.values(m.rows).flat().map((r) => [r.fieldId, r]));
    expect(byId.get('s1')).toMatchObject({ entry: 1, note: 'picked_other_name', picked: '星河理工' });
    expect(byId.get('id')).toMatchObject({ entry: null, note: 'sensitive_held', picked: null });
    expect(byId.get('d3')!.entry).toBe(2);
  });

  it('lists the entries of each repeated section with their fields counted, in report order', () => {
    expect(m.entries.map((s) => [s.section, s.done, s.entries.length])).toEqual([
      ['education', 2, 2],
      ['internship', 0, 1],
    ]);
    const [first, second] = m.entries[0]!.entries;
    expect(first).toMatchObject({ index: 0, state: 'existing', label: '星河示例理工大学', filled: 1, review: 1, noData: 1 });
    expect(second).toMatchObject({ index: 1, state: 'added', filled: 1, noData: 1 });
  });

  it('counts sensitive fields held back, for the note under the tabs', () => {
    expect(m.sensitiveHeld).toBe(1);
  });
});

describe('neighbour', () => {
  const rows = [
    row(0, 'a', 'no_data'),
    row(9, 'gone', 'no_data'),
    row(0, 'b', 'no_data'),
    row(0, 'c', 'no_data'),
  ];
  const m = buildReportModel({ ...base, report: report(rows) });

  it('steps through the focusable rows of a tab, and says where it is', () => {
    expect(neighbour(m, 'skipped', '0:a', 1)).toEqual({ key: '0:b', position: 2, total: 3 });
    expect(neighbour(m, 'skipped', '0:c', -1)).toEqual({ key: '0:b', position: 2, total: 3 });
    expect(position(m, 'skipped', '0:c')).toEqual({ position: 3, total: 3 });
  });

  it('stops at the ends instead of wrapping', () => {
    expect(neighbour(m, 'skipped', '0:c', 1)).toBeNull();
    expect(neighbour(m, 'skipped', '0:a', -1)).toBeNull();
  });
});

describe('buildReportModel – entries the page already held', () => {
  it('leaves their rows to the entry line (as the extension card does): not counted, not listed as skipped', () => {
    const fields = [
      row(0, 'a', 'filled'),
      row(0, 'h1', 'no_data', { section: 'education', entry: 0, note: 'entry_held' }),
      row(0, 'h2', 'no_data', { section: 'education', entry: 0, note: 'entry_held' }),
      row(0, 'd', 'no_data'),
    ];
    const entries = [{ section: 'education' as const, index: 0, state: 'held' as const, label: '星河示例理工大学' }];
    const m = buildReportModel({ ...base, report: { ...report(fields), entries } });
    expect(m.counts).toEqual({ filled: 1, attention: 0, skipped: 1 });
    expect(m.rows.skipped.map((r) => r.fieldId)).toEqual(['d']);
    expect(m.entries[0]!.entries[0]).toMatchObject({ state: 'held', noData: 0 });
  });
});
