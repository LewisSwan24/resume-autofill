// The fill browser screen. React draws the chrome: top bar, notice, docked sheets, toasts and toolbar; the
// native page WebView sits exactly over the empty .m-br__viewport, whose top and bottom insets are measured and sent
// to the session whenever they move by a pixel or more. Nothing drawn inside that rect is visible while the page
// shows, so sheets dock below it and toasts sit above the toolbar. The FAB is native (useNativeFab).
import './browser.css';
import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { materializeResume, type Profile, type Resume } from '../../../../src/schema';
import type { SensitiveFieldMode } from '../../../../src/schema/sensitive';
import { SensitiveFieldsDockedSheet } from '../settings/SensitiveFieldsSheet';
import { AdvanceBar, AdvanceConfirmSheet } from './AdvanceSheets';
import { needsConsent } from './model/advance';
import { resolveFillResume } from '../home/summary';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { FillLanguage } from '../store/appStateStore';
import type { FileInfo, FileStore } from '../store/fileStore';
import { BackStackContext, type ToastMessage } from '../ui';
import { AddressBar } from './AddressBar';
import { BrowserToolbar } from './BrowserToolbar';
import { DockContext, type DockHost } from './DockedSheet';
import { DownloadSheet } from './DownloadSheet';
import { ExplainSheet, type Explain } from './ExplainSheet';
import { ExternalLinkSheet } from './ExternalLinkSheet';
import { FileChooserSheet, matchesAccept } from './FileChooserSheet';
import { TOAST_MS } from './model/constants';
import { fabModel } from './model/fabModel';
import { isRunActive, type RunState } from './model/fillRun';
import { buildReportModel, type ReportRow } from './model/reportModel';
import { sampleFor } from './model/sampleResume';
import type { Insets, NativeTheme } from './native';
import { PageErrorView } from './PageErrorView';
import type { BrowserRolePlugin } from '../native/browserRole';
import { PageInfoSheet } from './PageInfoSheet';
import { ReportSheet, type ReportAdvance } from './ReportSheet';
import { ResumeChoiceSheet, type ResumePick } from './ResumeChoiceSheet';
import { onSchemeChange, resolveTheme } from './themeColors';
import { useNativeFab } from './useNativeFab';
import type { OpenSession } from './useBrowserSession';

/** What App reaches into: the toast slot above the toolbar and the close rule of the back key. */
export interface BrowserScreenHandle {
  toast(message: Omit<ToastMessage, 'id'>): void;
  /** Close, asking first when a fill ran in the current document. */
  requestClose(): void;
}

export interface BrowserScreenProps {
  open: OpenSession;
  profile: Profile | null;
  files: Pick<FileStore, 'info'>;
  /** The default fill language (设置), for the resume chip and the fallback note. */
  fillLanguage?: FillLanguage;
  handleRef?: Ref<BrowserScreenHandle | null>;
  onClose: () => void;
  /** 「去填简历」: hide the page and show the 简历 tab. */
  onGoToResume: () => void;
  /** The app-wide toast, for what must outlive the browser screen. */
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** 「用系统浏览器打开」 in page info; absent in the browser preview and in older callers. */
  browserRole?: Pick<BrowserRolePlugin, 'openInOtherBrowser'> | null;
  /** The resume keyboard's setup screen, from the WeChat hint on the open-another-app sheet; absent without the plugin. */
  onKeyboardSetup?: () => void;
  /** Sites where the person has agreed to auto-advance (asked once per site). */
  advanceSites?: readonly string[];
  onAdvanceSite?: (origin: string) => void;
  /** settings.sensitiveFields, and a change from a held-back row's 「改设置」. */
  sensitiveFields?: SensitiveFieldMode;
  onSensitiveFields?: (mode: SensitiveFieldMode) => void;
}

type LocalSheet = 'report' | 'resume' | 'pageInfo' | 'advance' | 'sensitive' | null;

/** Sessions already started: the screen remounts when the page comes back from the 简历 tab. */
const started = new WeakSet<object>();

const ATTACHMENT_SLOTS = ['resumeFileId', 'photoFileId', 'transcriptFileId', 'portfolioFileId'] as const;

/** One key per run transition worth reacting to. */
function runKey(run: RunState): string {
  return run.phase === 'done'
    ? `done:${run.runId}:${run.undo ? 'undone' : ''}`
    : 'runId' in run
      ? `${run.phase}:${run.runId}`
      : run.phase === 'failed'
        ? `failed:${run.code}`
        : run.phase;
}

