// Driver contract: every control driver implements fill + read with read-back verification.
import type { Control, ControlKind, OptionInfo, UiLib } from '../engine/types';

export type OptionMatch =
  | { status: 'matched'; index: number; confidence: number }
  /** Several equally good options: never pick, report needs_review. */
  | { status: 'ambiguous'; candidates: number[] }
  /** Nothing acceptable: report no_option. */
  | { status: 'none' };

export type OptionMatcher = (options: OptionInfo[]) => OptionMatch;

export interface FileData {
  name: string;
  type: string;
  dataUrl: string;
}

export interface DatePart {
  display: string;
  year: number;
  month: number;
  day?: number;
}

export type FillIntent =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; display: string; query: string; match: OptionMatcher }
  | { kind: 'multi'; display: string; items: { query: string; match: OptionMatcher }[] }
  | ({ kind: 'date' } & DatePart)
  /** Both ends of a span in one field. */
  | { kind: 'dateRange'; display: string; start: DatePart; end: DatePart }
  /** A span with no end yet, on a form with no word for that: the start goes in, and any old end comes out. */
  | { kind: 'dateFrom'; display: string; start: DatePart }
  /** e.g. ['浙江省', '杭州市', '西湖区'] */
  | { kind: 'cascade'; display: string; path: string[] }
  | { kind: 'check'; checked: boolean }
  | { kind: 'file'; file: FileData };

export interface DriverContext {
  doc: Document;
  attempt: 1 | 2;
  timeoutMs: number;
  /**
   * Fired by executeStep when this attempt ran out of time. Drivers should stop clicking and let their
   * waits end (`waitFor` takes it as `signal`); cleanup in `finally` still runs.
   */
  signal?: AbortSignal | undefined;
}

export interface FillResult {
  ok: boolean;
  observed: string | null;
  /** Set when !ok. */
  outcome?: 'no_option' | 'needs_review' | 'action_failed';
  candidates?: string[];
  detail?: string;
}

export interface Driver {
  id: string;
  lib: UiLib;
  kinds: ControlKind[];
  match(control: Control): boolean;
  fill(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult>;
  /** Human-readable current value, for read-back and the report. */
  read(control: Control): string | null;
}
