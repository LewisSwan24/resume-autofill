// runFill: scan → grow cards → re-scan → plan → execute steps one by one → merged report.
import { registerAllDrivers } from '../drivers';
import { executeStep, intentDisplay } from '../drivers/execute';
import type { FileData } from '../drivers/types';
import { planFill } from '../engine/plan';
import { scanDocument, type ScanResult } from '../engine/scan';
import type { Control, FieldReport, FillReport } from '../engine/types';
import type { Resume } from '../schema';
import { ensureCards, type SectionGrowth } from './ensureCards';
import { applyHighlights } from './highlight';
import { countOutcomes } from './report';

export interface FillPayload {
  resume: Resume;
  files: Record<string, FileData>;
}

export interface RunFillOptions {
  /** Keeps control ids stable across scans / runs (the content script owns a WeakMap). */
  idFor?: (el: HTMLElement) => string;
}

export interface FillRun {
  report: FillReport;
  /** fieldId → Control of the final scan (for highlight / focus / apply). */
  controls: Map<string, Control>;
  /** What ensureCards did per section (diagnostics). */
  growth: SectionGrowth[];
}

/** Id factory that stays stable for the elements it has seen: "c1", "c2", ... */
function makeIdFor(): (el: HTMLElement) => string {
  const ids = new WeakMap<HTMLElement, string>();
  let n = 0;
  return (el) => {
    let id = ids.get(el);
    if (!id) ids.set(el, (id = `c${++n}`));
    return id;
  };
}

/** Section-level failure rows: an add button was clicked but no card appeared. */
function growthReports(growth: SectionGrowth[]): FieldReport[] {
  return growth
    .filter((g) => g.status === 'action_failed')
    .map((g) => ({
      fieldId: `section:${g.section}`,
      label: g.label ?? g.section,
      fieldKey: null,
      section: g.section,
      outcome: 'action_failed' as const,
      confidence: 1,
    }));
}

/**
 * Fill the page with the resume. Never clicks submit / next buttons (only section add buttons).
 * Fields are filled strictly one after another; each result is read back from the page.
 */
export async function runFill(doc: Document, payload: FillPayload, opts: RunFillOptions = {}): Promise<FillRun> {
  registerAllDrivers();
  const startedAt = Date.now();
  const idFor = opts.idFor ?? makeIdFor();
  const { resume, files } = payload;

  // Growing sections is best effort: when it throws, carry on with the cards the page already has.
  let growth: SectionGrowth[] = [];
  try {
    growth = await ensureCards(doc, resume, { idFor });
  } catch (error) {
    console.warn('[runFill] ensureCards failed, continuing with the existing cards', error);
  }
  const scan: ScanResult = scanDocument(doc, idFor);
  const plan = planFill(scan.contexts, scan.classifications, resume, files);

  const controls = new Map<string, Control>();
  for (const ctx of scan.contexts) controls.set(ctx.control.id, ctx.control);

  const results: FieldReport[] = [...plan.reports];
  for (const step of plan.steps) {
    const control = controls.get(step.fieldId);
    if (!control) {
      results.push({
        fieldId: step.fieldId,
        label: step.label,
        fieldKey: step.fieldKey,
        section: step.section ?? null,
        outcome: 'no_control',
        confidence: step.confidence,
      });
      continue;
    }
    try {
      results.push(await executeStep(step, control, doc));
    } catch (error) {
      // executeStep reports its own failures; this is the last line of defence for the rest of the run.
      console.warn('[runFill] step failed unexpectedly', step.fieldId, error);
      results.push({
        fieldId: step.fieldId,
        label: step.label,
        fieldKey: step.fieldKey,
        section: step.section ?? null,
        outcome: 'action_failed',
        confidence: step.confidence,
        value: intentDisplay(step.intent),
        ...(step.source !== undefined ? { source: step.source } : {}),
      });
    }
  }

  // Document order of the controls; section-level rows last.
  const order = new Map<string, number>();
  scan.contexts.forEach((ctx, i) => order.set(ctx.control.id, i));
  const rank = (r: FieldReport) => order.get(r.fieldId) ?? Number.MAX_SAFE_INTEGER;
  const fields = [...results].sort((a, b) => rank(a) - rank(b)).concat(growthReports(growth));

  const report: FillReport = {
    url: doc.location?.href ?? '',
    startedAt,
    finishedAt: Date.now(),
    fields,
    counts: countOutcomes(fields),
  };
  return { report, controls, growth };
}

/** Outline every field of a run by its outcome (content script helper). */
export function highlightRun(run: Pick<FillRun, 'report' | 'controls'>): void {
  const entries = run.report.fields.flatMap((f) => {
    const control = run.controls.get(f.fieldId);
    return control ? [{ el: control.el, outcome: f.outcome }] : [];
  });
  applyHighlights(entries);
}
