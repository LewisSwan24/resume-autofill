// Fill history from the browser session and 「提交了吗？」 (3.13). A finished run on a recorded,
// non-demo page with a real resume adds an entry holding only counts (reportOf), the resume id and its locale;
// undo marks it. When that page's session ends after a fill that was not undone, the person is asked once whether
// they submitted, as soon as the browser is out of sight. A wipe calls suppressAsk first.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Profile } from '../../../../src/schema';
import { pickResume } from '../browser/model/fillPlan';
import { reportOf, type BrowserTarget } from '../browser/model/session';
import type { OpenSession } from '../browser/useBrowserSession';
import type { AppState, FillLanguage } from '../store/appStateStore';
import { displayName, markFillUndone, recordFill, setStatus } from './model/records';
import { SubmitAskSheet } from './SubmitAskSheet';

interface SessionFills {
  target: BrowserTarget;
  recordId: string | null;
  /** runId → the history entry's `at`, and whether it was undone. */
  fills: Map<string, { at: number; undone: boolean }>;
}

const isOpen = (status: string) => status === 'wish' || status === 'filling';

export function useTrackerBrowserSync(o: {
  browser: OpenSession | null;
  profile: Profile | null;
  fillLanguage: FillLanguage;
  appState: AppState | null;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  browserShown: boolean;
  now?: () => number;
  /** 已提交 could not be saved (the state rolled back): App says m.saveStateFailed. */
  onSaveFailed?: () => void;
}): { element: ReactNode; suppressAsk(): void } {
  const latest = useRef(o);
  latest.current = o;
  const current = useRef<SessionFills | null>(null);
  const seen = useRef(new Set<string>());
  const suppressed = useRef(false);
  const [pending, setPending] = useState<string | null>(null);

  const state = o.browser?.state ?? null;
  const target = state?.target ?? null;
  const run = state?.run ?? null;

  useEffect(() => {
    const { profile, fillLanguage, updateAppState, now = Date.now } = latest.current;
    // A session ended (closed, or replaced by another page): ask about the one that ended.
    if (current.current && current.current.target !== target) {
      const ended = current.current;
      current.current = null;
      const filled = [...ended.fills.values()].some((f) => !f.undone);
      if (filled && ended.recordId && !suppressed.current) setPending(ended.recordId);
    }
    if (!target || !state || !run) return;
    if (!current.current) {
      suppressed.current = false;
      current.current = { target, recordId: target.recentId && !target.demo ? target.recentId : null, fills: new Map() };
    }
    const session = current.current;
    if (run.phase !== 'done' || !session.recordId) return;
    const recordId = session.recordId;
    if (!seen.current.has(run.runId)) {
      seen.current.add(run.runId);
      if (run.sample) return;
      const counts = reportOf(state)?.counts;
      if (!counts) return;
      let origin = '';
      try {
        origin = new URL(state.url).origin;
      } catch {
        // keep '' (never the demo origin)
      }
      const picked = pickResume(origin, state.choice, profile, fillLanguage);
      const resume = 'empty' in picked ? null : picked.resume;
      const at = now();
      session.fills.set(run.runId, { at, undone: false });
      const entry = {
        at,
        ...(resume ? { resumeId: resume.id, locale: resume.locale } : {}),
        filled: counts.filled,
        attention: counts.attention,
        skipped: counts.skipped,
        undone: false,
      };
      void updateAppState((s) => recordFill(s, recordId, entry, at));
    }
    const fill = session.fills.get(run.runId);
    if (fill && !fill.undone && run.undo !== null) {
      fill.undone = true;
      void updateAppState((s) => markFillUndone(s, recordId, fill.at));
    }
  }, [target, state, run]);

  const suppressAsk = useCallback(() => {
    suppressed.current = true;
    setPending(null);
  }, []);

  const record = pending ? (o.appState?.applications.find((r) => r.id === pending) ?? null) : null;
  // The record was deleted or is no longer open (已提交 etc.): nothing to ask.
  useEffect(() => {
    if (pending && o.appState && (!record || !isOpen(record.status))) setPending(null);
  }, [pending, record, o.appState]);

  const close = () => setPending(null);
  const element = (
    <SubmitAskSheet
      open={record !== null && isOpen(record.status) && !o.browserShown}
      name={record ? displayName(record) : ''}
      onYes={() => {
        const id = pending;
        close();
        if (!id) return;
        void latest.current.updateAppState((s) => setStatus(s, id, 'submitted', (latest.current.now ?? Date.now)())).then((ok) => {
          if (!ok) latest.current.onSaveFailed?.();
        });
      }}
      onNo={close}
    />
  );
  return { element, suppressAsk };
}
