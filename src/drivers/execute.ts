// Execute one planned fill step: pick the driver, try (at most) twice, read back, build the report.
import type { Control, FieldKey, FieldReport, SectionKey } from '../engine/types';
import { querySelectorDeep } from '../engine/shadow';
import { slotOf, type Slot } from './slot';
import { closeDropdown } from './dropdown';
import { valuesEquivalent } from './equivalence';
import { getDriver } from './registry';
import type { Driver, FillIntent, FillResult } from './types';

export { valuesEquivalent } from './equivalence';

export interface FillStep {
  fieldId: string;
  fieldKey: FieldKey;
  intent: FillIntent;
  confidence: number;
  /** Resume path, e.g. "education[1].school". */
  source?: string;
  /** Human label of the field, for the report. */
  label: string;
  section?: SectionKey | null;
}

/** Names a site may list under its own wording (a short form, a campus): a pick under another name is the user's to confirm. */
const NAMES_PICKED_FROM_A_LIST: ReadonlySet<FieldKey> = new Set<FieldKey>(['education.school', 'education.schoolEn', 'education.major']);

/** The control offers a list to pick from, rather than taking what is typed. */
const picksFromList = (control: Control): boolean =>
  Boolean(control.search || control.prompt) || control.kind === 'select' || control.kind === 'cascader';

export interface ExecuteOptions {
  /** Per-attempt budget in ms. Default 4000. */
  timeoutMs?: number;
  /** Driver lookup override (tests). */
  resolveDriver?: (control: Control) => Driver | null;
  /**
   * After a timeout the attempt is aborted (`ctx.signal`); how long to wait for it to settle before
   * the open dropdown is closed and the next attempt starts. Default 1500.
   */
  graceMs?: number;
}

export const DEFAULT_STEP_TIMEOUT_MS = 4000;
export const DEFAULT_ABORT_GRACE_MS = 1500;

/** Text shown in the report for what we intended to write. */
export function intentDisplay(intent: FillIntent): string {
  switch (intent.kind) {
    case 'text':
      return intent.text;
    case 'check':
      return String(intent.checked);
    case 'file':
      return intent.file.name;
    default:
      return intent.display;
  }
}

const TIMED_OUT = Symbol('timeout');

const failure = (error: unknown): FillResult => ({
  ok: false,
  observed: null,
  outcome: 'action_failed',
  detail: error instanceof Error ? error.message : String(error),
});

