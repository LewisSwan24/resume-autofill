// runFill: scan → grow cards → re-scan → plan → execute steps one by one → merged report.
import { resolveAdapter } from '../adapters/resolve';
import type { HeldFile } from '../adapters/types';
import { registerAllDrivers } from '../drivers';
import { intentDisplay } from '../drivers/execute';
import type { FileData } from '../drivers/types';
import { waitFor } from '../drivers/wait';
import { baseReport, planFill, type CardDemand, type FillStep } from '../engine/plan';
import { scanDocument, type ScanResult } from '../engine/scan';
import type { Classification, Control, FieldContext, FieldReport, FillFilter, FillReport, FramePreview } from '../engine/types';
import { isVisible } from '../engine/visibility';
import type { Resume, SiteRecipe } from '../schema';
import type { MappingPresetId } from '../templates/presets';
import { ensureCards, type SectionGrowth } from './ensureCards';
import { fillEntryEditors } from './entryEditors';
import { heldEntries, placeInCard } from './heldEntries';
import { runStep } from './runStep';
import { applyHighlights } from './highlight';
import { countOutcomes } from './report';

export interface FillPayload {
  resume: Resume;
  files: Record<string, FileData>;
  presetId?: MappingPresetId;
  recipes?: SiteRecipe[];
}

