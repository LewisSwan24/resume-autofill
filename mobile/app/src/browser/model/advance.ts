// Auto-advance in the fill browser: the extension's loop (src/background/autoAdvance.ts) runs unchanged; this module
// holds what the app adds around it. Which sites the person has said yes to (asked once per site), what each step of
// the form got (for the summary when it stops), and which button a stop offers. Pure.
import type { AdvanceStop } from '../../../../../src/background/autoAdvance';
import type { FillReport } from '../../../../../src/engine/types';
import { groupOfOutcome } from './reportModel';

export type { AdvanceStop } from '../../../../../src/background/autoAdvance';

/** Sites remembered as agreed; the oldest goes first past this. */
export const ADVANCE_SITES_MAX = 100;

const isWebOrigin = (origin: string): boolean => /^https?:\/\/[^/]+$/.test(origin);

/** The confirm sheet comes up on a site the person has not agreed to yet (Lewis 2026-11-21: per site). */
export function needsConsent(sites: readonly string[], origin: string): boolean {
  return !isWebOrigin(origin) || !sites.includes(origin);
}

/** The list after agreeing on `origin`: once each, newest last, capped. */
export function rememberSite(sites: readonly string[], origin: string): string[] {
  if (!isWebOrigin(origin)) return [...sites];
  return [...sites.filter((s) => s !== origin), origin].slice(-ADVANCE_SITES_MAX);
}

/** The latest run of auto-advance on this page: running, or why it stopped. `steps` counts every step it moved on. */
export interface AdvanceView {
  running: boolean;
  steps: number;
  stopReason?: AdvanceStop;
}

/** One step of the form as the last fill on it left it. */
export interface StepSummary {
  /** Which step it is (src/fill/nextStep.ts stepFingerprint). */
  fingerprint: string;
  /** The name the page gives it, or null: the UI then says 第 n 步 only. */
  title: string | null;
  filled: number;
  attention: number;
  skipped: number;
}

/** The steps of one form, on one site, in the order they were filled. */
export interface WizardState {
  origin: string;
  steps: StepSummary[];
}

export function summarizeStep(report: FillReport, fingerprint: string, title: string | null): StepSummary {
  const out: StepSummary = { fingerprint, title, filled: 0, attention: 0, skipped: 0 };
  for (const f of report.fields) out[groupOfOutcome(f.outcome)]++;
  return out;
}

/** A filled step goes in the wizard: another site starts a new one; the same step filled again replaces its line. */
export function recordStep(wizard: WizardState | null, origin: string, step: StepSummary): WizardState {
  if (!wizard || wizard.origin !== origin) return { origin, steps: [step] };
  const at = wizard.steps.findIndex((s) => s.fingerprint === step.fingerprint);
  if (at < 0) return { origin, steps: [...wizard.steps, step] };
  return { origin, steps: wizard.steps.map((s, i) => (i === at ? step : s)) };
}

/** 1-based number of a step in the wizard; the next one when it has not been filled yet. */
export function stepNumber(wizard: WizardState | null, fingerprint: string): number {
  if (!wizard) return 1;
  const at = wizard.steps.findIndex((s) => s.fingerprint === fingerprint);
  return at < 0 ? wizard.steps.length + 1 : at + 1;
}

/**
 * What a stop lets the person do from the report (mockup U.6): go on once they have dealt with the page, go on after
 * the 15-step pause, press Next themselves, or nothing but look at the result.
 */
export type StopAction = 'resume' | 'continue' | 'manual' | null;

export function stopAction(reason: AdvanceStop | undefined): StopAction {
  switch (reason) {
    case 'needs_you':
    case 'verification':
    case 'not_advanced':
      return 'resume';
    case 'step_limit':
      return 'continue';
    case 'no_next':
    case 'ambiguous':
      return 'manual';
    default:
      return null;
  }
}