/** `p`'s result if it settles within `ms`, else undefined. `p` never rejects. */
function settledWithin(p: Promise<FillResult>, ms: number): Promise<FillResult | undefined> {
  return new Promise<FillResult | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then((r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/**
 * One attempt. On timeout the driver is told to stop (`ctx.signal`), given `graceMs` to settle (its own
 * `finally` closes what it opened) and any dropdown still open is closed — so the next attempt (or step)
 * never runs concurrently with a leftover one.
 */
async function attempt(
  driver: Driver,
  control: Control,
  intent: FillIntent,
  doc: Document,
  n: 1 | 2,
  timeoutMs: number,
  graceMs: number,
): Promise<FillResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  const running: Promise<FillResult> = (async () =>
    driver.fill(control, intent, { doc, attempt: n, timeoutMs, signal: controller.signal }))().catch(failure);
  try {
    const result = await Promise.race([running, timeout]);
    if (result !== TIMED_OUT) return result;
    controller.abort();
    const late = await settledWithin(running, graceMs);
    try {
      closeDropdown(doc);
    } catch {
      /* best effort */
    }
    // A driver that ignored the signal and still verified its write succeeded after all.
    if (late?.ok) return late;
    return { ok: false, observed: null, outcome: 'action_failed', detail: `timed out after ${timeoutMs} ms` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Some pages rebuild a field when it is left: a new element with the same id, or one in the same place.
 * Point the control at it. Whether it kept the value is for the caller to check.
 */
function followRebuilt(control: Control, doc: Document, slot: Slot | null): void {
  const old = control.el;
  if (old.isConnected) return;
  const escapedId = old.id ? (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(old.id) : old.id.replace(/["\\]/g, '\\$&')) : '';
  const next = old.id
    ? (doc.getElementById(old.id) ?? (escapedId ? (querySelectorDeep(doc, `#${escapedId}`) as HTMLElement | null) : null))
    : null;
  if (next && next.tagName === old.tagName && next.getAttribute('type') === old.getAttribute('type')) {
    control.el = next;
    return;
  }
  const inPlace = slot?.find();
  if (inPlace) control.el = inPlace;
}

function safeRead(driver: Driver, control: Control): string | null {
  try {
    return driver.read(control);
  } catch {
    return null;
  }
}

/**
 * Drive one control. Terminal driver outcomes (`no_option`, `needs_review`) are returned as-is;
 * a plain failure or `action_failed` earns one more attempt (attempt: 2 selects the driver's
 * alternative strategy). Steps are meant to be awaited one after another by the caller.
 * Never throws: driver lookup / matching errors are reported as `action_failed`.
 */
export async function executeStep(
  step: FillStep,
  control: Control,
  doc: Document,
  opts: ExecuteOptions = {},
): Promise<FieldReport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const graceMs = opts.graceMs ?? DEFAULT_ABORT_GRACE_MS;
  const report: FieldReport = {
    fieldId: step.fieldId,
    label: step.label,
    fieldKey: step.fieldKey,
    section: step.section ?? null,
    outcome: 'no_control',
    confidence: step.confidence,
    value: intentDisplay(step.intent),
  };
  if (step.source !== undefined) report.source = step.source;

  try {
    const driver = (opts.resolveDriver ?? getDriver)(control);
    if (!driver) return report;

    followRebuilt(control, doc, null);
    const before = control.el;
    // A checkbox or radio is read through the inputs found on the scan, and a file box may go once it has its file.
    const slot = control.kind === 'text' || control.kind === 'textarea' || control.kind === 'select' ? slotOf(before) : null;
    let result = await attempt(driver, control, step.intent, doc, 1, timeoutMs, graceMs);
    const terminal = result.outcome === 'no_option' || result.outcome === 'needs_review';
    if (!result.ok && !terminal) {
      followRebuilt(control, doc, slot);
      result = await attempt(driver, control, step.intent, doc, 2, timeoutMs, graceMs);
    }

    followRebuilt(control, doc, slot);
    // What the driver saw on the old element says nothing about the new one.
    report.observed = safeRead(driver, control) ?? (before === control.el ? result.observed : null);
    // What was written has to be what the new element came back with.
    const rebuiltOther = before !== control.el && !valuesEquivalent(result.observed ?? '', report.observed);
    // A widget can accept a write and wipe it a moment later. Empty means unchecked for a checkbox, not a loss.
    const lostWrite = result.ok && step.intent.kind !== 'check' && !report.observed;
    // The page re-rendered and dropped the control. A file box may go on purpose once it has its file.
    const leftPage = result.ok && step.intent.kind !== 'file' && !control.el.isConnected;
    if (lostWrite || leftPage || (result.ok && rebuiltOther)) {
      report.outcome = 'action_failed';
    } else if (result.ok) {
      report.outcome = 'filled';
      const wanted = report.value ?? '';
      if (
        NAMES_PICKED_FROM_A_LIST.has(step.fieldKey) &&
        picksFromList(control) &&
        wanted !== '' &&
        report.observed &&
        !valuesEquivalent(wanted, report.observed)
      ) {
        report.outcome = 'needs_review';
        report.note = 'picked_other_name';
      }
    } else {
      report.outcome = result.outcome ?? 'action_failed';
      if (result.candidates && result.candidates.length > 0) {
        report.candidates = result.candidates.map((label) => ({ label }));
      }
    }
  } catch {
    report.outcome = 'action_failed';
  }
  return report;
}