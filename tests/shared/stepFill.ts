// A step form in a replay: fill the step showing, press the page's own Next the way the extension's auto-advance
// does, and fill again, until the page has no Next, needs the applicant, or stops moving. Never the send button.
import type { Page } from '@playwright/test';
import type { FillReport } from '../../src/engine/types';

export interface StepRun {
  report: FillReport;
  /** Steps moved on from. */
  steps: number;
  /** Why it stopped: `single` for a page that is no step form. */
  stop: string;
}

/** As the extension waits (src/background/autoAdvance.ts ADVANCE_DEFAULTS). */
export const STEP_TIMING = { pollMs: 400, waitMs: 10_000, settleMs: 600, maxSteps: 15 };

/**
 * One report for a run over several steps, from the first start to the last finish. A step still showing is filled
 * again on the next pass, so a question a later pass reported again counts once, as that pass left it; several rows
 * of one pass (two entries of a section) all stay.
 */
export function mergeReports(reports: FillReport[]): FillReport {
  if (reports.length === 0) throw new Error('no report to merge');
  const keyOf = (f: FillReport['fields'][number]) => `${f.label}\u0000${f.fieldKey ?? ''}`;
  let fields: FillReport['fields'] = [];
  for (const r of reports) {
    const asked = new Set(r.fields.map(keyOf));
    fields = [...fields.filter((f) => !asked.has(keyOf(f))), ...r.fields];
  }
  const counts = Object.fromEntries(Object.keys(reports[0]!.counts).map((k) => [k, 0])) as FillReport['counts'];
  for (const f of fields) if (f.outcome in counts) counts[f.outcome as keyof FillReport['counts']]++;
  return {
    ...reports[0]!,
    startedAt: Math.min(...reports.map((r) => r.startedAt)),
    finishedAt: Math.max(...reports.map((r) => r.finishedAt)),
    fields,
    counts,
  };
}

interface StepReading {
  stepped: boolean;
  fingerprint: string;
  action: string;
  blocker: string | null;
}

export async function fillThroughSteps(page: Page, fillOnce: () => Promise<FillReport>, timing = STEP_TIMING): Promise<StepRun> {
  const reports = [await fillOnce()];
  const read = () => page.evaluate(() => window.__raf.readStep()) as Promise<StepReading>;
  const done = (stop: string): StepRun => ({ report: mergeReports(reports), steps: reports.length - 1, stop });
  for (;;) {
    const here = await read();
    if (!here.stepped) return done('single');
    if (here.blocker) return done(here.blocker);
    if (here.action !== 'next') return done(here.action);
    if (reports.length > timing.maxSteps) return done('step_limit');
    if (!(await page.evaluate(() => window.__raf.pressNext()))) return done('not_pressed');
    const deadline = Date.now() + timing.waitMs;
    let moved = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(timing.pollMs);
      if ((await read()).fingerprint !== here.fingerprint) {
        moved = true;
        break;
      }
    }
    if (!moved) return done('not_advanced');
    await page.waitForTimeout(timing.settleMs);
    reports.push(await fillOnce());
  }
}