export interface RunFillOptions {
  /** Keeps control ids stable across scans / runs (the content script owns a WeakMap). */
  idFor?: (el: HTMLElement) => string;
  /** Preview exclusions and value overrides chosen by the user. */
  filter?: FillFilter;
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

const UPLOAD_READ_MS = 15_000;
const UPLOAD_SIGN_MS = 300;

/**
 * Let a page finish reading an upload, since it may write over fields when it does. Gives up after a
 * while. Just after an upload of ours, the sign that it is reading may still be on its way.
 */
async function waitForUploadRead(doc: Document, busy: string, justUploaded: boolean, signMs = UPLOAD_SIGN_MS): Promise<void> {
  const showing = (): boolean => Array.from(doc.querySelectorAll(busy)).some((el) => isVisible(el));
  // One budget for both waits, so a sign that is slow to show cannot stretch the whole wait past the frame's.
  const until = performance.now() + UPLOAD_READ_MS;
  if (justUploaded) await waitFor(() => (showing() ? true : null), { timeout: signMs, root: doc });
  await waitFor(() => (showing() ? null : true), { timeout: Math.max(0, until - performance.now()), root: doc });
}

/** Looks in the largest box around this input that holds no other file input, so another slot's file does not count. */
function holdsFile(input: Element, held: HeldFile, name: string): boolean {
  let box: Element = input;
  while (box.parentElement && box.parentElement.querySelectorAll('input[type="file"]').length === 1) box = box.parentElement;
  return Array.from(box.querySelectorAll(held.selector)).some((el) => el.getAttribute(held.attribute) === held.prefix + name);
}

/** The file stays out: the page would keep its own copy, which may be older, and we would report it as filled. */
function heldFileReport(step: FillStep): FieldReport {
  return {
    fieldId: step.fieldId,
    label: step.label,
    fieldKey: step.fieldKey,
    section: step.section ?? null,
    outcome: 'needs_review',
    confidence: step.confidence,
    value: intentDisplay(step.intent),
    note: 'same_file_held',
    ...(step.source !== undefined ? { source: step.source } : {}),
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
 * The plan for the page as it is now, shared by the fill and its preview so both show the same cards. An editor that
 * is open is someone's own typing, not a card to fill (see fillEntryEditors). So is a card that already names its
 * entry: it is left alone and reported as such, and the resume's entries go to the empty cards.
 */
function planPage(doc: Document, scan: ScanResult, payload: FillPayload) {
  const { resume } = payload;
  const held = heldEntries(scan.contexts, scan.classifications, resume);
  const free: { ctx: FieldContext; cls: Classification }[] = [];
  const left: FieldReport[] = [];
  scan.contexts.forEach((ctx, i) => {
    if (ctx.control.fixedSection) return;
    const cls = scan.classifications[i]!;
    const placed = placeInCard(held, ctx);
    if (placed) free.push({ ctx: placed, cls });
    else left.push({ ...baseReport(ctx, cls, resume.locale), outcome: 'no_data', note: 'entry_held' });
  });
  const plan = planFill(
    free.map((f) => f.ctx),
    free.map((f) => f.cls),
    resume,
    payload.files,
    {
      ...(payload.presetId ? { presetId: payload.presetId } : {}),
      ...(payload.recipes ? { recipes: payload.recipes } : {}),
      ...(doc.title ? { pageTitle: doc.title } : {}),
      ...(doc.location?.href ? { pageUrl: doc.location.href } : {}),
    },
  );
  /** Cards per section as ensureCards counts them: one holding an entry the resume does not have takes none of its. */
  const cardDemand = (): CardDemand[] =>
    planFill(scan.contexts, scan.classifications, resume).cardDemand.map((d) => ({
      ...d,
      have: Math.max(0, d.have - (held.foreign.get(d.section) ?? 0)),
    }));
  return { plan, left, cardDemand };
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
  const adapter = resolveAdapter(doc);

  // Growing sections is best effort: when it throws, carry on with the cards the page already has.
  let growth: SectionGrowth[] = [];
  try {
    growth = await ensureCards(doc, resume, { idFor, skip: new Set(adapter?.editors?.map((e) => e.section)) });
  } catch (error) {
    console.warn('[runFill] ensureCards failed, continuing with the existing cards', error);
  }
  const scan: ScanResult = scanDocument(doc, idFor);
  const { plan, left } = planPage(doc, scan, payload);

  const controls = new Map<string, Control>();
  for (const ctx of scan.contexts) controls.set(ctx.control.id, ctx.control);

  const excluded = new Set(opts.filter?.excludedFieldIds ?? []);
  const overrides = opts.filter?.overrides ?? {};
  const plannedSteps = plan.steps
    .filter((s) => !excluded.has(s.fieldId))
    .map((s) =>
      Object.hasOwn(overrides, s.fieldId)
        ? { ...s, intent: { kind: 'text' as const, text: overrides[s.fieldId]! } }
        : s,
    );

  const results: FieldReport[] = [...plan.reports, ...left];
  // Files first: many forms read an uploaded resume and write over their fields with what they find.
  const steps = [...plannedSteps].sort((a, b) => Number(b.intent.kind === 'file') - Number(a.intent.kind === 'file'));
  const uploadBusy = adapter?.uploadBusy;
  let uploaded = false;
  // Only a resume the page took can start a read, so only then is the adapter's longer sign window worth waiting.
  let resumeTaken = false;
  let read = false;
  for (const step of steps) {
    const box = controls.get(step.fieldId)?.el;
    if (step.intent.kind === 'file' && box && adapter?.heldFile && holdsFile(box, adapter.heldFile, step.intent.file.name)) {
      results.push(heldFileReport(step));
      continue;
    }
    if (uploadBusy && !read && step.intent.kind !== 'file') {
      read = true;
      await waitForUploadRead(doc, uploadBusy, uploaded, resumeTaken ? adapter?.uploadSignMs : undefined);
    }
    if (step.intent.kind === 'file') uploaded = true;
    const result = await runStep(step, controls, doc);
    if (step.intent.kind === 'file' && step.fieldKey === 'attachments.resume' && result.outcome === 'filled') resumeTaken = true;
    results.push(result);
  }

  // After the rest of the page: on a page with `uploadBusy`, the upload has been read by now, and it may list entries.
  const editorRun = adapter?.editors?.length
    ? await fillEntryEditors(doc, adapter.editors, { resume, files, idFor })
    : null;
  if (editorRun) {
    results.push(...editorRun.results);
    growth = growth.concat(editorRun.growth);
    for (const [id, control] of editorRun.controls) controls.set(id, control);
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

/**
 * Dry-run preview: scan and plan without clicking add buttons, mutating DOM controls, or applying highlights.
 */
export function runPreview(doc: Document, payload: FillPayload, opts: Pick<RunFillOptions, 'idFor'> = {}): FramePreview {
  registerAllDrivers();
  const idFor = opts.idFor ?? makeIdFor();
  const scan = scanDocument(doc, idFor);
  const { plan, cardDemand } = planPage(doc, scan, payload);
  return {
    url: doc.location?.href ?? '',
    items: plan.steps.map((s) => ({
      fieldId: s.fieldId,
      fieldKey: s.fieldKey,
      label: s.label,
      value: intentDisplay(s.intent),
      kind: s.intent.kind,
      confidence: s.confidence,
      ...(s.source !== undefined ? { source: s.source } : {}),
      section: s.section ?? null,
    })),
    cardDemand: cardDemand().filter((d) => d.need > d.have).map(({ section, have, need }) => ({ section, have, need })),
    unresolvedCount: plan.reports.filter((r) => r.outcome === 'needs_review' || r.outcome === 'unmatched').length,
  };
}

/** Outline every field of a run by its outcome (content script helper). */
export function highlightRun(run: Pick<FillRun, 'report' | 'controls'>): void {
  const entries = run.report.fields.flatMap((f) => {
    const control = run.controls.get(f.fieldId);
    return control ? [{ el: control.el, outcome: f.outcome }] : [];
  });
  applyHighlights(entries);
}
