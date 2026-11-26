// Why each control on a sample page was or was not filled. Accuracy only judges the fields a sample expects; this
// sorts the rest too, so the fields still to be built can be counted and ranked across every sample.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FillReport, Outcome } from '../../src/engine/types';
import { rowsOf, squashLabel, type CapturedExpected, type SampleScore } from './capturedExpectations.ts';

// Not from capturedExpectations, which imports this module: its constants are not set yet while this one loads.
export const TRIAGE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/captured-triage.json');

/**
 * Hand-given on an entry with no field key, which the report cannot sort. `keep`: right to leave empty for good
 * (consent, a legal statement, the applicant's own earlier answer, a robot trap). `no_field`: a common question no
 * resume field answers yet. `site_own`: about this company or job alone, which no general resume can answer.
 */
export type TriageTag = 'keep' | 'no_field' | 'site_own';

/**
 * `filled` / `missing`: a field the sample expects, right or not. `no_value`: a field the resume has but the sample
 * resume leaves empty. `no_dictionary`: a known field the fill did not recognise. `no_driver`: recognised, with a
 * value, yet no option fitted or the control did not take it. `orphan`: an unfilled report row that no entry covers and that names no field.
 */
export type Triage = 'filled' | 'missing' | 'needs_review' | TriageTag | 'no_value' | 'no_dictionary' | 'no_driver' | 'untagged' | 'orphan';

export const TRIAGES: Triage[] = ['filled', 'missing', 'needs_review', 'keep', 'site_own', 'no_field', 'no_value', 'no_dictionary', 'no_driver', 'untagged', 'orphan'];

export type TriageCounts = Partial<Record<Triage, number>>;

export interface TriageRow {
  sample: string;
  /** The entry's label in expected.json, or the report's label for an orphan. */
  label: string;
  kind: 'field' | 'review' | 'gap' | 'leaveEmpty' | 'orphan';
  triage: Triage;
  /** The first report row's outcome for the control; `none` when the report has no row for it. */
  outcome: Outcome | 'none';
  fieldKey?: string;
}

const DRIVER: Outcome[] = ['no_option', 'action_failed', 'no_control'];

/** A control the sample names a field for but leaves empty, sorted by what the report did with it. */
function byReport(rows: FillReport['fields'], fieldKey: string): Triage {
  if (rows.some((r) => r.fieldKey === fieldKey && r.outcome === 'no_data')) return 'no_value';
  if (rows.some((r) => DRIVER.includes(r.outcome))) return 'no_driver';
  if (rows.some((r) => r.outcome === 'needs_review')) return 'needs_review';
  return 'no_dictionary';
}

/** Leave-empty entries and gaps that neither name a field nor carry a triage tag. */
export function untaggedEntries(expected: CapturedExpected): string[] {
  const entries = [...Object.entries(expected.__knownGaps ?? {}), ...Object.entries(expected.__leaveEmpty ?? {})];
  return entries.filter(([, e]) => !e.fieldKey && !e.triage).map(([label]) => label);
}

export function triageSample(
  sample: { ats: string; name: string; expected: CapturedExpected },
  score: Pick<SampleScore, 'missing' | 'wrong'>,
  report: FillReport,
): TriageRow[] {
  const { expected } = sample;
  const name = `${sample.ats}/${sample.name}`;
  const used = new Set<FillReport['fields'][number]>();
  const take = (rows: FillReport['fields']): FillReport['fields'] => {
    for (const r of rows) used.add(r);
    return rows;
  };
  const row = (label: string, kind: TriageRow['kind'], triage: Triage, rows: FillReport['fields'], fieldKey?: string): TriageRow => ({
    sample: name,
    label,
    kind,
    triage,
    outcome: rows[0]?.outcome ?? 'none',
    ...(fieldKey ? { fieldKey } : {}),
  });
  const notRight = new Set([...score.missing, ...score.wrong.map((w) => w.label)]);
  const out: TriageRow[] = [];

  for (const [label, f] of Object.entries(expected.fields)) {
    out.push(row(label, 'field', notRight.has(label) ? 'missing' : 'filled', take(rowsOf(report, label, f.fieldKey)), f.fieldKey));
  }
  for (const [label, e] of Object.entries(expected.__review ?? {})) {
    const re = new RegExp(e.labelRe, 'i');
    out.push(row(label, 'review', 'needs_review', take(report.fields.filter((f) => re.test(f.label)))));
  }
  const sorted = (kind: 'gap' | 'leaveEmpty', entries: [string, { fieldKey?: string; triage?: TriageTag; labelRe?: string }][]): void => {
    for (const [label, e] of entries) {
      const named = e.labelRe ? new RegExp(e.labelRe, 'i') : null;
      // Its own rows by label first: a row of the same field may be another control's, like the main resume box's.
      const own = [...rowsOf(report, label), ...(named ? report.fields.filter((f) => named.test(f.label)) : [])];
      const rows = take(own.length || !e.fieldKey ? own : report.fields.filter((f) => f.fieldKey === e.fieldKey && !used.has(f)));
      out.push(row(label, kind, e.triage ?? (e.fieldKey ? byReport(rows, e.fieldKey) : 'untagged'), rows, e.fieldKey));
    }
  };
  sorted('gap', Object.entries(expected.__knownGaps ?? {}));
  sorted('leaveEmpty', Object.entries(expected.__leaveEmpty ?? {}));
  for (const label of Object.keys(expected.__pageOwn ?? {})) take(rowsOf(report, label));

  for (const f of report.fields) {
    // A field the sample never judged, mostly on a card the fill added: its row says what happened.
    if (f.outcome !== 'filled' && !used.has(f)) out.push(row(f.label, 'orphan', f.fieldKey ? byReport([f], f.fieldKey) : 'orphan', [f], f.fieldKey ?? undefined));
  }
  return out;
}

