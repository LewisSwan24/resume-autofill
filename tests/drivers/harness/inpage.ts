// In-page helpers of the driver test harness. Everything here runs inside the fixture page (bundled
// into harness.js); only plain JSON crosses the Playwright boundary, so matchers are built here.
import { normalizeLabel } from '../../../src/dictionary/normalize';
import { discover } from '../../../src/engine/discover';
import { buildFieldContext } from '../../../src/engine/grouping';
import type { Control, FieldContext, FieldReport } from '../../../src/engine/types';
import { executeStep } from '../../../src/drivers/execute';
import type { FileData, FillIntent, OptionMatch } from '../../../src/drivers/types';
import type { OptionInfo } from '../../../src/engine/types';

/** Serializable counterpart of `FillIntent`: choice / multi matchers are described, not passed. */
export type OptionSpec = { matchLabel?: string };
interface DateJson {
  display: string;
  year: number;
  month: number;
  day?: number;
}

export type IntentJson =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; display: string; query: string; options?: OptionSpec; wider?: string[]; fallbacks?: string[] }
  | { kind: 'multi'; display: string; items: { query: string; options?: OptionSpec }[] }
  | { kind: 'date'; display: string; year: number; month: number; day?: number }
  | { kind: 'dateFrom'; display: string; start: DateJson }
  | { kind: 'dateRange'; display: string; start: DateJson; end: DateJson }
  | { kind: 'cascade'; display: string; path: string[] }
  | { kind: 'check'; checked: boolean }
  | { kind: 'file'; file: FileData };

export interface LocateOptions {
  /** Pick the n-th match (document order) instead of requiring a unique one. */
  nth?: number;
}

export interface Located {
  id: string;
  /** Best evidence text of the control (what the label was matched against). */
  label: string;
  kind: Control['kind'];
  lib: Control['lib'];
}

/** Controls from the most recent `locate`, by id. Ids are only stable until the next discover. */
const controls = new Map<string, { control: Control; ctx: FieldContext }>();

export function listLabels(doc: Document = document): string[] {
  return discover(doc).map((c) => `${c.id}:${c.kind}:${buildFieldContext(c).evidence[0]?.text ?? ''}`);
}

/** Discover + buildFieldContext; id of the control whose best evidence text normalizes to `label`. */
export function locate(label: string, opts: LocateOptions = {}, doc: Document = document): Located {
  const want = normalizeLabel(label);
  const all = discover(doc).map((control) => ({ control, ctx: buildFieldContext(control) }));
  controls.clear();
  for (const entry of all) controls.set(entry.control.id, entry);
  const hits = all.filter((e) => {
    const best = e.ctx.evidence[0];
    return !!best && normalizeLabel(best.text) === want;
  });
  const hit = opts.nth === undefined ? (hits.length === 1 ? hits[0] : undefined) : hits[opts.nth];
  if (!hit) {
    const seen = all.map((e) => `${e.control.id}:${e.control.kind}:"${e.ctx.evidence[0]?.text ?? ''}"`);
    const why = hits.length > 1 && opts.nth === undefined ? `${hits.length} matches (pass nth)` : 'no match';
    throw new Error(`locate("${label}"): ${why}. Controls: ${seen.join(' | ')}`);
  }
  return { id: hit.control.id, label: hit.ctx.evidence[0]!.text, kind: hit.control.kind, lib: hit.control.lib };
}

/** Exact normalized label equality: one hit → matched, several → ambiguous, none → none. */
export function exactLabelMatcher(wanted: string): (options: OptionInfo[]) => OptionMatch {
  const want = normalizeLabel(wanted);
  return (options) => {
    const hits = options.flatMap((o, i) => (!o.disabled && normalizeLabel(o.label) === want ? [i] : []));
    if (hits.length === 0) return { status: 'none' };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
    return { status: 'matched', index: hits[0]!, confidence: 1 };
  };
}

export function buildIntent(json: IntentJson): FillIntent {
  switch (json.kind) {
    case 'choice':
      return {
        kind: 'choice',
        display: json.display,
        query: json.query,
        match: exactLabelMatcher(json.options?.matchLabel ?? json.query),
        ...(json.wider ? { wider: json.wider.map((q) => ({ query: q, match: exactLabelMatcher(q) })) } : {}),
        ...(json.fallbacks ? { fallbacks: json.fallbacks.map((q) => ({ query: q, match: exactLabelMatcher(q) })) } : {}),
      };
    case 'multi':
      return {
        kind: 'multi',
        display: json.display,
        items: json.items.map((i) => ({ query: i.query, match: exactLabelMatcher(i.options?.matchLabel ?? i.query) })),
      };
    default:
      return json;
  }
}

/** Locate by label, then run the driver pipeline (`executeStep`) with a hand-built step. */
export async function execIntent(
  label: string,
  intent: IntentJson,
  opts: LocateOptions & { timeoutMs?: number } = {},
  doc: Document = document,
): Promise<FieldReport> {
  const found = locate(label, opts, doc);
  const { control } = controls.get(found.id)!;
  return executeStep(
    {
      fieldId: found.id,
      fieldKey: 'test.field',
      intent: buildIntent(intent),
      confidence: 1,
      label: found.label,
    },
    control,
    doc,
    opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs },
  );
}
