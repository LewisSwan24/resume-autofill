// FAB (bottom-right Button with icon + caption) + result card. Renders inside the closed shadow root of `<raf-fab>`.
//
// Geometry contract: the root wrapper is exactly as large as the FAB button; the card is
// absolutely positioned above it. See style.css header.
//
// Message flows (all through `src/messaging`):
//   click "Autofill"      → fill:request              (response {ok,error?})
//   background broadcast  ← scan:total / report:updated   (only accepted from the background)
//   click a list item     → field:focus {frameId,fieldId}
//   "View details"        → ui:openSidePanel          (needs the click's user gesture)
//   "Open settings"       → ui:openOptions
//   resume chip           → storage (switchResumeLanguage), not a message
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { useT } from '../../src/i18n';
import { isFromExtension, isValidMessage, sendToBackground, type Sender } from '../../src/messaging';
import type { InspectorTargetInfo } from '../../src/content/inspector';
import { Icon } from '../../src/ui/Icon';
import type { AdvanceStop, WizardSessionState } from '../../src/background/wizardSession';
import { findStepAction } from '../../src/fill/nextStep';
import { ResumeChip } from './ResumeChip';
import { SummaryCard } from './SummaryCard';
import { countBoxes, looksUnderRead, summarize, type FillSummary } from './summarize';

/** How long we wait for `report:updated` after the background acknowledged `fill:request`. */
export const DEFAULT_REPORT_TIMEOUT_MS = 60_000;

type View =
  | { kind: 'idle' }
  | { kind: 'filling' }
  | { kind: 'preview' }
  /** `summary` is null on a step auto-advance reached that had nothing to fill. */
  | { kind: 'done'; summary: FillSummary | null }
  | { kind: 'error'; message: string };

export interface FabProps {
  /** Failsafe for a lost `report:updated`; overridable in tests. */
  reportTimeoutMs?: number;
}

/** Error codes the background returns from fill:request; anything else is shown as-is. */
const ERROR_KEYS = {
  no_resume: 'fab.error.no_resume',
  no_frames: 'fab.error.no_frames',
  busy: 'fab.error.busy',
  vault_locked: 'fab.error.vault_locked',
} as const;

export function errorKey(code: string | undefined): (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS] | null {
  return code !== undefined && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code as keyof typeof ERROR_KEYS] : null;
}

/**
 * "44 filled · 2 need review · 1 not filled": each part matches one card badge (same STATUS_GROUPS grouping);
 * zero counts are left out.
 */
function resultCaption(summary: FillSummary, t: ReturnType<typeof useT>): string {
  const parts = [t('fab.result.filled', { n: summary.filled })];
  if (summary.review > 0) parts.push(t('fab.result.review', { n: summary.review }));
  if (summary.unrecognized > 0) parts.push(t('fab.result.failed', { n: summary.unrecognized }));
  return parts.join(' · ');
}

/** A wizard session as the background sends it, or null for anything else. */
function asSession(x: unknown): WizardSessionState | null {
  return typeof x === 'object' && x !== null && typeof (x as WizardSessionState).stepCount === 'number'
    ? (x as WizardSessionState)
    : null;
}

const ignore = () => {
  /* fire-and-forget: the background may be restarting; nothing useful to do on failure */
};

