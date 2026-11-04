// Loading and scoring of real-page samples in fixtures/captured/<ats>/<name>/ (never committed).
// A sample takes part once a hand-written expected.json sits next to the capture.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FillReport } from '../../src/engine/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CAPTURED_DIR = path.join(ROOT, 'fixtures', 'captured');
export const ACCURACY_FILE = path.join(ROOT, 'test-results', 'captured-accuracy.json');

export interface CapturedField {
  /** Finds the control(s); open shadow roots are searched too. */
  selector: string;
  /** Exact expected reading. Files and multi-checkboxes read as arrays. */
  expect?: unknown;
  /** Instead of `expect`, when the exact format is the site's business, e.g. a formatted phone number. */
  contains?: string;
  /**
   * Instead of `expect`, for what a site shows once it took the value. Some upload widgets remove the file
   * input and show progress instead, so `selector` names any element, not a control, and must match one.
   */
  exists?: true;
  /** Checked on the static snapshot: the classification this control must get. */
  fieldKey?: string;
}

export interface LocatedEntry {
  selector: string;
}

/** Keeps what the field should hold, so moving it back to `fields` is a small edit. */
export interface KnownGap extends CapturedField {
  reason: string;
  /** Answers come from a search service a replay does not have: a gap in a replay, a field on the live page. */
  live?: true;
}

export interface CapturedExpected {
  __resume: string;
  __adapter?: string;
  /** Must stay empty and be reported needs_review / no_option. The regex matches the report row's label. */
  __review?: Record<string, LocatedEntry & { labelRe: string }>;
  /** Report rows whose label matches may never be `filled`. */
  __traps?: string[];
  /** Not filled yet. They must stay empty and count as not correct. */
  __knownGaps?: Record<string, KnownGap>;
  /** Must equal the number of gaps: fixing one forces this number down, adding one needs a deliberate edit. */
  __knownGapsMax: number;
  fields: Record<string, CapturedField>;
}

export interface CapturedSample {
  ats: string;
  name: string;
  dir: string;
  url: string;
  expected: CapturedExpected;
}

