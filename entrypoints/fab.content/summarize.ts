// Pure summary formatter for the FAB card. Deliberately drops every resume value: the card only
// ever sees field labels and outcomes.
import type { FillReport, Outcome } from '../../src/engine/types';

/** Outcomes the card lists (in display order). `filled` is counted only; `no_control` is ignored. */
export type SummaryOutcome = Exclude<Outcome, 'filled' | 'no_control'>;

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
  /** Non-filled fields, ordered review → unrecognized → no data (stable within a group). */
  items: SummaryItem[];
}

/** List order by group: review (0) → unrecognized (1) → no data (2). */
const GROUP_RANK: Record<SummaryOutcome, number> = {
  needs_review: 0,
  no_option: 0,
  unmatched: 1,
  action_failed: 1,
  no_data: 2,
};

export function summarize(report: FillReport): FillSummary {
  const summary: FillSummary = { filled: 0, review: 0, unrecognized: 0, noData: 0, items: [] };
  for (const f of report.fields) {
    switch (f.outcome) {
      case 'filled':
        summary.filled++;
        continue;
      case 'needs_review':
      case 'no_option':
        summary.review++;
        break;
      case 'unmatched':
      case 'action_failed':
        summary.unrecognized++;
        break;
      case 'no_data':
        summary.noData++;
        break;
      default:
        continue; // no_control
    }
    summary.items.push({ fieldId: f.fieldId, frameId: f.frameId ?? 0, label: f.label.trim(), outcome: f.outcome });
  }
  // Array#sort is stable, so items of one group keep report order.
  summary.items.sort((a, b) => GROUP_RANK[a.outcome] - GROUP_RANK[b.outcome]);
  return summary;
}