/** Play the card's exit animation unless the user asked for reduced motion (or there is no matchMedia, e.g. tests). */
function canAnimate(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type CardView = Extract<View, { kind: 'done' | 'error' | 'preview' }>;

export function Fab({ reportTimeoutMs = DEFAULT_REPORT_TIMEOUT_MS }: FabProps) {
  const t = useT();
  const [total, setTotal] = useState(0);
  const [boxes, setBoxes] = useState(0);
  const [hoverTarget, setHoverTarget] = useState<InspectorTargetInfo | null>(null);
  /** Result of the last fill on this page: the FAB caption shows it instead of the detected count until the next fill starts. */
  const [result, setResult] = useState<FillSummary | null>(null);
  const [view, setViewState] = useState<View>({ kind: 'idle' });
  const viewRef = useRef<View>(view);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The card that is playing its exit animation (it has already been closed). */
  const [leaving, setLeaving] = useState<CardView | null>(null);
  /** The tab's multi-page session, with its auto-advance run. */
  const [wizard, setWizard] = useState<WizardSessionState | null>(null);
  /** The user closed the card of a run that is still going. */
  const [runHidden, setRunHidden] = useState(false);
  /** Why a run stopped, when it stopped while this page was open; cleared by the next fill. */
  const [liveStop, setLiveStop] = useState<AdvanceStop | null>(null);
  /** The run is on a step that sent no report: nothing on it could be filled. */
  const [emptyStep, setEmptyStep] = useState(false);
  /** Steps of the run as last seen, and whether a report came for the step it is on. */
  const runStepsRef = useRef<number | null>(null);
  const reportedRef = useRef(false);

  const setView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  // Incoming broadcasts: only from the extension itself and never from a tab (content scripts).
  useEffect(() => {
    const onMessage = (message: unknown, sender: Sender) => {
      if (!isFromExtension(sender) || sender.tab != null) return;
      if (!isValidMessage(message)) return;
      if (message.type === 'inspector:hover') {
        setHoverTarget(message.target ?? null);
        return;
      }
      if (message.type === 'scan:total') {
        if (typeof message.total === 'number' && Number.isFinite(message.total)) {
          setTotal(Math.max(0, Math.floor(message.total)));
          setBoxes(countBoxes(document));
        }
      } else if (message.type === 'wizard:updated') {
        const session = asSession(message.session);
        setWizard(session);
        setRunHidden(false);
        const run = session?.advance;
        setLiveStop(run && !run.running ? (run.stopReason ?? null) : null);
        // A page that changes steps in place keeps this button. A step with nothing to fill sends no report, so
        // the numbers showing are the last step's: take them down.
        const steps = run ? run.steps : null;
        const before = runStepsRef.current;
        if (steps !== null && (before === null || steps < before)) {
          reportedRef.current = false; // a new run: its next step needs a report of its own
        } else if (steps !== null && before !== null && steps > before) {
          if (!reportedRef.current) {
            setResult(null);
            setEmptyStep(true);
            if (viewRef.current.kind === 'done') setView({ kind: 'done', summary: null });
          }
          reportedRef.current = false;
        }
        runStepsRef.current = steps;
      } else if (message.type === 'report:updated') {
        if (!Array.isArray(message.report?.fields)) return;
        clearTimer();
        runRef.current++; // supersede any in-flight fill:request response handling
        const summary = summarize(message.report);
        reportedRef.current = true;
        setEmptyStep(false);
        setResult(summary);
        setView({ kind: 'done', summary });
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    // The scan usually finishes before this listener exists: ask for the current total.
    void sendToBackground({ type: 'scan:query' }).catch(ignore);
    // A step loaded by auto-advance: pick the run up from the session.
    void sendToBackground({ type: 'wizard:query' })
      .then((session) => setWizard((now) => now ?? asSession(session)))
      .catch(ignore);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [clearTimer, setView]);

  useEffect(() => clearTimer, [clearTimer]);

  const fill = useCallback(async () => {
    if (viewRef.current.kind === 'filling') return;
    clearTimer();
    const run = ++runRef.current;
    setLeaving(null);
    setResult(null);
    setLiveStop(null);
    setEmptyStep(false);
    setView({ kind: 'filling' });
    try {
      const res = await sendToBackground({ type: 'fill:request' });
      if (run !== runRef.current) return; // a report arrived (or a newer run started) meanwhile
      if (!res?.ok) {
        const code = res?.error?.trim();
        const key = errorKey(code);
        setView({ kind: 'error', message: key ? t(key) : code || t('fab.error.generic') });
        return;
      }
      if (res.preview) {
        setView({ kind: 'preview' });
        return;
      }
      // Acknowledged: stay in "filling" until the report arrives; guard against it never coming.
      timerRef.current = setTimeout(() => {
        if (run === runRef.current && viewRef.current.kind === 'filling') {
          setView({ kind: 'error', message: t('fab.error.noReport') });
        }
      }, reportTimeoutMs);
    } catch {
      if (run === runRef.current) setView({ kind: 'error', message: t('fab.error.generic') });
    }
  }, [clearTimer, reportTimeoutMs, setView, t]);

  /** Close the card and hand focus back to the FAB (the control that opened it); the card settles out first. */
  const close = useCallback(() => {
    clearTimer();
    const current = viewRef.current;
    if (current.kind === 'done' || current.kind === 'error') setLeaving(canAnimate() ? current : null);
    setView({ kind: 'idle' });
    setRunHidden(true);
    buttonRef.current?.focus();
  }, [clearTimer, setView]);

  const startAdvance = useCallback(() => {
    void sendToBackground({ type: 'wizard:autoAdvance' })
      .then((res) => {
        if (!res?.ok) setView({ kind: 'error', message: t('fab.error.generic') });
      })
      .catch(() => setView({ kind: 'error', message: t('fab.error.generic') }));
  }, [setView, t]);

  const stopAdvance = useCallback(() => {
    void sendToBackground({ type: 'wizard:stopAdvance' }).catch(ignore);
  }, []);

  const filling = view.kind === 'filling';
  const cardView: CardView | null = view.kind === 'done' || view.kind === 'error' || view.kind === 'preview' ? view : null;
  const run = wizard?.advance;
  const running = run?.running === true;
  // The page's own buttons; the FAB's sit in a closed shadow root, out of this query's reach.
  const nextHere = !running && wizard !== null && view.kind === 'done' && findStepAction(document).kind === 'next';
  // A form in an iframe has its Next there: the background asks every frame of the tab.
  const [nextInFrame, setNextInFrame] = useState(false);
  const askFrames = !running && wizard !== null && view.kind === 'done' && !nextHere;
  useEffect(() => {
    setNextInFrame(false);
    if (!askFrames) return;
    let live = true;
    void sendToBackground({ type: 'wizard:stepAction' })
      .then((res) => {
        if (live) setNextInFrame((res as { action?: unknown } | undefined)?.action === 'next');
      })
      .catch(ignore);
    return () => {
      live = false;
    };
  }, [askFrames, view]);
  const offer = nextHere || (askFrames && nextInFrame);
  const advance = wizard
    ? {
        offer,
        running: running ? run!.steps : null,
        stopReason: running ? null : liveStop,
        emptyStep,
        onStart: startAdvance,
        onStop: stopAdvance,
      }
    : undefined;
  // A run keeps its card up, on every step it loads, unless the user closed it.
  const runCard = running && !runHidden && !cardView;
  const shown = cardView ?? leaving ?? (runCard ? ({ kind: 'done', summary: null } as const) : null);
  const detected = looksUnderRead(total, boxes)
    ? t('fab.detected.few', { n: total, boxes })
    : total === 0 ? t('fab.detected.none') : t(total === 1 ? 'fab.detected.one' : 'fab.detected.other', { n: total });
  // After a fill the caption states the result (same numbers as the card: to check = needs review + not filled).
  const caption = result ? resultCaption(result, t) : detected;
  const noFields = total === 0 && !filling && !result;

  return (
    <div
      className="raf-root"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && cardView) {
          e.stopPropagation();
          close();
        }
      }}
    >
      {hoverTarget && (
        <div
          className="raf-inspector-hud"
          role="status"
          aria-live="polite"
          style={{
            left: hoverTarget.rect.left,
            top: hoverTarget.rect.top,
            width: hoverTarget.rect.width,
            height: hoverTarget.rect.height,
          }}
        >
          <span className="raf-inspector-tag">
            {hoverTarget.label}
            {hoverTarget.fieldKey ? ` -> ${hoverTarget.fieldKey}` : ''}
          </span>
        </div>
      )}
      {shown && (
        <SummaryCard
          key={cardView || runCard ? 'open' : 'leaving'}
          summary={shown.kind === 'done' ? shown.summary : null}
          error={shown.kind === 'error' ? shown.message : null}
          previewReady={shown.kind === 'preview'}
          leaving={!cardView && !runCard}
          onSettled={() => setLeaving(null)}
          onClose={close}
          onFocusField={(item) =>
            void sendToBackground({ type: 'field:focus', frameId: item.frameId, fieldId: item.fieldId }).catch(ignore)
          }
          onOpenSidePanel={() => void sendToBackground({ type: 'ui:openSidePanel' }).catch(ignore)}
          onOpenOptions={() => void sendToBackground({ type: 'ui:openOptions' }).catch(ignore)}
          onFillMissing={() =>
            void sendToBackground({ type: 'ui:openOptions', ...(shown.kind === 'done' ? shown.summary?.firstMissing : undefined) }).catch(ignore)
          }
          {...(advance && (cardView?.kind === 'done' || runCard) ? { advance } : {})}
        />
      )}
      {/* Primary Button; with no detected fields it becomes the outlined button + muted caption (still clickable).
          Busy keeps focus and width: aria-busy + spinner, and fill() ignores clicks while filling (not `disabled`). */}
      <button
        ref={buttonRef}
        type="button"
        className={`raf-btn raf-fab${noFields ? '' : ' raf-btn--primary'}`}
        data-testid="raf-fab-button"
        data-muted={noFields}
        aria-busy={filling}
        aria-label={`${t('fab.autofill')} — ${caption}`}
        onClick={() => void fill()}
      >
        <span className="raf-fab__icon">{filling ? <span className="raf-spinner" role="presentation" /> : <Icon name="file-earmark-text" />}</span>
        <span className="raf-fab__text">
          <span className="raf-fab__title">{filling ? t('fab.filling') : t('fab.autofill')}</span>
          <span className="raf-fab__sub">{caption}</span>
        </span>
      </button>
      {/* Off while a fill runs; out of the way while the card is up (it would sit in the card's gap). */}
      {shown ? null : <ResumeChip disabled={filling} />}
    </div>
  );
}
