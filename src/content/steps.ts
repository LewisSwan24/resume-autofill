// Top-frame side of auto-advance: report the step that is showing and press the page's own Next button.
// The button that sends the application is never pressed (see src/fill/nextStep.ts).
import type { AdvanceStop, PressResult, StepState } from '../background/autoAdvance';
import { findStepAction, pageBlocker, stepFingerprint, type StepAction } from '../fill/nextStep';

export interface StepHandlerOptions {
  /** The site adapter's name for the current step, if it has one. */
  adapterStep: () => string | null;
  /** The site adapter's selector for its Next button, if it has one. */
  adapterNext?: () => string | undefined;
  /** Tests stand in for `event.isTrusted`, which a test cannot set. */
  isTrusted?: (e: Event) => boolean;
}

export interface StepHandlers {
  stepState(): StepState;
  pressNext(): PressResult;
  stop(): void;
}

const ACTION_STOP: Record<Exclude<StepAction['kind'], 'next'>, AdvanceStop> = {
  final: 'final_step',
  none: 'no_next',
  ambiguous: 'ambiguous',
  disabled: 'needs_you',
};

/** The extension's own button lives in `<raf-fab>`: pressing it is not the user taking over the page. */
const onOwnUi = (e: Event): boolean =>
  e.composedPath().some((n) => n instanceof Element && n.tagName === 'RAF-FAB');

export function createStepHandlers(doc: Document, opts: StepHandlerOptions): StepHandlers {
  const isTrusted = opts.isTrusted ?? ((e: Event) => e.isTrusted);
  let userInputAt = 0;
  const note = (e: Event) => {
    if (isTrusted(e) && !onOwnUi(e)) userInputAt = Date.now();
  };
  const events = ['pointerdown', 'keydown'] as const;
  for (const type of events) doc.addEventListener(type, note, true);

  const action = () => findStepAction(doc, opts.adapterNext?.());

  return {
    stepState: () => ({
      url: doc.location?.href ?? '',
      fingerprint: stepFingerprint(doc, opts.adapterStep()),
      action: action().kind,
      blocker: pageBlocker(doc),
      userInputAt,
    }),
    pressNext: () => {
      const blocker = pageBlocker(doc);
      if (blocker) return { pressed: false, reason: blocker };
      const found = action();
      if (found.kind !== 'next') return { pressed: false, reason: ACTION_STOP[found.kind] };
      // Answer first: the press may unload the page, and the background must still hear back.
      const button = found.button;
      setTimeout(() => button.click(), 30);
      return { pressed: true };
    },
    stop: () => {
      for (const type of events) doc.removeEventListener(type, note, true);
    },
  };
}
