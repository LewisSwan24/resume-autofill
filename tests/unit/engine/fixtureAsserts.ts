// Shared helpers for the fixture classification tests: find a control by label, compare what the plan
// would write with the fixture's expected.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FillPlan } from '../../../src/engine/plan';
import type { ScanResult } from '../../../src/engine/scan';
import type { ControlKind, FieldKey, SectionKey } from '../../../src/engine/types';
import type { FillIntent } from '../../../src/drivers/types';

export interface Row {
  /** Key in the fixture's expected.json (omit for rows that are only classified). */
  state?: string;
  /** Text of one of the control's evidences (label / aria-label / placeholder / header / name). */
  label: string;
  section?: SectionKey;
  /** Disambiguates controls that share a label (phone number vs its country-code select). */
  kind?: ControlKind;
  /** Card / table row index. */
  index?: number;
  /** Expected field key (null → must stay untouched). */
  key: FieldKey | null;
  /** Options offered by the widget when the DOM does not list them (antd / Element dropdowns). */
  options?: string[];
}

const describeRow = (r: Row) => `${r.section ?? '*'}/${r.label}${r.index !== undefined ? `#${r.index}` : ''}`;

/** Index of the control a row talks about; throws unless exactly one control matches. */
export function locate(scan: ScanResult, row: Row): number {
  const hits: number[] = [];
  scan.contexts.forEach((ctx, i) => {
    if (!ctx.evidence.some((e) => e.text === row.label)) return;
    if (row.kind && ctx.control.kind !== row.kind) return;
    if (row.section && scan.classifications[i]!.section !== row.section) return;
    if (row.index !== undefined && ctx.group?.index !== row.index) return;
    hits.push(i);
  });
  if (hits.length !== 1) {
    throw new Error(`${hits.length} controls match ${describeRow(row)}: ${JSON.stringify(
      scan.contexts.map((c, i) => ({ i, ev: c.evidence[0]?.text, sec: scan.classifications[i]!.section, g: c.group?.index })),
    )}`);
  }
  return hits[0]!;
}

export type FixtureName = 'native' | 'antd' | 'element' | 'questions-zh' | 'questions-en' | 'languages-works';

export function loadExpected(fixture: FixtureName): Record<string, unknown> {
  const file = resolve(__dirname, '../../../fixtures/synthetic', fixture, 'expected.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** What the intent would leave in the field, comparable with an expected.json value. */
export function intendedValue(
  intent: FillIntent,
  control: ScanResult['contexts'][number]['control'],
  options?: string[],
): unknown {
  switch (intent.kind) {
    case 'text':
      return intent.text;
    case 'date':
      return intent.display;
    case 'check':
      return intent.checked;
    case 'cascade':
      return intent.path;
    case 'file':
      return [intent.file.name];
    case 'choice': {
      const infos = options ? options.map((label) => ({ label })) : (control.options ?? []);
      const m = intent.match(infos);
      return m.status === 'matched' ? infos[m.index]!.label : `<${m.status}>`;
    }
    case 'multi': {
      const infos = options ? options.map((label) => ({ label })) : (control.options ?? []);
      return intent.items.map((item) => {
        const m = item.match(infos);
        return m.status === 'matched' ? infos[m.index]!.label : `<${m.status}>`;
      });
    }
  }
}

export interface RowResult {
  row: Row;
  index: number;
  key: FieldKey | null;
  confidence: number;
  /** What the plan would write (undefined when no step). */
  value: unknown;
  outcome: 'step' | string;
}

/** Locate every row and join classification + plan result. */
export function evaluate(scan: ScanResult, plan: FillPlan, rows: Row[]): RowResult[] {
  return rows.map((row) => {
    const index = locate(scan, row);
    const ctx = scan.contexts[index]!;
    const cls = scan.classifications[index]!;
    const step = plan.steps.find((s) => s.fieldId === ctx.control.id);
    if (step) {
      return {
        row, index, key: cls.fieldKey, confidence: cls.confidence,
        value: intendedValue(step.intent, ctx.control, row.options), outcome: 'step',
      };
    }
    const report = plan.reports.find((r) => r.fieldId === ctx.control.id);
    // A row that must stay untouched only needs to end up without a step (a needs_review guess is fine).
    const key = row.key === null ? null : cls.fieldKey;
    return { row, index, key, confidence: cls.confidence, value: undefined, outcome: report?.outcome ?? 'missing' };
  });
}
