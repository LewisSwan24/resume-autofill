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
import { Icon } from '../../src/ui/Icon';
import { ResumeChip } from './ResumeChip';
import { SummaryCard } from './SummaryCard';
import { countBoxes, looksUnderRead, summarize, type FillSummary } from './summarize';

/** How long we wait for `report:updated` after the background acknowledged `fill:request`. */
export const DEFAULT_REPORT_TIMEOUT_MS = 60_000;

type View =
  | { kind: 'idle' }
  | { kind: 'filling' }
  | { kind: 'done'; summary: FillSummary }
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

const ignore = () => {
  /* fire-and-forget: the background may be restarting; nothing useful to do on failure */
};

/** Play the card's exit animation unless the user asked for reduced motion (or there is no matchMedia, e.g. tests). */
function canAnimate(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type CardView = Extract<View, { kind: 'done' | 'error' }>;

export function Fab({ reportTimeoutMs = DEFAULT_REPORT_TIMEOUT_MS }: FabProps) {
  const t = useT();
  const [total, setTotal] = useState(0);
  const [boxes, setBoxes] = useState(0);
  /** Result of the last fill on this page: the FAB caption shows it instead of the detected count until the next fill starts. */
  const [result, setResult] = useState<FillSummary | null>(null);
  const [view, setViewState] = useState<View>({ kind: 'idle' });
  const viewRef = useRef<View>(view);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The card that is playing its exit animation (it has already been closed). */
  const [leaving, setLeaving] = useState<CardView | null>(null);

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
      if (message.type === 'scan:total') {
        if (typeof message.total === 'number' && Number.isFinite(message.total)) {
          setTotal(Math.max(0, Math.floor(message.total)));
          setBoxes(countBoxes(document));
        }
      } else if (message.type === 'report:updated') {
        if (!Array.isArray(message.report?.fields)) return;
        clearTimer();
        runRef.current++; // supersede any in-flight fill:request response handling
        const summary = summarize(message.report);
        setResult(summary);
        setView({ kind: 'done', summary });
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    // The scan usually finishes before this listener exists: ask for the current total.
    void sendToBackground({ type: 'scan:query' }).catch(ignore);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [clearTimer, setView]);

  useEffect(() => clearTimer, [clearTimer]);

  const fill = useCallback(async () => {
    if (viewRef.current.kind === 'filling') return;
    clearTimer();
    const run = ++runRef.current;
    setLeaving(null);
    setResult(null);
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
    buttonRef.current?.focus();
  }, [clearTimer, setView]);

  const filling = view.kind === 'filling';
  const cardView: CardView | null = view.kind === 'done' || view.kind === 'error' ? view : null;
  const shown = cardView ?? leaving;
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
      {shown && (
        <SummaryCard
          key={cardView ? 'open' : 'leaving'}
          summary={shown.kind === 'done' ? shown.summary : null}
          error={shown.kind === 'error' ? shown.message : null}
          leaving={!cardView}
          onSettled={() => setLeaving(null)}
          onClose={close}
          onFocusField={(item) =>
            void sendToBackground({ type: 'field:focus', frameId: item.frameId, fieldId: item.fieldId }).catch(ignore)
          }
          onOpenSidePanel={() => void sendToBackground({ type: 'ui:openSidePanel' }).catch(ignore)}
          onOpenOptions={() => void sendToBackground({ type: 'ui:openOptions' }).catch(ignore)}
          onFillMissing={() =>
            void sendToBackground({ type: 'ui:openOptions', ...(shown.kind === 'done' ? shown.summary.firstMissing : undefined) }).catch(ignore)
          }
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