export function BrowserScreen({
  open,
  profile,
  files,
  fillLanguage = 'active',
  handleRef,
  onClose,
  onGoToResume,
  browserRole = null,
  onKeyboardSetup,
  advanceSites = [],
  onAdvanceSite,
  sensitiveFields = 'remind',
  onSensitiveFields,
}: BrowserScreenProps) {
  const t = useMT();
  const { session, state, native } = open;
  const backStack = useContext(BackStackContext);

  // ---------------------------------------------------------------- toasts and live region
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const say = useCallback(
    (message: Omit<ToastMessage, 'id'>) => setToast({ ...message, id: Date.now() + Math.random() }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const [live, setLive] = useState('');

  // ---------------------------------------------------------------- sheets
  const [sheet, setSheet] = useState<LocalSheet>(null);
  const [explain, setExplain] = useState<Explain | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (session.getState().run.phase === 'done') {
      setSheet(null);
      setExplain({ kind: 'close' });
    } else onClose();
  }, [session, onClose]);
  useImperativeHandle(handleRef, () => ({ toast: say, requestClose }), [say, requestClose]);

  // ---------------------------------------------------------------- insets of the page area
  const viewport = useRef<HTMLDivElement>(null);
  const dockEl = useRef<HTMLDivElement>(null);
  const lastInsets = useRef<Insets | null>(null);
  const frame = useRef(0);
  const measureInsets = useCallback((): Insets | null => {
    const el = viewport.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // In landscape the sheets dock beside the page (browser.css): the page gives up the room on its right.
    const dock = dockEl.current?.getBoundingClientRect();
    const beside = !!dock && dock.width > 0 && dock.left >= rect.right - 1;
    const end = beside ? Math.max(0, Math.round(window.innerWidth - rect.right)) : 0;
    return {
      top: Math.max(0, Math.round(rect.top)),
      bottom: Math.max(0, Math.round(window.innerHeight - rect.bottom)),
      ...(end > 0 ? { end } : {}),
    };
  }, []);
  const pushInsets = useCallback(() => {
    const next = measureInsets();
    if (!next) return;
    const last = lastInsets.current;
    if (last && Math.abs(last.top - next.top) < 1 && Math.abs(last.bottom - next.bottom) < 1 && Math.abs((last.end ?? 0) - (next.end ?? 0)) < 1) return;
    lastInsets.current = next;
    if (started.has(session)) session.setInsets(next);
  }, [measureInsets, session]);
  const scheduleInsets = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      pushInsets();
    });
  }, [pushInsets]);

  // ---------------------------------------------------------------- theme, start
  const [theme, setTheme] = useState<NativeTheme | null>(null);
  useLayoutEffect(() => {
    const resolved = resolveTheme();
    setTheme(resolved);
    const insets = measureInsets() ?? { top: 0, bottom: 0 };
    lastInsets.current = insets;
    if (!started.has(session)) {
      started.add(session);
      void session.start(insets, resolved).catch(() => undefined);
    } else {
      session.setInsets(insets);
    }
    return onSchemeChange((next) => {
      setTheme(next);
      session.setTheme(next);
    });
  }, [session, measureInsets]);

  useEffect(() => {
    const el = viewport.current;
    const observer = typeof ResizeObserver === 'function' && el ? new ResizeObserver(scheduleInsets) : null;
    if (observer && el) observer.observe(el);
    window.addEventListener('resize', scheduleInsets);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleInsets);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [scheduleInsets]);
  // Anything that moves the page area's edges: a sheet, a toast, the notice, the keyboard hiding the toolbar.
  useLayoutEffect(() => {
    pushInsets();
  });

  const dock = useMemo<DockHost>(
    () => ({
      setSheet: (s) => {
        setModalOpen(s.open && s.modal);
        session.setSheet(s);
      },
      onHeight: () => scheduleInsets(),
    }),
    [session, scheduleInsets],
  );

  // The native scrim covers the page while a modal sheet is open; tapping it closes the sheet like the back key.
  useEffect(() => session.onScrimTap(() => void backStack.pop()), [session, backStack]);

  // The session's own toasts (permission denied, link blocked, no app for a link): words are i18n keys. A toast the
  // session already had when this screen mounted was said before the page was hidden: coming back does not repeat it.
  const sessionToast = state.toast;
  const seenToast = useRef(sessionToast?.id);
  useEffect(() => {
    if (!sessionToast || sessionToast.id === seenToast.current) return;
    seenToast.current = sessionToast.id;
    const params: Record<string, string | number> = { ...sessionToast.params };
    for (const [name, key] of Object.entries(sessionToast.keyParams ?? {})) params[name] = t(key);
    say({ text: t(sessionToast.key, params) });
    // Only a new toast (new id) is said; a language change does not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToast?.id]);

  // ---------------------------------------------------------------- resume used for filling
  const demo = state.target.demo;
  const fillResume = useMemo<{
    pick: ResumePick | null;
    resume: Resume | null;
    sample: boolean;
  }>(() => {
    const choice = state.choice;
    if (choice.kind === 'sample' || (choice.kind === 'default' && demo)) {
      if (demo)
        return {
          pick: { kind: 'sample' },
          resume: sampleFor(fillLanguage),
          sample: true,
        };
    }
    if (choice.kind === 'profile') {
      const r = profile?.resumes.find((x) => x.id === choice.resumeId) ?? null;
      if (r && profile)
        return {
          pick: { kind: 'profile', resumeId: r.id },
          resume: materializeResume(r, profile.resumes),
          sample: false,
        };
    }
    const resolved = profile ? resolveFillResume(profile, fillLanguage) : null;
    return resolved && profile
      ? {
          pick: { kind: 'profile', resumeId: resolved.resume.id },
          resume: materializeResume(resolved.resume, profile.resumes),
          sample: false,
        }
      : { pick: null, resume: null, sample: false };
  }, [state.choice, demo, profile, fillLanguage]);
  const resumeName = fillResume.sample
    ? t('m.br.resume.sample')
    : fillResume.resume
      ? fillResume.resume.title ||
        t(fillResume.resume.locale.startsWith('zh') ? 'm.defaultTitle.zh' : 'm.defaultTitle.en')
      : t('m.home.noResume');
  const resumeTag = t(
    (fillResume.resume?.locale ?? (fillLanguage === 'en' ? 'en-AU' : 'zh-CN')).startsWith('zh') ? 'm.zhTag' : 'm.enTag',
  );

  // ---------------------------------------------------------------- fill

  const fillOutcome = useCallback(
    (result: Awaited<ReturnType<typeof session.fill>>) => {
      if (result === 'busy') say({ text: t('m.br.run.busy') });
      else if (result === 'no_resume') {
        setSheet(null);
        setExplain({ kind: 'noResume', demo });
      } else if (result === 'unavailable') {
        setSheet(null);
        setExplain({
          kind: 'unsupported',
          version: session.getState().capabilities?.webViewVersion ?? null,
        });
      }
    },
    [session, say, t, demo],
  );
  const fill = useCallback(async () => fillOutcome(await session.fill()), [session, fillOutcome]);
  useNativeFab(session, {
    onFill: fillOutcome,
    onReport: () => {
      setExplain(null);
      setSheet('report');
    },
    onExplain: (which) =>
      setExplain(
        which === 'unsupported'
          ? {
              kind: 'unsupported',
              version: session.getState().capabilities?.webViewVersion ?? null,
            }
          : { kind: 'missing' },
      ),
  });

  // Run transitions: announce, open the report, say why a run failed. The screen remounts when the page comes back
  // from the 简历 tab; it starts from the run as it is then, so nothing from before is announced or opened again.
  const run = state.run;
  const lastRun = useRef<string>(runKey(run));
  useEffect(() => {
    const key = runKey(run);
    if (key === lastRun.current) return;
    const before = lastRun.current;
    lastRun.current = key;
    if (run.phase === 'asking' && !before.startsWith('asking')) setLive(t('m.br.live.filling'));
    // While auto-advance runs, each step's report waits: it opens once the run stops.
    if (run.phase === 'done' && !run.undo && !session.getState().advance?.running) {
      const filled = run.report.fields.filter((f) => f.outcome === 'filled').length;
      const model = buildReportModel({
        report: run.report,
        liveFrames: new Set(),
        unreachable: 0,
        fallback: false,
        isolated: null,
        handedOver: run.handedOver,
        undo: null,
      });
      setLive(t('m.br.run.done', { filled, review: model.counts.attention }));
      setExplain(null);
      setSheet('report');
    }
    if (run.phase === 'done' && run.undo) setLive(t('m.br.report.undone', { n: run.undo.restored.length }));
    if (run.phase === 'failed' && !before.startsWith('failed')) {
      if (run.code === 'no_frames') say({ text: t('m.br.run.noFields') });
      else if (run.code === 'failed') say({ text: t('m.br.run.failed') });
    }
  }, [run, say, t, session]);

  // Auto-advance: the report folds away while it runs and comes back, on why it stopped, when it does.
  const advance = state.advance;
  const wasRunning = useRef(advance?.running === true);
  useEffect(() => {
    const running = advance?.running === true;
    if (running && !wasRunning.current) {
      setSheet(null);
      setLive(t('common.advance.running', { n: advance!.steps }));
    }
    if (!running && wasRunning.current && advance?.stopReason) {
      setLive(t(`common.advance.stop.${advance.stopReason}`));
      setExplain(null);
      setSheet('report');
    }
    wasRunning.current = running;
  }, [advance, t]);
  const pageOrigin = useMemo(() => {
    try {
      const o = new URL(state.url).origin;
      return o === 'null' ? '' : o;
    } catch {
      return '';
    }
  }, [state.url]);
  const startAdvance = useCallback(() => {
    if (needsConsent(advanceSites, pageOrigin)) setSheet('advance');
    else {
      setSheet(null);
      session.startAdvance();
    }
  }, [advanceSites, pageOrigin, session]);
  const wizardSteps = state.wizard?.origin === pageOrigin ? state.wizard.steps : [];
  const reportAdvance: ReportAdvance | null =
    state.stepOffer || (advance && !advance.running && advance.stopReason)
      ? {
          offer: advance?.running ? null : state.stepOffer,
          stop: advance && !advance.running && advance.stopReason ? { reason: advance.stopReason, moved: advance.steps } : null,
          steps: wizardSteps,
          here: wizardSteps.length - 1,
          onStart: startAdvance,
          onResume: () => {
            setSheet(null);
            session.startAdvance();
          },
        }
      : null;
  const fillOne = useCallback(
    async (row: ReportRow) => {
      const result = await session.fillOne(row.key);
      if (result === 'failed') say({ text: t('m.br.report.fillOnceFailed') });
      else if (result === 'gone') say({ text: t('m.br.report.gone') });
    },
    [session, say, t],
  );

  const reportModel = useMemo(() => {
    if (run.phase !== 'done') return null;
    return buildReportModel({
      report: run.report,
      liveFrames: new Set(state.frames.map((f) => f.frame)),
      unreachable: state.unreachable,
      fallback: run.fallback,
      isolated: state.isolated,
      handedOver: run.handedOver,
      undo: run.undo,
    });
  }, [run, state.frames, state.unreachable, state.isolated]);
  const fallbackNote =
    run.phase === 'done' && run.fallback && fillResume.resume
      ? t('m.br.resume.fallback', {
          language: t(fillLanguage === 'en' ? 'm.lang.en' : 'm.lang.zh'),
          name: resumeName,
        })
      : null;

  const locate = useCallback(
    async (row: ReportRow) => {
      const result = await session.focus(row.key);
      if (result === 'gone') say({ text: t('m.br.report.gone') });
    },
    [session, say, t],
  );

  // ---------------------------------------------------------------- links
  const copy = useCallback(
    async (url: string) => {
      try {
        if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
        await navigator.clipboard.writeText(url);
        say({ text: t('m.br.copied') });
      } catch {
        say({ text: t('m.recent.copyFailed') });
      }
    },
    [say, t],
  );
  const openElsewhere = useCallback(async () => {
    if (!browserRole) return;
    setSheet(null);
    try {
      const { opened } = await browserRole.openInOtherBrowser({ url: state.url, title: t('m.br.openElsewhere') });
      if (!opened) say({ text: t('m.br.noOtherBrowser') });
    } catch {
      say({ text: t('m.br.noOtherBrowser') });
    }
  }, [browserRole, state.url, say, t]);
  const openSystem = useCallback(async () => {
    try {
      const { opened } = await native.openExternal({ url: state.url });
      if (!opened) say({ text: t('m.br.ext.noApp') });
    } catch {
      say({ text: t('m.br.ext.noApp') });
    }
  }, [native, state.url, say, t]);

  // ---------------------------------------------------------------- file chooser candidates
  const pending = state.pending;
  const chooser = pending?.kind === 'fileChooser' ? pending : null;
  const [candidates, setCandidates] = useState<FileInfo[] | null>(null);
  useEffect(() => {
    if (!chooser) {
      setCandidates(null);
      return;
    }
    let alive = true;
    const resume = fillResume.sample ? null : fillResume.resume;
    const ids = resume
      ? ATTACHMENT_SLOTS.map((slot) => resume.attachments[slot]).filter((id): id is string => Boolean(id))
      : [];
    void Promise.all(ids.map((id) => files.info(id).catch(() => null))).then((infos) => {
      if (alive) setCandidates(infos.filter((i): i is FileInfo => i !== null && matchesAccept(i, chooser.accept)));
    });
    return () => {
      alive = false;
    };
  }, [chooser, fillResume, files]);
  const pickFile = useCallback(
    async (fileId: string) => {
      const result = await session.answerFile({ kind: 'stored', fileId });
      if (result === 'too_big') say({ text: t('m.br.file.tooBig') });
      else if (result === 'failed') say({ text: t('m.br.file.failed') });
    },
    [session, say, t],
  );

  // ---------------------------------------------------------------- which sheet shows (one at a time)
  const large = run.phase === 'confirmLarge' ? run : null;
  const sites = run.phase === 'confirmSites' ? run : null;
  const external = pending?.kind === 'external' ? pending.decision : null;
  const download = pending?.kind === 'download' ? pending : null;
  const shownExplain: Explain | null = large
    ? { kind: 'large', leaves: large.leaves }
    : sites
      ? { kind: 'sites', hosts: sites.hosts }
      : pending
        ? null
        : explain;
  const localShown: LocalSheet = large || sites || pending || explain ? null : sheet;

  const hostLabel = state.host.kind === 'demo' ? t('m.br.demoHost') : state.host.host;
  const report = run.phase === 'done' && reportModel ? { attention: reportModel.counts.attention } : null;
  // Docked FAB (no room on the page): the toolbar does what the FAB would. Once a report exists and the FAB would open
  // it, the report chip stays and no fill chip appears, so a tap there can never start a second run over the first.
  const fabTap = fabModel({ engine: state.engine, frames: state.frames, run, settling: false })?.tap ?? 'fill';
  const docked = state.fabDocked && fabTap !== 'report';
  const chromeInert = modalOpen || undefined;

  return (
    <DockContext.Provider value={dock}>
      <div className={state.keyboard ? 'm-br m-br--keyboard' : 'm-br'}>
        <div inert={chromeInert}>
          <AddressBar
            host={state.host}
            certProblem={state.error?.kind === 'ssl'}
            loading={state.loading}
            progress={state.progress}
            onClose={requestClose}
            onPageInfo={() => setSheet('pageInfo')}
          />
          {state.notice === 'google_login' ? (
            <div className="m-br-notice" role="note">
              <Icon name="info-circle" />
              <span>{t('m.br.googleNotice')}</span>
              <button type="button" className="m-button m-button--text" onClick={() => session.dismissNotice()}>
                {t('m.br.dismiss')}
              </button>
            </div>
          ) : null}
        </div>

        <div ref={viewport} className="m-br__viewport">
          {state.error ? (
            <PageErrorView
              error={state.error}
              onRetry={() => session.retry()}
              onClose={onClose}
              onCopy={() => void copy(state.url)}
            />
          ) : state.loading && state.progress === 0 ? (
            <p className="m-br__starting">{t('m.br.loading', { host: hostLabel })}</p>
          ) : null}
        </div>

        <div ref={dockEl} className="m-br__dock">
          <ReportSheet
            open={localShown === 'report'}
            model={reportModel}
            canUndo={run.phase === 'done' && !run.undo}
            fallbackNote={fallbackNote}
            unanswered={run.phase === 'done' ? run.unanswered : 0}
            resume={(() => {
              const id = fillResume.pick?.kind === 'profile' ? fillResume.pick.resumeId : null;
              return id ? (profile?.resumes.find((r) => r.id === id) ?? null) : null;
            })()}
            advance={reportAdvance}
            onLocate={(row) => void locate(row)}
            onUndo={() => void session.undo()}
            onClose={() => setSheet(null)}
            onFillOne={fillResume.sample ? undefined : (row) => void fillOne(row)}
            onChangeSensitive={onSensitiveFields ? () => setSheet('sensitive') : undefined}
            onGoToResume={fillResume.sample ? undefined : onGoToResume}
          />
          <AdvanceConfirmSheet
            open={localShown === 'advance'}
            host={state.host.host}
            onStart={() => {
              onAdvanceSite?.(pageOrigin);
              session.startAdvance();
            }}
            onClose={() => setSheet(null)}
          />
          {onSensitiveFields ? (
            <SensitiveFieldsDockedSheet
              open={localShown === 'sensitive'}
              value={sensitiveFields}
              onChoose={onSensitiveFields}
              onClose={() => setSheet('report')}
            />
          ) : null}
          <ResumeChoiceSheet
            open={localShown === 'resume'}
            profile={profile}
            demo={demo}
            current={fillResume.pick}
            onChoose={(pick) =>
              session.choose(pick.kind === 'sample' ? { kind: 'sample' } : { kind: 'profile', resumeId: pick.resumeId })
            }
            onClose={() => setSheet(null)}
          />
          <PageInfoSheet
            open={localShown === 'pageInfo'}
            url={state.url}
            host={state.host}
            certProblem={state.error?.kind === 'ssl'}
            isolated={state.isolated}
            onCopy={() => void copy(state.url)}
            onOpenSystem={() => void openSystem()}
            onOpenElsewhere={browserRole ? () => void openElsewhere() : undefined}
            onReload={() => {
              setSheet(null);
              session.reloadOrStop();
            }}
            onClose={() => setSheet(null)}
          />
          <ExplainSheet
            explain={shownExplain}
            onClose={() => setExplain(null)}
            onReload={() => {
              setExplain(null);
              session.retry();
            }}
            onGoToResume={() => {
              setExplain(null);
              onGoToResume();
            }}
            onUseSample={() => {
              setExplain(null);
              session.choose({ kind: 'sample' });
              void fill();
            }}
            onLarge={(go) => session.confirmLarge(go)}
            onSites={(go) => session.confirmSites(go)}
            onConfirmClose={() => {
              setExplain(null);
              onClose();
            }}
          />
          <ExternalLinkSheet
            decision={external}
            onOpen={() => void session.answerExternal(true)}
            onCopy={(url) => {
              void copy(url);
              session.dismissPending();
            }}
            onClose={() => session.dismissPending()}
            onKeyboardSetup={
              onKeyboardSetup
                ? () => {
                    session.dismissPending();
                    onKeyboardSetup();
                  }
                : undefined
            }
          />
          <DownloadSheet
            download={download}
            onCopy={(url) => void copy(url)}
            onClose={() => session.dismissPending()}
          />
          <FileChooserSheet
            request={chooser}
            files={candidates}
            onPick={(id) => void pickFile(id)}
            onSystem={() => void session.answerFile({ kind: 'system' })}
            onCancel={() => session.dismissPending()}
          />
        </div>

        <div className="m-br-toasts" aria-live="polite">
          {toast ? (
            <div className="m-toast" key={toast.id}>
              <span className="m-toast__text">{toast.text}</span>
              {toast.action ? (
                <button
                  type="button"
                  className="m-toast__action"
                  onClick={() => {
                    toast.action!.onClick();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="m-br-live" role="status" aria-live="polite">
          {live}
        </p>

        {/* While the keyboard is up the page gets the room (and the FAB hides, see the session). */}
        <div inert={chromeInert} hidden={state.keyboard || undefined}>
          {state.keyboard ? null : advance?.running ? (
            <AdvanceBar
              moved={advance.steps}
              // Filled steps so far, plus the one it is on its way to or filling now.
              step={wizardSteps.length + 1}
              filling={isRunActive(run)}
              onStop={() => session.stopAdvance()}
            />
          ) : (
            <BrowserToolbar
              canGoBack={state.canGoBack}
              canGoForward={state.canGoForward}
              loading={state.loading}
              onBack={() => void session.back()}
              onForward={() => session.forward()}
              onReloadOrStop={() => session.reloadOrStop()}
              resumeName={resumeName}
              resumeTag={resumeTag}
              onResume={() => setSheet('resume')}
              report={report}
              onReport={() => setSheet('report')}
              dockedFill={docked}
              onFill={() => void fill()}
            />
          )}
        </div>
      </div>
    </DockContext.Provider>
  );
}
