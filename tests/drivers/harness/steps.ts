// The top-frame half of auto-advance, for a test that drives a step form without the extension: what step the page
// is on, and its own Next button pressed. The same reading as src/content/steps.ts; the send button is never pressed.
import { resolveAdapter } from '../../../src/adapters/resolve';
import { findStepAction, pageBlocker, stepFingerprint, type PageBlocker, type StepAction } from '../../../src/fill/nextStep';

export interface HarnessStep {
  /** The page's adapter names a Next button: a form that moves on in steps. */
  stepped: boolean;
  fingerprint: string;
  action: StepAction['kind'];
  blocker: PageBlocker | null;
}

export function readStep(doc: Document = document): HarnessStep {
  const adapter = resolveAdapter(doc);
  return {
    stepped: !!adapter?.nextButton,
    fingerprint: stepFingerprint(doc, adapter?.stepSignature?.(doc) ?? null),
    action: findStepAction(doc, adapter?.nextButton).kind,
    blocker: pageBlocker(doc),
  };
}

/** Presses Next when nothing stands in the way, as the extension would. False when it did not. */
export function pressNext(doc: Document = document): boolean {
  if (pageBlocker(doc)) return false;
  const found = findStepAction(doc, resolveAdapter(doc)?.nextButton);
  if (found.kind !== 'next') return false;
  found.button.click();
  return true;
}
