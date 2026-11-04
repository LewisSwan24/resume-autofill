// Pure summary formatter for the FAB card. Deliberately drops every resume value: the card only
// ever sees field labels and outcomes.
import type { FillReport, Outcome } from '../../src/engine/types';
import { groupOf } from '../../src/ui/status';

/** Outcomes the card lists as rows. `filled` and `no_data` are counted only (no_data has no action: one sentence), `no_control` is ignored. */
export type SummaryOutcome = Exclude<Outcome, 'filled' | 'no_data' | 'no_control'>;

export interface SummaryItem {
  fieldId: string;
  /** Frame the field lives in; reports from the top frame may omit it → 0. */
  frameId: number;
  label: string;
  outcome: SummaryOutcome;
}

export interface FillSummary {
  filled: number;
  /** needs_review + no_option */
  review: number;
  /** unmatched + action_failed */
  unrecognized: number;
  /** no_data */
  noData: number;
  /** Fields that need a look (review group, then unrecognized group); never filled and never no_data. */
  items: SummaryItem[];
}

/** List order by tone group: review first, then not filled (`Array#sort` is stable, so report order holds within a group). */
const GROUP_RANK: Record<SummaryOutcome, number> = {
  needs_review: 0,
  no_option: 0,
  unmatched: 1,
  action_failed: 1,
};

export function summarize(report: FillReport): FillSummary {
  const summary: FillSummary = { filled: 0, review: 0, unrecognized: 0, noData: 0, items: [] };
  for (const f of report.fields) {
    const group = groupOf(f.outcome);
    if (group === 'filled') summary.filled++;
    else if (group === 'review') summary.review++;
    else if (group === 'failed') summary.unrecognized++;
    else if (f.outcome === 'no_data') summary.noData++;
    if (group !== 'review' && group !== 'failed') continue; // filled / no data (counted) / no_control (ignored)
    summary.items.push({ fieldId: f.fieldId, frameId: f.frameId ?? 0, label: f.label.trim(), outcome: f.outcome as SummaryOutcome });
  }
  summary.items.sort((a, b) => GROUP_RANK[a.outcome] - GROUP_RANK[b.outcome]);
  return summary;
}
