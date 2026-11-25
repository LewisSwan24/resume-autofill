// runFill: scan → grow cards → re-scan → plan → execute steps one by one → merged report.
import { resolveAdapter } from '../adapters/resolve';
import type { HeldFile } from '../adapters/types';
import { registerAllDrivers } from '../drivers';
import { intentDisplay, valuesEquivalent } from '../drivers/execute';
import { getDriver } from '../drivers/registry';
import type { FileData, FillIntent } from '../drivers/types';
import { waitFor } from '../drivers/wait';
import { baseReport, planFill, type CardDemand, type FillStep } from '../engine/plan';
import { scanDocument, type ScanResult } from '../engine/scan';
import type { Classification, Control, FieldContext, FieldKey, FieldReport, FillFilter, FillReport, FramePreview } from '../engine/types';
import { isVisible } from '../engine/visibility';
import { jobContextOf } from '../answers';
import type { AnswerTemplates, Resume, SiteRecipe } from '../schema';
import { isSensitiveFieldKey, type SensitiveFieldMode } from '../schema/sensitive';
import type { MappingPresetId } from '../templates/presets';
import { ensureCards, REPEATED, type SectionGrowth } from './ensureCards';
import { fillEntryEditors } from './entryEditors';
import { entriesInPlace } from './entryProgress';
import { entryName, heldEntries, placeInCard } from './heldEntries';
import { runStep } from './runStep';
import { applyHighlights } from './highlight';
import { countOutcomes, emptyTiming } from './report';

export interface FillPayload {
  resume: Resume;
  files: Record<string, FileData>;
  presetId?: MappingPresetId;
  recipes?: SiteRecipe[];
  /** settings.sensitiveFields. Absent: the default, remind. */
  sensitiveFields?: SensitiveFieldMode;
  /** settings.answerTemplates: the applicant's own long-text templates. Absent: the defaults. */
  answerTemplates?: AnswerTemplates;
}

