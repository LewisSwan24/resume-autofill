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

export type UiLib = 'native' | 'antd' | 'element' | 'aria' | 'search' | 'workday';

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
  /** A question an adapter found outside any label. */
  questionText?: string;
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
}

export interface FillReport {
  url: string;
  startedAt: number;
  finishedAt: number;
  fields: FieldReport[];
  counts: Record<Outcome, number>;
}
