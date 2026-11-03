// Execute one planned fill step: pick the driver, try (at most) twice, read back, build the report.
import type { Control, FieldKey, FieldReport, SectionKey } from '../engine/types';
import { closeDropdown } from './dropdown';
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

    let result = await attempt(driver, control, step.intent, doc, 1, timeoutMs, graceMs);
    const terminal = result.outcome === 'no_option' || result.outcome === 'needs_review';
    if (!result.ok && !terminal) result = await attempt(driver, control, step.intent, doc, 2, timeoutMs, graceMs);

    report.observed = safeRead(driver, control) ?? result.observed;
    if (result.ok) {
      report.outcome = 'filled';
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