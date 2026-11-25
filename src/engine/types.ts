// Core engine types shared by discover / evidence / classify / plan / drivers / fill.
import type { FieldKey, SectionKey } from '../schema/fieldKeys';

export type { FieldKey, SectionKey };

export type ControlKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'file'
  | 'richtext'
  | 'cascader';

export type UiLib = 'native' | 'antd' | 'element' | 'aria' | 'search' | 'workday' | 'moka' | 'feishu' | 'beisen';

export interface OptionInfo {
  label: string;
  value?: string;
  disabled?: boolean;
}

export interface Control {
  /** Per-frame stable id for this page session: "c1", "c2", ... */
  id: string;
  /** Widget root (native element, or library container like .ant-select). */
  el: HTMLElement;
  kind: ControlKind;
  lib: UiLib;
  /** Native <input type>. */
  inputType?: string;
  multiple?: boolean;
  /** Statically known options (native select / radio group / checkbox group). */
  options?: OptionInfo[];
  dateGranularity?: 'day' | 'month' | 'year';
  /** A date picker that holds a start and an end in one field. */
  dateRange?: boolean;
  /** A question an adapter found outside any label. */
  questionText?: string;
  /** From an adapter: what this control is for, whatever else the page says about it. */
  fixedLabel?: string;
  /** From an adapter: the section this control is in, for a page whose heading the engine cannot see. */
  fixedSection?: { title: string; root: Element };
  /** Parts of a search box, named by an adapter. */
  search?: { within: string; option: string; picked?: string };
  /** Parts of a search-and-pick control, named by an adapter. */
  prompt?: { within: string; list: string; option: string; leaf: string; chosen: string };
}

export type EvidenceSource =
  | 'label-for'
  | 'label-wrap'
  | 'aria-labelledby'
  | 'aria-label'
  | 'legend'
  | 'table-header'
  | 'nearby-text'
  | 'fine-print'
  | 'placeholder'
  | 'title-attr'
  | 'name-id';

export const EVIDENCE_WEIGHTS: Record<EvidenceSource, number> = {
  'label-for': 1.0,
  'label-wrap': 1.0,
  'aria-labelledby': 0.95,
  'aria-label': 0.9,
  'table-header': 0.85,
  legend: 0.8,
  'nearby-text': 0.8,
  // Never names a field. It only ever stops one being filled.
  'fine-print': 0,
  placeholder: 0.7,
  'title-attr': 0.6,
  'name-id': 0.5,
};

export interface Evidence {
  source: EvidenceSource;
  text: string;
  weight: number;
}

export interface FieldGroup {
  key: string;
  index: number;
  root: Element;
}

export interface FieldContext {
  control: Control;
  /** Sorted by weight desc, de-duplicated by normalized text. */
  evidence: Evidence[];
  sectionTitle: string | null;
  /** Advice printed under the section's title, which can narrow it: 除英语外的其他外语能力. */
  sectionNote?: string;
  sectionRoot: Element | null;
  /** Repeated card ("第 N 段经历"). */
  group: FieldGroup | null;
  required: boolean;
}

export interface Classification {
  fieldKey: FieldKey | null;
  /** 0..1 */
  confidence: number;
  section: SectionKey | null;
  /** Top 3. */
  candidates: { fieldKey: FieldKey; confidence: number }[];
  /** Optional machine-readable reason, e.g. 'never_fill'. */
  reason?: string;
}

export type Outcome =
  | 'filled'
  | 'needs_review'
  | 'unmatched'
  | 'no_data'
  | 'no_control'
  | 'no_option'
  | 'action_failed';

export const OUTCOMES: Outcome[] = [
  'filled',
  'needs_review',
  'unmatched',
  'no_data',
  'no_control',
  'no_option',
  'action_failed',
];

export interface FieldReport {
  fieldId: string;
  frameId?: number;
  label: string;
  fieldKey: FieldKey | null;
  section: SectionKey | null;
  outcome: Outcome;
  confidence: number;
  /** Display value we intended to write. */
  value?: string;
  /** Read back after write. */
  observed?: string | null;
  /** Resume path, e.g. "education[1].school". */
  source?: string;
  candidates?: { label: string; value?: string; fieldKey?: FieldKey }[];
  /**
   * What the outcome does not say: why this row needs the user, or that its card was the page's own entry already.
   * `picked_other_name`: a search box held no option written as the resume writes it, and one under another name
   * was picked (`observed`); the user should confirm it is the same school.
   * `answer_held`: the box already held an answer of the applicant's own (`observed`), different from the resume's
   * (`value`), and was left as it is.
   * `sensitive_held`: a sensitive field the settings say to leave to the applicant. `sensitive_filled`: one they
   * said to fill, and it was.
   * `draft`: a long-text answer drafted from the resume (`value`), written only when the applicant says so.
   */
  note?: 'same_file_held' | 'entry_held' | 'answer_held' | 'picked_other_name' | 'sensitive_held' | 'sensitive_filled' | 'draft';
  /** Which entry of its section (0-based, in the resume's order for that section) this field belongs to. */
  entry?: number;
  /** How long filling this box took, in ms (rows the fill wrote to, or tried to). */
  ms?: number;
}

/** Where a fill's time went, in ms: adding cards, scanning and planning, waiting for an upload to be read, the boxes, entry editors. */
export interface FillTiming {
  cards: number;
  scan: number;
  uploadWait: number;
  steps: number;
  editors: number;
}

/**
 * What one fill did with one entry of a repeated section. `existing`: a card the page already had took it;
 * `added`: this fill added the card; `held`: the page already shows this entry, so it was left alone;
 * `skipped`: no card took it, for `reason`.
 */
export interface EntryProgress {
  section: SectionKey;
  /** 0-based, in the resume's order for the section. */
  index: number;
  state: 'existing' | 'added' | 'skipped' | 'held';
  reason?: 'no_button' | 'add_failed' | 'max_adds' | 'editor_held' | 'no_name' | 'nothing_to_fill';
  /** The entry's name in the resume: its school, company, project. */
  label?: string;
  /** Words of the add button that was pressed, for `add_failed`. */
  button?: string;
}

export interface FillReport {
  url: string;
  startedAt: number;
  finishedAt: number;
  fields: FieldReport[];
  counts: Record<Outcome, number>;
  /** Per entry of each repeated section this fill met. */
  entries?: EntryProgress[];
  /** Where the time went (absent in reports from older builds). */
  timing?: FillTiming;
}

export interface FillFilter {
  /** Field ids the user unchecked in previewBeforeFill. */
  excludedFieldIds?: string[];
  /** Per-field text overrides entered in previewBeforeFill. */
  overrides?: Record<string, string>;
  /**
   * Fill only these boxes, as they were planned (the side panel's retry): no cards are added, no entry editor is opened
   * and the report holds only their rows.
   */
  onlyFieldIds?: string[];
}

export interface PreviewItem {
  fieldId: string;
  frameId?: number;
  fieldKey: FieldKey;
  label: string;
  value: string;
  kind: string;
  confidence: number;
  source?: string;
  section: SectionKey | null;
}

export interface CardDemandSummary {
  section: SectionKey;
  have: number;
  need: number;
}

export interface FramePreview {
  url: string;
  items: PreviewItem[];
  cardDemand: CardDemandSummary[];
  unresolvedCount: number;
}

export interface FillPreview {
  tabId: number;
  url: string;
  createdAt: number;
  items: PreviewItem[];
  cardDemand: CardDemandSummary[];
  unresolvedCount: number;
}