/** Every sample with an expected.json. Captures without one are not ready yet and are left out. */
export function listSamples(root: string = CAPTURED_DIR): CapturedSample[] {
  if (!existsSync(root)) return [];
  const out: CapturedSample[] = [];
  for (const ats of readdirSync(root)) {
    const atsDir = path.join(root, ats);
    for (const name of existsSync(atsDir) ? readdirSync(atsDir) : []) {
      const dir = path.join(atsDir, name);
      const file = path.join(dir, 'expected.json');
      if (!existsSync(file)) continue;
      const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { url: string };
      out.push({ ats, name, dir, url: meta.url, expected: JSON.parse(readFileSync(file, 'utf8')) as CapturedExpected });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ scoring

export type Reading = string | boolean | string[] | null;

export interface ControlChange {
  key: string;
  before: string;
  after: string;
}

export interface Inspection {
  /** Control key → value, for every control on the page. */
  snapshot: Record<string, string>;
  /** Locator name → what the control holds now. Null: the selector found nothing. */
  readings: Record<string, Reading>;
  /** Locator name → the control keys its selector covers. */
  coverage: Record<string, string[]>;
}

export interface WrongField {
  label: string;
  expected: unknown;
  actual: Reading;
}

export interface SampleScore {
  sample: string;
  mode: string;
  fields: number;
  correct: number;
  /** Stayed empty although a value was expected. */
  missing: string[];
  /** Holds something else than expected. Never acceptable. */
  wrong: WrongField[];
  /** Changed although nothing in `fields` covers them. Never acceptable. */
  extras: ControlChange[];
  gaps: string[];
  /** Gaps counted as fields because this run was on the live page. */
  liveFields: number;
  /** A selector that no longer finds anything: the page changed or the sample is stale. */
  stale: string[];
  trapsFilled: string[];
  reviewProblems: string[];
  /** The report says filled but read nothing back. The report must not claim what it cannot see. */
  falselyFilled: string[];
  outcomes: FillReport['counts'];
}

export const isEmptyReading = (r: Reading): boolean => r === null || r === '' || r === false || (Array.isArray(r) && r.length === 0);

function matches(field: CapturedField, actual: Reading): boolean {
  if (field.exists) return actual === true;
  if (field.contains !== undefined) return typeof actual === 'string' && actual.includes(field.contains);
  return JSON.stringify(actual) === JSON.stringify(field.expect);
}

export function changedControls(before: Inspection['snapshot'], after: Inspection['snapshot']): ControlChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: ControlChange[] = [];
  for (const key of keys) {
    const b = before[key] ?? '';
    const a = after[key] ?? '';
    if (a !== b) out.push({ key, before: b, after: a });
  }
  return out;
}

export function scoreSample(
  sample: { ats: string; name: string; expected: CapturedExpected },
  mode: string,
  before: Inspection,
  after: Inspection,
  report: FillReport,
): SampleScore {
  const { expected } = sample;
  const missing: string[] = [];
  const wrong: WrongField[] = [];
  const stale: string[] = [];
  let correct = 0;

  const allGaps = Object.entries(expected.__knownGaps ?? {});
  const liveFields = mode === 'live' ? allGaps.filter(([, gap]) => gap.live) : [];
  const checked: Record<string, CapturedField> = { ...expected.fields, ...Object.fromEntries(liveFields) };

  for (const [label, field] of Object.entries(checked)) {
    const actual = after.readings[label] ?? null;
    if (matches(field, actual)) correct++;
    else if (isEmptyReading(actual)) missing.push(label);
    else wrong.push({ label, expected: field.contains ? `contains ${field.contains}` : field.expect, actual });
    if (!field.exists && (after.coverage[label] ?? []).length === 0) stale.push(label);
  }

  const covered = new Set(Object.keys(checked).flatMap((label) => after.coverage[label] ?? []));
  const extras = changedControls(before.snapshot, after.snapshot).filter((c) => !covered.has(c.key));

  const gaps = allGaps.filter(([label]) => !(label in checked)).map(([label]) => label);
  for (const label of [...gaps, ...Object.keys(expected.__review ?? {})]) {
    if ((after.coverage[label] ?? []).length === 0) stale.push(label);
  }

  const trapsFilled = (expected.__traps ?? []).flatMap((re) => {
    const regex = new RegExp(re, 'i');
    return report.fields.filter((f) => f.outcome === 'filled' && regex.test(f.label)).map((f) => f.label);
  });

  const reviewProblems = Object.entries(expected.__review ?? {}).flatMap(([label, entry]) => {
    const problems: string[] = [];
    if (!isEmptyReading(after.readings[label] ?? null)) problems.push(`${label}: not empty`);
    const regex = new RegExp(entry.labelRe, 'i');
    const row = report.fields.find((f) => regex.test(f.label));
    if (!row) problems.push(`${label}: no report row`);
    else if (row.outcome !== 'needs_review' && row.outcome !== 'no_option') problems.push(`${label}: reported ${row.outcome}`);
    return problems;
  });

  return {
    sample: `${sample.ats}/${sample.name}`,
    mode,
    fields: Object.keys(checked).length,
    liveFields: liveFields.length,
    correct,
    missing,
    wrong,
    extras,
    gaps,
    stale,
    trapsFilled,
    reviewProblems,
    falselyFilled: report.fields.filter((f) => f.outcome === 'filled' && !f.observed && !/^(true|false)$/.test(f.value ?? '')).map((f) => f.label),
    outcomes: report.counts,
  };
}

/** Everything that must be true for a sample to pass. Empty means it passed. */
export function scoreProblems(score: SampleScore, expected: CapturedExpected): string[] {
  const out: string[] = [];
  for (const w of score.wrong) out.push(`wrong ${w.label}: expected ${JSON.stringify(w.expected)}, got ${JSON.stringify(w.actual)}`);
  for (const c of score.extras) out.push(`unexpected change ${c.key}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  for (const label of score.missing) out.push(`missing ${label}`);
  for (const label of score.stale) out.push(`stale selector ${label}`);
  for (const label of score.trapsFilled) out.push(`trap filled: ${label}`);
  out.push(...score.reviewProblems);
  for (const label of score.falselyFilled) out.push(`reported filled with nothing read back: ${label}`);
  if (score.gaps.length + score.liveFields !== expected.__knownGapsMax) {
    out.push(`known gaps: ${score.gaps.length + score.liveFields}, but __knownGapsMax is ${expected.__knownGapsMax}. Gaps may only shrink, and the number moves with them`);
  }
  return out;
}

/** Gaps count against the sample: a field we cannot fill yet is not a correct field. */
export function accuracyOf(score: Pick<SampleScore, 'fields' | 'correct' | 'gaps'>): number {
  const total = score.fields + score.gaps.length;
  return total === 0 ? 0 : Math.round((1000 * score.correct) / total) / 10;
}

/** Merged by sample and mode: Playwright empties test-results at the start of a run. */
export function recordScore(score: SampleScore, file: string = ACCURACY_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  let rows: SampleScore[] = [];
  try {
    rows = JSON.parse(readFileSync(file, 'utf8')) as SampleScore[];
  } catch {
    /* first sample of the run */
  }
  rows = [...rows.filter((r) => r.sample !== score.sample || r.mode !== score.mode), score];
  writeFileSync(file, JSON.stringify(rows, null, 2));
}

/** The per-ATS table for the local acceptance report. */
export function renderAccuracyTable(rows: SampleScore[]): string {
  const sorted = [...rows].sort((a, b) => `${a.sample} ${a.mode}`.localeCompare(`${b.sample} ${b.mode}`));
  const lines = [
    '| 样本 | 运行方式 | 字段 | 填对 | 准确率 | 错填 | 漏填 | 已知缺口 | 待确认 | 操作失败 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...sorted.map((r) =>
      `| ${r.sample} | ${r.mode} | ${r.fields + r.gaps.length} | ${r.correct} | ${accuracyOf(r)}% | ${r.wrong.length + r.extras.length} | ${r.missing.length} | ${r.gaps.length} | ${r.outcomes.needs_review} | ${r.outcomes.action_failed} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** One line per sample and mode, printed by the specs and used for the accuracy table. */
export function scoreLine(score: SampleScore): string {
  return `[captured] ${score.sample} (${score.mode}): ${score.correct}/${score.fields + score.gaps.length} = ${accuracyOf(score)}%, wrong ${score.wrong.length + score.extras.length}, missing ${score.missing.length}, known gaps ${score.gaps.length}`;
}
