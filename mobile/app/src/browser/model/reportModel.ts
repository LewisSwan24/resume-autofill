// The report sheet's data: rows in three groups, each split by reason, what needs the person first, the entries of
// repeated sections, plus the notes and the undo summary. Pure; labels are cut, never translated (the UI shows
// fab.item.unnamed for a null label).
import { isSectionRow } from '../../../../../src/background/merge';
import type { FieldReport, FillReport, Outcome } from '../../../../../src/engine/types';
import type { SectionKey } from '../../../../../src/schema/fieldKeys';
import { shortLabel } from '../../../../../src/fill/report';
import { severity, sortBySeverity } from '../../../../../entrypoints/sidepanel/model';
import { countEntries, type EntryCounts } from '../../../../../src/ui/entryText';
import type { EntryProgress } from '../../../../../src/engine/types';
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
  /** 1-based entry of a repeated section (第 n 条); null outside one. */
  entry: number | null;
  note: FieldReport['note'] | null;
  /** The site's option a search box picked under another name than the resume's (already shown on the page). */
  picked: string | null;
}

/** The rows of one tab that share a reason (outcome). */
export interface ReasonGroup {
  outcome: Outcome;
  rows: ReportRow[];
}

/** The entries of one repeated section; `done` counts those the page now has (new, already there, or held). */
export interface EntrySection {
  section: SectionKey;
  done: number;
  entries: Array<EntryProgress & EntryCounts>;
}

export interface ReportModel {
  counts: Record<GroupId, number>;
  /** attention sorted by sortBySeverity, the others in report order */
  rows: Record<GroupId, ReportRow[]>;
  /** Each tab's rows by reason, the reasons in severity order (the attention rows above, regrouped). */
  reasons: Record<GroupId, ReasonGroup[]>;
  /** Repeated sections this fill met, in the report's order. */
  entries: EntrySection[];
  /** Sensitive fields the settings held back (「只提醒」). */
  sensitiveHeld: number;
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
  // A card the page already had is left to its entry line (as on the extension's card): its fields are not rows.
  const all: ReportRow[] = input.report.fields.filter((f) => f.note !== 'entry_held').map((f) => {
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
      entry: f.entry !== undefined ? f.entry + 1 : null,
      note: f.note ?? null,
      picked: f.note === 'picked_other_name' && f.observed ? f.observed : null,
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
    reasons: { filled: byReason(rows.filled), attention: byReason(rows.attention), skipped: byReason(rows.skipped) },
    entries: entrySections(countEntries(input.report.entries ?? [], input.report.fields)),
    sensitiveHeld: all.filter((r) => r.note === 'sensitive_held').length,
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

/** Rows grouped by outcome, the most severe outcome first; rows keep their order within a group. */
function byReason(rows: readonly ReportRow[]): ReasonGroup[] {
  const groups = new Map<Outcome, ReportRow[]>();
  for (const r of rows) {
    const list = groups.get(r.outcome);
    if (list) list.push(r);
    else groups.set(r.outcome, [r]);
  }
  return [...groups].sort(([a], [b]) => severity(a) - severity(b)).map(([outcome, list]) => ({ outcome, rows: list }));
}

function entrySections(entries: Array<EntryProgress & EntryCounts>): EntrySection[] {
  const out: EntrySection[] = [];
  for (const e of entries) {
    let section = out.find((s) => s.section === e.section);
    if (!section) out.push((section = { section: e.section, done: 0, entries: [] }));
    section.entries.push(e);
    if (e.state !== 'skipped') section.done++;
  }
  return out;
}

/** Rows of a tab the locate bar steps through: the focusable ones, in the order the tab shows them. */
function steppable(model: ReportModel, group: GroupId): ReportRow[] {
  return model.reasons[group].flatMap((g) => g.rows).filter((r) => r.focusable);
}

/** Where a row sits among the tab's focusable rows (1-based), or null when it is not one of them. */
export function position(model: ReportModel, group: GroupId, key: string): { position: number; total: number } | null {
  const list = steppable(model, group);
  const at = list.findIndex((r) => r.key === key);
  return at < 0 ? null : { position: at + 1, total: list.length };
}

/** The row before (-1) or after (1) this one in the tab, or null at either end. */
export function neighbour(model: ReportModel, group: GroupId, key: string, dir: -1 | 1): { key: string; position: number; total: number } | null {
  const list = steppable(model, group);
  const at = list.findIndex((r) => r.key === key);
  const next = at < 0 ? undefined : list[at + dir];
  return next ? { key: next.key, position: at + dir + 1, total: list.length } : null;
}
