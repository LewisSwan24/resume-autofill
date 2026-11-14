// The report sheet's data: rows in three groups, what needs the person first, plus the notes and the undo
// summary. Pure; labels are cut, never translated (the UI shows fab.item.unnamed for a null label).
import { isSectionRow } from '../../../../../src/background/merge';
import type { FillReport, Outcome } from '../../../../../src/engine/types';
import type { SectionKey } from '../../../../../src/schema/fieldKeys';
import { shortLabel } from '../../../../../src/fill/report';
import { sortBySeverity } from '../../../../../entrypoints/sidepanel/model';
import type { HandedOver } from './fillPlan';
import { rowKey, type UndoResult } from './fillRun';

export type GroupId = 'filled' | 'attention' | 'skipped';

export interface ReportRow {
  /** `${frame}:${fieldId}` */
  key: string;
  frame: number;
  fieldId: string;
  /** null → the UI shows fab.item.unnamed */
  label: string | null;
  sectionKey: SectionKey | null;
  outcome: Outcome;
  group: GroupId;
  /** filled / needs_review only */
  value: string | null;
  /** Not a section row and the frame is still registered. */
  focusable: boolean;
  undo: 'restored' | 'manual' | null;
}

export interface ReportModel {
  counts: Record<GroupId, number>;
  /** attention sorted by sortBySeverity, the others in report order */
  rows: Record<GroupId, ReportRow[]>;
  /** attention if it has rows, else filled */
  initialGroup: GroupId;
  unreachable: number;
  fallback: boolean;
  isolated: boolean | null;
  handedOver: HandedOver;
  undo: { restored: number; manual: ReportRow[]; addedCards: number } | null;
}

const GROUP: Readonly<Record<Outcome, GroupId>> = {
  filled: 'filled',
  needs_review: 'attention',
  no_option: 'attention',
  unmatched: 'attention',
  action_failed: 'attention',
  no_data: 'skipped',
  no_control: 'skipped',
};

export const groupOfOutcome = (outcome: Outcome): GroupId => GROUP[outcome];

export function buildReportModel(input: {
  report: FillReport;
  liveFrames: ReadonlySet<number>;
  unreachable: number;
  fallback: boolean;
  isolated: boolean | null;
  handedOver: HandedOver;
  undo: UndoResult | null;
}): ReportModel {
  const restored = new Set(input.undo?.restored ?? []);
  const manual = new Set(input.undo?.manual ?? []);
  const all: ReportRow[] = input.report.fields.map((f) => {
    const frame = f.frameId ?? 0;
    const key = rowKey(frame, f.fieldId);
    const label = shortLabel(f.label ?? '', 60);
    return {
      key,
      frame,
      fieldId: f.fieldId,
      label: label || null,
      sectionKey: f.section,
      outcome: f.outcome,
      group: GROUP[f.outcome],
      value: (f.outcome === 'filled' || f.outcome === 'needs_review') && f.value ? f.value : null,
      focusable: !isSectionRow(f.fieldId) && input.liveFrames.has(frame),
      undo: restored.has(key) ? 'restored' : manual.has(key) ? 'manual' : null,
    };
  });
  const rows: Record<GroupId, ReportRow[]> = {
    filled: all.filter((r) => r.group === 'filled'),
    attention: sortBySeverity(all.filter((r) => r.group === 'attention')),
    skipped: all.filter((r) => r.group === 'skipped'),
  };
  return {
    counts: { filled: rows.filled.length, attention: rows.attention.length, skipped: rows.skipped.length },
    rows,
    initialGroup: rows.attention.length > 0 ? 'attention' : 'filled',
    unreachable: input.unreachable,
    fallback: input.fallback,
    isolated: input.isolated,
    handedOver: input.handedOver,
    undo: input.undo
      ? { restored: all.filter((r) => r.undo === 'restored').length, manual: all.filter((r) => r.undo === 'manual'), addedCards: input.undo.addedCards }
      : null,
  };
}
