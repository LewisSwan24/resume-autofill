// FAB pill (bottom-right) + result card. Renders inside the closed shadow root of `<raf-fab>`.
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { useT } from '../../src/i18n';
import { isFromExtension, isValidMessage, sendToBackground, type Sender } from '../../src/messaging';
import { SummaryCard } from './SummaryCard';
import { summarize, type FillSummary } from './summarize';

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

const ignore = () => {
  /* fire-and-forget: the background may be restarting; nothing useful to do on failure */
};

function Glyph() {
  return (
    <svg className="raf-fab__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}

export function Fab({ reportTimeoutMs = DEFAULT_REPORT_TIMEOUT_MS }: FabProps) {
  const t = useT();
  const [total, setTotal] = useState(0);
  const [view, setViewState] = useState<View>({ kind: 'idle' });
  const viewRef = useRef<View>(view);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef(0);

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
        }
      } else if (message.type === 'report:updated') {
        if (!Array.isArray(message.report?.fields)) return;
        clearTimer();
        runRef.current++; // supersede any in-flight fill:request response handling
        setView({ kind: 'done', summary: summarize(message.report) });
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

  const close = useCallback(() => {
    clearTimer();
    setView({ kind: 'idle' });
  }, [clearTimer, setView]);

  const filling = view.kind === 'filling';
  const detected =
    total === 0 ? t('fab.detected.none') : t(total === 1 ? 'fab.detected.one' : 'fab.detected.other', { n: total });

  return (
    <div
      className="raf-root"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && (view.kind === 'done' || view.kind === 'error')) close();
      }}
    >
      {(view.kind === 'done' || view.kind === 'error') && (
        <SummaryCard
          summary={view.kind === 'done' ? view.summary : null}
          error={view.kind === 'error' ? view.message : null}
          onClose={close}
          onFocusField={(item) =>
            void sendToBackground({ type: 'field:focus', frameId: item.frameId, fieldId: item.fieldId }).catch(ignore)
          }
          onOpenSidePanel={() => void sendToBackground({ type: 'ui:openSidePanel' }).catch(ignore)}
          onOpenOptions={() => void sendToBackground({ type: 'ui:openOptions' }).catch(ignore)}
        />
      )}
      <button
        type="button"
        className="raf-fab"
        data-testid="raf-fab-button"
        data-muted={total === 0 && !filling}
        disabled={filling}
        aria-busy={filling}
        aria-label={`${t('fab.autofill')} — ${detected}`}
        onClick={() => void fill()}
      >
        <span className="raf-fab__icon">{filling ? <span className="raf-spinner" /> : <Glyph />}</span>
        <span className="raf-fab__text">
          <span className="raf-fab__title">{filling ? t('fab.filling') : t('fab.autofill')}</span>
          <span className="raf-fab__sub">{detected}</span>
        </span>
      </button>
    </div>
  );
}
