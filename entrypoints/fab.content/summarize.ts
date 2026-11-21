// Pure summary formatter for the FAB card: field labels, outcomes, where each field sits (section, entry), the
// entries of repeated sections, and the site's own option text where a search box picked another name. Resume values
// that the page does not already show stay out, as do resume paths.
import type { EntryProgress, FieldReport, FillReport, Outcome, SectionKey } from '../../src/engine/types';
import { isVisible } from '../../src/engine/visibility';
import { countEntries, type EntryCounts } from '../../src/ui/entryText';
import { groupOf } from '../../src/ui/status';

const BOXES = 'input:not([type=hidden], [type=checkbox], [type=radio], [type=file], [type=submit], [type=button], [type=reset], [type=image]), select, textarea';
/** Fewer boxes than this and a low count means little: a search bar and a sign-up strip. */
const MIN_BOXES_TO_JUDGE = 6;

/** What the page has for typing into or picking from. */
export function countBoxes(doc: Document): number {
  return Array.from(doc.querySelectorAll<HTMLInputElement>(BOXES)).filter((el) => !el.disabled && isVisible(el)).length;
}

/**
 * Nearly all of the page went unread: a form this tool does not know yet, which a bare count would hide. A known
 * form can show a third of its boxes here (7 of 22 on one) and still fill them all: this count is taken before
 * a site's own rules apply, and leaves out questions nothing on a resume answers.
 */
export const looksUnderRead = (read: number, boxes: number): boolean => boxes >= MIN_BOXES_TO_JUDGE && read * 4 < boxes;

/** Outcomes the card lists as rows. `filled` is counted only, `no_control` is ignored. */
export type SummaryOutcome = Exclude<Outcome, 'filled' | 'no_control'>;

/** The card's groups of rows, by reason, in display order. */
export type SummaryGroupId = 'review' | 'no_option' | 'failed' | 'nodata';

export interface SummaryItem {
  fieldId: string;
  /** Frame the field lives in; reports from the top frame may omit it → 0. */
  frameId: number;
  label: string;
  outcome: SummaryOutcome;
  section: SectionKey | null;
  /** 0-based entry of a repeated section, which tells apart two fields of the same name. */
  entry?: number;
  note?: FieldReport['note'];
  /** The site's option a search box picked under another name than the resume's (already shown on the page). */
  picked?: string;
}

export interface SummaryGroup {
  id: SummaryGroupId;
  items: SummaryItem[];
}

/** One entry of a repeated section, with its fields counted by outcome. */
export type EntrySummary = EntryProgress & EntryCounts;

export interface FillSummary {
  filled: number;
  /** needs_review + no_option */
  review: number;
  /** unmatched + action_failed */
  unrecognized: number;
  /** no_data */
  noData: number;
  /** Fields not filled, by reason; only groups that hold a row. A card the page already held is left to its entry. */
  groups: SummaryGroup[];
  /** Entries of the repeated sections this fill met, in the report's order. */
  entries: EntrySummary[];
  /** First no_data field in page order that names a resume field: where "Add them to your profile" jumps. A path, never a value. */
  firstMissing?: { fieldKey: string; source?: string };
}

const GROUP_OF: Record<SummaryOutcome, SummaryGroupId> = {
  needs_review: 'review',
  no_option: 'no_option',
  unmatched: 'failed',
  action_failed: 'failed',
  no_data: 'nodata',
};
const GROUP_ORDER: readonly SummaryGroupId[] = ['review', 'no_option', 'failed', 'nodata'];

function itemOf(f: FieldReport): SummaryItem {
  const item: SummaryItem = {
    fieldId: f.fieldId,
    frameId: f.frameId ?? 0,
    label: f.label.trim(),
    outcome: f.outcome as SummaryOutcome,
    section: f.section,
  };
  if (f.entry !== undefined) item.entry = f.entry;
  if (f.note) item.note = f.note;
  if (f.note === 'picked_other_name' && f.observed) item.picked = f.observed;
  return item;
}

export function summarize(report: FillReport): FillSummary {
  const summary: FillSummary = { filled: 0, review: 0, unrecognized: 0, noData: 0, groups: [], entries: [] };
  const rows = new Map<SummaryGroupId, SummaryItem[]>();
  for (const f of report.fields) {
    const group = groupOf(f.outcome);
    if (group === 'filled') summary.filled++;
    else if (group === 'review') summary.review++;
    else if (group === 'failed') summary.unrecognized++;
    else if (f.outcome === 'no_data') {
      summary.noData++;
      if (!summary.firstMissing && f.fieldKey) summary.firstMissing = f.source ? { fieldKey: f.fieldKey, source: f.source } : { fieldKey: f.fieldKey };
    }
    if (f.outcome === 'filled' || f.outcome === 'no_control' || f.note === 'entry_held') continue;
    const id = GROUP_OF[f.outcome as SummaryOutcome];
    let list = rows.get(id);
    if (!list) rows.set(id, (list = []));
    list.push(itemOf(f));
  }
  summary.groups = GROUP_ORDER.flatMap((id) => (rows.has(id) ? [{ id, items: rows.get(id)! }] : []));
  summary.entries = countEntries(report.entries ?? [], report.fields);
  return summary;
}