export interface RunFillOptions {
  /** Keeps control ids stable across scans / runs (the content script owns a WeakMap). */
  idFor?: (el: HTMLElement) => string;
  /** Preview exclusions and value overrides chosen by the user. */
  filter?: FillFilter;
  /** Called as the fill goes on (a card added, a box done, an upload read): it is still at work. */
  onProgress?: () => void;
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

/** A box that already held an answer of its own: left as it is, with the resume's value beside it to compare. */
function heldAnswerReport(step: FillStep, answer: string): FieldReport {
  return { ...heldFileReport(step), observed: answer, note: 'answer_held' };
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
  /** fieldId → the entry of its repeated section a field is filled from. */
  const entryOf = new Map<string, number>();
  scan.contexts.forEach((ctx, i) => {
    if (ctx.control.fixedSection) return;
    const cls = scan.classifications[i]!;
    const placed = placeInCard(held, ctx);
    const repeated = cls.section !== null && REPEATED.has(cls.section);
    if (placed) {
      free.push({ ctx: placed, cls });
      // A section with no grouped cards is one card, which the plan fills from the first entry.
      if (repeated) entryOf.set(ctx.control.id, placed.group?.index ?? 0);
      return;
    }
    const shows = ctx.group ? held.shows.get(ctx.group.key)?.get(ctx.group.index) : undefined;
    left.push({
      ...baseReport(ctx, cls, resume.locale),
      outcome: 'no_data',
      note: 'entry_held',
      ...(repeated && shows !== undefined ? { entry: shows } : {}),
    });
  });
  const plan = planFill(
    free.map((f) => f.ctx),
    free.map((f) => f.cls),
    resume,
    payload.files,
    {
      ...(payload.presetId ? { presetId: payload.presetId } : {}),
      ...(payload.recipes ? { recipes: payload.recipes } : {}),
      ...(payload.sensitiveFields ? { sensitiveFields: payload.sensitiveFields } : {}),
      ...(payload.answerTemplates ? { answerTemplates: payload.answerTemplates } : {}),
      job: jobContextOf(doc),
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
  return { plan, left, cardDemand, entryOf, shown: held.shown };
}

/** Kinds whose answer a person typed or picked: a radio can start on a default nobody chose. */
const TYPED_KINDS: ReadonlySet<Control['kind']> = new Set<Control['kind']>(['text', 'textarea', 'date']);
/**
 * Lists, kept only when drawn by a library: those show nothing until someone picks. A plain <select> shows its first
 * option before anyone picks one.
 */
const PICKED_KINDS: ReadonlySet<Control['kind']> = new Set<Control['kind']>(['select', 'cascader']);
const holdsAnAnswer = (control: Control): boolean =>
  TYPED_KINDS.has(control.kind) || (PICKED_KINDS.has(control.kind) && control.lib !== 'native');

/**
 * What a site writes into a fresh form by itself: the account's name and contact details, or a place it guessed from
 * where the browser is. Not the applicant's answer to this form, so the resume's goes in over it.
 */
const BROUGHT_BY_THE_SITE: ReadonlySet<FieldKey> = new Set<FieldKey>([
  'basics.fullName',
  'basics.familyName',
  'basics.givenName',
  'basics.englishName',
  'basics.currentLocation',
]);
const broughtByTheSite = (key: FieldKey): boolean => key.startsWith('contact.') || BROUGHT_BY_THE_SITE.has(key);

/**
 * Whether what a box holds is the resume's answer already: the same words, or the option the resume's answer picks
 * from a list (fluent is 无障碍沟通 on Feishu's).
 */
export function sameAnswer(intent: FillIntent, answer: string): boolean {
  if (valuesEquivalent(intentDisplay(intent), answer)) return true;
  // A library writes a path or a set of picks in its own way: 浙江省 / 杭州市, 深圳, 杭州.
  if (intent.kind === 'cascade') return joined(intent.path) === joined(pieces(answer));
  if (intent.kind === 'multi') {
    const held = pieces(answer);
    const wanted = intent.items.map((i) => i.query.trim());
    return held.length === wanted.length && wanted.every((w) => held.includes(w));
  }
  return intent.kind === 'choice' && intent.match([{ label: answer }]).status === 'matched';
}

const pieces = (text: string): string[] => text.split(/\s*[/／>›,，、;；]\s*/).map((p) => p.trim()).filter(Boolean);
const joined = (parts: readonly string[]): string => parts.map((p) => p.replace(/\s+/g, '')).join('');

/** What a box the applicant types, picks a date or an option in already holds, as its driver reads it; null when empty. */
function heldAnswer(control: Control | undefined): string | null {
  if (!control || !holdsAnAnswer(control)) return null;
  try {
    const text = getDriver(control)?.read(control)?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
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

  // Where the time goes: each lap adds the time since the last one to a phase.
  const timing = emptyTiming();
  let mark = performance.now();
  const lap = (phase: keyof typeof timing): void => {
    const now = performance.now();
    timing[phase] += Math.round(now - mark);
    mark = now;
  };
  // A retry of some boxes leaves the page's cards as they are.
  const only = opts.filter?.onlyFieldIds ? new Set(opts.filter.onlyFieldIds) : null;
  // Growing sections is best effort: when it throws, carry on with the cards the page already has.
  let growth: SectionGrowth[] = [];
  if (!only) {
    try {
      growth = await ensureCards(doc, resume, {
        idFor,
        skip: new Set(adapter?.editors?.map((e) => e.section)),
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      });
    } catch (error) {
      console.warn('[runFill] ensureCards failed, continuing with the existing cards', error);
    }
  }
  lap('cards');
  const scan: ScanResult = scanDocument(doc, idFor);
  const { plan, left, entryOf, shown } = planPage(doc, scan, payload);

  const controls = new Map<string, Control>();
  for (const ctx of scan.contexts) controls.set(ctx.control.id, ctx.control);

  const excluded = new Set(opts.filter?.excludedFieldIds ?? []);
  const overrides = opts.filter?.overrides ?? {};
  const plannedSteps = plan.steps
    .filter((s) => !excluded.has(s.fieldId) && (!only || only.has(s.fieldId)))
    .map((s) =>
      Object.hasOwn(overrides, s.fieldId)
        ? { ...s, intent: { kind: 'text' as const, text: overrides[s.fieldId]! } }
        : s,
    );

  lap('scan');
  // Read before anything is written: a page that reads an uploaded resume writes its own answers in a moment.
  const held = new Map<string, string>();
  for (const step of plannedSteps) {
    const answer = Object.hasOwn(overrides, step.fieldId) || broughtByTheSite(step.fieldKey) ? null : heldAnswer(controls.get(step.fieldId));
    if (answer !== null) held.set(step.fieldId, answer);
  }

  const results: FieldReport[] = [...plan.reports, ...left].filter((r) => !only || only.has(r.fieldId));
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
      lap('steps');
      await waitForUploadRead(doc, uploadBusy, uploaded, resumeTaken ? adapter?.uploadSignMs : undefined);
      lap('uploadWait');
      opts.onProgress?.();
    }
    // The page opened with an answer of the applicant's own (a form kept from an earlier application): theirs to change.
    const answer = held.get(step.fieldId);
    if (answer !== undefined && !sameAnswer(step.intent, answer)) {
      results.push(heldAnswerReport(step, answer));
      continue;
    }
    if (step.intent.kind === 'file') uploaded = true;
    const started = performance.now();
    const result = { ...(await runStep(step, controls, doc)), ms: Math.round(performance.now() - started) };
    opts.onProgress?.();
    if (step.intent.kind === 'file' && step.fieldKey === 'attachments.resume' && result.outcome === 'filled') resumeTaken = true;
    // Filled because the applicant chose to: the row still says it was a sensitive field.
    results.push(result.outcome === 'filled' && isSensitiveFieldKey(step.fieldKey) ? { ...result, note: 'sensitive_filled' } : result);
  }

  // Each row says which entry of its section it belongs to, and each entry what became of it.
  for (const [i, r] of results.entries()) {
    const entry = entryOf.get(r.fieldId);
    if (entry !== undefined && r.entry === undefined) results[i] = { ...r, entry };
  }
  const hasInternshipSection = scan.classifications.some((c) => c.section === 'internship');
  const entries = entriesInPlace(growth, results, shown, (section, index) => entryName(resume, section, index, hasInternshipSection));

  lap('steps');
  // After the rest of the page: on a page with `uploadBusy`, the upload has been read by now, and it may list entries.
  const editorRun = !only && adapter?.editors?.length
    ? await fillEntryEditors(doc, adapter.editors, { resume, files, idFor })
    : null;
  if (editorRun) {
    results.push(...editorRun.results);
    growth = growth.concat(editorRun.growth);
    entries.push(...editorRun.entries);
    for (const [id, control] of editorRun.controls) controls.set(id, control);
  }

  lap('editors');
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
    ...(entries.length > 0 && !only ? { entries } : {}),
    timing,
  };
  return { report, controls, growth };
}

/**
 * Fill one box with the resume's answer for the key the applicant chose for it (the side panel's "fill this one" and
 * "use selected"). Nothing else on the page is touched. The applicant chose this box and this key, so a sensitive key is
 * filled and an answer the box holds is written over; a long-text key still comes back as a draft to read first.
 */
export async function fillOneField(
  doc: Document,
  payload: FillPayload,
  fieldId: string,
  fieldKey: FieldKey,
  opts: Pick<RunFillOptions, 'idFor'> = {},
): Promise<{ report: FieldReport; control?: Control }> {
  registerAllDrivers();
  const idFor = opts.idFor ?? makeIdFor();
  const scan = scanDocument(doc, idFor);
  const i = scan.contexts.findIndex((c) => c.control.id === fieldId);
  if (i < 0) return { report: { fieldId, label: fieldId, fieldKey, section: null, outcome: 'no_control', confidence: 1 } };
  const ctx = scan.contexts[i]!;
  // A box never filled (a password, a captcha, fine print) stays so, whatever was chosen for it.
  const cls: Classification = { ...scan.classifications[i]!, fieldKey, confidence: 1 };
  const plan = planFill([ctx], [cls], payload.resume, payload.files, {
    sensitiveFields: 'fill',
    ...(payload.answerTemplates ? { answerTemplates: payload.answerTemplates } : {}),
    job: jobContextOf(doc),
    ...(doc.title ? { pageTitle: doc.title } : {}),
  });
  const step = plan.steps[0];
  const control = ctx.control;
  if (!step) return { report: plan.reports[0] ?? { ...baseReport(ctx, cls, payload.resume.locale), outcome: 'no_data' }, control };
  const result = await runStep(step, new Map([[control.id, control]]), doc);
  const report = result.outcome === 'filled' && isSensitiveFieldKey(fieldKey) ? { ...result, note: 'sensitive_filled' as const } : result;
  return { report, control };
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