export function triageCounts(rows: TriageRow[]): TriageCounts {
  const counts: TriageCounts = {};
  for (const r of rows) counts[r.triage] = (counts[r.triage] ?? 0) + 1;
  return counts;
}

/** Controls a resume could answer are all but the deliberately empty and the site's own; orphans are report rows. */
export function coverageOf(counts: TriageCounts): { controls: number; answerable: number; rate: number; actionable: number } {
  const n = (t: Triage): number => counts[t] ?? 0;
  const controls = TRIAGES.filter((t) => t !== 'orphan').reduce((sum, t) => sum + n(t), 0);
  const answerable = controls - n('keep') - n('site_own');
  // What a later version can still win: a field to add, a word to teach, a driver to fix, a value the sample lacks.
  const actionable = n('no_field') + n('no_dictionary') + n('no_driver') + n('no_value');
  return { controls, answerable, rate: answerable === 0 ? 0 : Math.round((1000 * n('filled')) / answerable) / 10, actionable };
}

/** Merged by sample: Playwright empties test-results at the start of a run. */
export function recordTriage(sample: string, rows: TriageRow[], file: string = TRIAGE_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  let saved: TriageRow[] = [];
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')) as TriageRow[];
  } catch {
    /* first sample of the run */
  }
  writeFileSync(file, JSON.stringify([...saved.filter((r) => r.sample !== sample), ...rows], null, 2));
}

export const TRIAGE_NAMES: Record<Triage, string> = {
  filled: '已填',
  missing: '漏填',
  needs_review: '待确认',
  keep: '该留空',
  site_own: '站点自己的题',
  no_field: '缺字段',
  no_value: '缺值',
  no_dictionary: '缺词典',
  no_driver: '缺驱动',
  untagged: '未标',
  orphan: '未归类',
};

/** Not work: filled, or right to stay empty. */
const DONE: Triage[] = ['filled', 'keep'];

/**
 * The totals, then the work list: every control not filled nor deliberately empty, grouped by its label across
 * samples and ranked by how many ask it. Untagged entries and orphans are named last, since each must be fixed.
 */
export function renderTriage(rows: TriageRow[]): string {
  const counts = triageCounts(rows);
  const cov = coverageOf(counts);
  const totals = [
    '| 归类 | 格数 |',
    '|---|---:|',
    ...TRIAGES.filter((t) => counts[t]).map((t) => `| ${TRIAGE_NAMES[t]} | ${counts[t]} |`),
  ];

  const groups = new Map<string, TriageRow[]>();
  for (const r of rows) {
    if (DONE.includes(r.triage) || r.triage === 'orphan') continue;
    const key = `${squashLabel(r.label)}\u0000${r.triage}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const work = [...groups.values()]
    .sort((a, b) => b.length - a.length || squashLabel(a[0]!.label).localeCompare(squashLabel(b[0]!.label)))
    .map((g) => {
      const outcomes = [...new Set(g.map((r) => r.outcome))].join('、');
      const keys = [...new Set(g.flatMap((r) => (r.fieldKey ? [r.fieldKey] : [])))].join('、') || '—';
      const samples = [...new Set(g.map((r) => r.sample))].join('、');
      return `| ${g[0]!.label} | ${g.length} | ${TRIAGE_NAMES[g[0]!.triage]} | ${outcomes} | ${keys} | ${samples} |`;
    });

  const named = (t: Triage): string[] => rows.filter((r) => r.triage === t).map((r) => `- ${r.sample}：${r.label}`);
  return [
    `页面栏位 ${cov.controls}，可答 ${cov.answerable}，已填 ${counts.filled ?? 0}，覆盖率 ${cov.rate}%。`,
    '',
    ...totals,
    '',
    '## 工作清单',
    '',
    '| 题目 | 样本数 | 归类 | 报告结果 | 字段 | 样本 |',
    '|---|---:|---|---|---|---|',
    ...work,
    '',
    `## 未归类（${counts.orphan ?? 0}）`,
    '',
    ...named('orphan'),
    '',
    `## 未标（${counts.untagged ?? 0}）`,
    '',
    ...named('untagged'),
    '',
  ].join('\n');
}
