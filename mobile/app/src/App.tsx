// The mobile app's shell: onboarding on a first run, then three tabs (首页, 简历, 设置) with one back-key order for
// the whole app, and the fill browser over them (or hidden behind a return pill while the person adds data). App
// holds what must outlive a wipe (toast, back stack); AppContent, keyed by a generation counter, holds the profile
// editor, the app state, the navigation and the browser session, so deleting everything remounts it on empty storage.
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { referencedFileIds, setActive, type ModuleMeta } from '../../../src/editor';
import { resolveLanguage, setLanguage, useLanguage, type Language } from '../../../src/i18n';
import type { Locale } from '../../../src/schema';
import { BrowserScreen, type BrowserScreenHandle } from './browser/BrowserScreen';
import { DEMO_URL } from './browser/model/constants';
import { displayHost } from './browser/model/displayHost';
import { updateRecentTitle } from './browser/model/recentTitle';
import type { FillBrowserNative } from './browser/native';
import { ReturnPill } from './browser/ReturnPill';
import { useBrowserSession } from './browser/useBrowserSession';
import { ConfirmSheet } from './dialogs';
import { Onboarding } from './onboarding/Onboarding';
import { HomeScreen } from './home/HomeScreen';
import { useMT } from './i18n';
import { INITIAL_NAV, backFrom, navReduce, type BrowserOpen, type FocusTarget, type NavAction, type NavState, type Tab } from './navigation';
import { PROFILE_MODULES as RESUME_TAB_MODULES, ResumeTab } from './ResumeTab';
import { startResume } from './ResumeSwitcher';
import { SettingsScreen } from './settings/SettingsScreen';
import { useImportFlow } from './settings/useImportFlow';
import type { IncomingFileSource } from './resumeImport/incoming';
import type { ResumeReader } from './resumeImport/types';
import { useResumeImport } from './resumeImport/useResumeImport';
import type { AppStateStore } from './store/appStateStore';
import { sweepFiles, type FileStore } from './store/fileStore';
import type { ProfileStore } from './store/profileStore';
import type { Wiper } from './store/wipe';
import { TabBar, useKeyboardOpen } from './TabBar';
import { BackStackContext, Toast, createBackStack, type ToastMessage } from './ui';
import { useAppState } from './useAppState';
import { useProfileEditor } from './useProfileEditor';

/** What the app needs from the phone. main.tsx wires it to Capacitor; tests press the keys by hand. */
export interface Platform {
  /** The handler returns true when it used the back key, false to let the system have it (leave the app). */
  onBack(handler: () => boolean): () => void;
  /** The app is going to the background. */
  onPause(handler: () => void): () => void;
  /** Name and version for the About sheet. */
  appInfo?(): Promise<{ name: string; version: string; build: string }>;
  /** Save a file where the person chooses (Android: the system "create document" picker). */
  saveDocument?(file: { name: string; mimeType: string; bytes: Uint8Array }): Promise<'saved' | 'cancelled'>;
  /** PDF and Word files other apps hand over ("open with", "share"). */
  incoming?: IncomingFileSource;
  /** The native fill browser; absent in the browser preview, where pages cannot be opened in the app. */
  fillBrowser?: FillBrowserNative;
}

/** Delete-all also clears the fill browser's cookies, web storage and cache (errors ignored: the data is gone anyway). */
export function withSiteDataClear(wiper: Wiper, fillBrowser: Pick<FillBrowserNative, 'clearSiteData'> | null | undefined): Wiper {
  if (!fillBrowser) return wiper;
  return {
    async wipeAll() {
      await wiper.wipeAll();
      try {
        await fillBrowser.clearSiteData();
      } catch {
        // Site sign-ins are not resume data; a failure here must not report the wipe as failed.
      }
    },
  };
}

/** The real reader, loaded on first use so pdf.js stays out of the start-up bundle. */
const lazyReadResume: ResumeReader = (file, options) => import('./resumeImport/reader').then((m) => m.readResume(file, options));

/** The modules the 简历 tab edits: all of the extension editor's, in its order (attachments last). */
export const PROFILE_MODULES: readonly ModuleMeta[] = RESUME_TAB_MODULES;

/** A deleted file can be brought back from the toast for 8 s; only after that may the sweep clear it. */
export const SWEEP_DELAY_MS = 9000;
/** A file just stored, not yet in the resume, is kept from the sweep this long. */
const HOLD_MS = 60_000;
/** The sweep for a removal runs this much after the removal's hold has ended, so the hold is surely over. */
const SWEEP_MARGIN_MS = 50;
/** The loading line appears only when opening takes longer than this. */
const LOADING_LINE_MS = 300;

interface Props {
  store: ProfileStore;
  files: FileStore;
  appState: AppStateStore;
  wiper: Wiper;
  platform?: Platform;
  autosaveDelayMs?: number;
  sweepDelayMs?: number;
  /** Tests pin the time for relative times. */
  now?: () => number;
  /** Reads a PDF or Word resume; tests pass a fake. */
  resumeReader?: ResumeReader;
}

type ShowToast = (toast: Omit<ToastMessage, 'id'>) => void;

export default function App(props: Props) {
  const t = useMT();
  const [generation, setGeneration] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const backStack = useMemo(() => createBackStack(), []);
  const showToast = useCallback<ShowToast>((next) => setToast({ ...next, id: Date.now() }), []);
  const hideToast = useCallback(() => setToast(null), []);
  const tRef = useRef(t);
  tRef.current = t;
  const onWiped = useCallback(
    (ok: boolean) => {
      setGeneration((g) => g + 1);
      showToast({ text: tRef.current(ok ? 'm.wipe.done' : 'm.wipe.failed') });
    },
    [showToast],
  );
  return (
    <BackStackContext.Provider value={backStack}>
      <AppContent
        key={generation}
        {...props}
        showToast={showToast}
        toast={<Toast toast={toast} onDone={hideToast} />}
        onWiped={onWiped}
      />
    </BackStackContext.Provider>
  );
}

type ShellAction = NavAction | { type: 'replace'; state: NavState };
const shellReduce = (state: NavState, action: ShellAction): NavState => (action.type === 'replace' ? action.state : navReduce(state, action));

function AppContent({
  store,
  files,
  appState: appStateStore,
  wiper,
  platform,
  autosaveDelayMs,
  sweepDelayMs = SWEEP_DELAY_MS,
  now,
  resumeReader = lazyReadResume,
  showToast: appToast,
  toast,
  onWiped,
}: Props & { showToast: ShowToast; toast: ReactNode; onWiped: (ok: boolean) => void }) {
  const t = useMT();
  const language = useLanguage();
  const backStack = useContext(BackStackContext);
  /** While the browser shows, toasts go to its own slot above the toolbar (the page would hide the app's). */
  const browserHandle = useRef<BrowserScreenHandle | null>(null);
  /** Between dispatching openBrowser and the screen mounting, a toast waits for the browser's slot: the app's own would
   * be covered by the opaque browser at once (a failed recent-page save). */
  const openingBrowser = useRef(false);
  const queuedBrowserToast = useRef<Omit<ToastMessage, 'id'> | null>(null);
  const showToast = useCallback<ShowToast>(
    (message) => {
      if (browserHandle.current) browserHandle.current.toast(message);
      else if (openingBrowser.current) queuedBrowserToast.current = message;
      else appToast(message);
    },
    [appToast],
  );
  const editor = useProfileEditor(store, autosaveDelayMs);
  const { profile, edit } = editor;
  const [nav, dispatch] = useReducer(shellReduce, INITIAL_NAV);
  const keyboard = useKeyboardOpen();

  // App state starts once the profile has loaded: a phone that already has resumes (an earlier build) skips
  // onboarding; a profile that cannot be read is not a first run either. Fixed at the first answer.
  const seedRef = useRef<{ hasResumes: boolean } | null>(null);
  if (!seedRef.current && (profile || editor.loadError)) seedRef.current = { hasResumes: profile ? profile.resumes.length > 0 : true };
  const { state: appState, update: updateAppState } = useAppState(appStateStore, seedRef.current);
  const onboarding = appState !== null && !appState.onboardingDone;
  const ready = appState !== null && (profile !== null || editor.loadError !== null);

  const uiLanguage = profile?.settings.uiLanguage;
  useEffect(() => {
    if (uiLanguage) setLanguage(resolveLanguage(uiLanguage, navigator.language));
  }, [uiLanguage]);

  // ------------------------------------------------------------ navigation
  const scrollTop = () => {
    document.documentElement.scrollTop = 0;
  };
  const navRef = useRef(nav);
  navRef.current = nav;
  const onboardingRef = useRef(onboarding);
  onboardingRef.current = onboarding;
  /** Set below once the resume import exists; the back key and the screen focus read them. */
  const resumeImportBack = useRef<() => boolean>(() => false);
  const overlayOpenRef = useRef(false);

  /** Scroll position of each tab's root, restored when coming back to it. */
  const rootScroll = useRef(new Map<Tab, number>());
  const atRoot = (s: NavState) => (s.tab === 'resume' ? s.module === null : s.tab === 'settings' ? s.settingsPage === 'root' : true);
  const selectTab = useCallback((tab: Tab) => {
    const current = navRef.current;
    if (atRoot(current)) rootScroll.current.set(current.tab, document.documentElement.scrollTop);
    dispatch({ type: 'tab', tab });
  }, []);

  // On a new screen (a tab, an onboarding step, a settings page, the shell after onboarding): focus its heading so a
  // screen reader announces it, since the button that was focused may be gone. On a tab change, also go back to where
  // that tab was. The first screen after loading keeps the page's own focus.
  const browserShown = nav.browser !== null && !nav.browser.hidden;
  const screenKey = !ready
    ? 'loading'
    : browserShown
      ? 'browser'
      : onboarding
        ? `onboarding:${nav.onboardingStep}`
        : `${nav.tab}:${nav.tab === 'settings' ? nav.settingsPage : ''}`;
  const lastScreen = useRef<string | null>(null);
  const lastTab = useRef<Tab>(nav.tab);
  useEffect(() => {
    const previous = lastScreen.current;
    lastScreen.current = screenKey;
    const current = navRef.current;
    const tabChanged = lastTab.current !== current.tab;
    lastTab.current = current.tab;
    if (previous === null || previous === 'loading' || screenKey === 'loading' || screenKey === 'browser') return;
    if (overlayOpenRef.current) return; // the import overlay looks after the focus
    if (current.focus) return; // a jump puts the cursor in a field instead
    if (tabChanged) document.documentElement.scrollTop = atRoot(current) ? (rootScroll.current.get(current.tab) ?? 0) : 0;
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }, [screenKey]);

  const openModule = useCallback((module: ModuleMeta['module'] | null) => {
    dispatch({ type: 'module', module });
    scrollTop();
  }, []);
  const focusDone = useCallback(() => dispatch({ type: 'focusDone' }), []);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const makeActive = useCallback(
    (resumeId: string) => {
      const current = profileRef.current;
      if (current && current.activeResumeId !== resumeId && current.resumes.some((r) => r.id === resumeId)) {
        edit((p) => setActive(p, resumeId), { immediate: true });
      }
    },
    [edit],
  );
  const jump = useCallback(
    (resumeId: string, target?: Omit<FocusTarget, 'nonce'>) => {
      makeActive(resumeId);
      if (target) dispatch({ type: 'jump', target });
      else {
        if (navRef.current.tab !== 'resume') dispatch({ type: 'tab', tab: 'resume' });
        dispatch({ type: 'module', module: null });
      }
      scrollTop();
    },
    [makeActive],
  );

  useEffect(() => {
    if (!platform) return;
    const offBack = platform.onBack(() => {
      if (backStack.pop()) return true;
      // An import over everything (a file shared while the page showed) is left first.
      if (overlayOpenRef.current && resumeImportBack.current()) return true;
      const browserNav = navRef.current.browser;
      if (browserNav && !browserNav.hidden) {
        // The page's own history, then close (asking first when a fill ran in this document).
        const open = browserRef.current;
        if (open && open.session.getState().canGoBack) void open.session.back();
        else if (browserHandle.current) browserHandle.current.requestClose();
        else dispatch({ type: 'closeBrowser' });
        return true;
      }
      if (resumeImportBack.current()) return true;
      const next = backFrom(navRef.current, onboardingRef.current);
      if (!next) return false;
      dispatch({ type: 'replace', state: next });
      if (next.tab === navRef.current.tab) scrollTop();
      return true;
    });
    const offPause = platform.onPause(() => void editor.flush());
    return () => {
      offBack();
      offPause();
    };
  }, [platform, backStack, editor.flush]);

  // ------------------------------------------------------------ attachment files no resume points at
  /** Files no resume points at that must still stay, until the time given: a fresh upload, or a delete that can be undone. */
  const held = useRef(new Map<string, number>());
  const hold = useCallback((id: string) => void held.current.set(id, Date.now() + HOLD_MS), []);
  const flush = editor.flush;
  const sweep = useCallback(async () => {
    try {
      await flush(); // so the stored profile is the one on screen
      const current = profileRef.current;
      if (!current) return;
      const stored = await store.load();
      const used = new Set([...referencedFileIds(current), ...referencedFileIds(stored)]);
      // Asked after the files are listed, against the newest state, so an upload that landed meanwhile is kept.
      let usedNow: Set<string> | null = null;
      await sweepFiles(files, (id) => {
        usedNow ??= profileRef.current ? referencedFileIds(profileRef.current) : new Set<string>();
        return used.has(id) || usedNow.has(id) || (held.current.get(id) ?? 0) > Date.now();
      });
      for (const [id, until] of held.current) if (until <= Date.now()) held.current.delete(id);
    } catch {
      // Not sure what is still in use: keep everything; the next start tries again.
    }
  }, [flush, store, files]);
  const refsKey = profile ? JSON.stringify([...referencedFileIds(profile)].sort()) : null;
  const previousRefs = useRef<Set<string> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (refsKey === null) return;
    const refs = new Set(JSON.parse(refsKey) as string[]);
    for (const id of refs) held.current.delete(id); // in a resume now: from here on the resumes decide
    const before = previousRefs.current;
    previousRefs.current = refs;
    if (before === null) {
      void sweep(); // on start: whatever an earlier run left behind
      return;
    }
    const removed = [...before].filter((id) => !refs.has(id));
    if (removed.length > 0) {
      // Each removed file stays through its own undo window, whichever sweep comes first.
      const until = Date.now() + sweepDelayMs;
      for (const id of removed) held.current.set(id, Math.max(until, held.current.get(id) ?? 0));
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        void sweep();
      }, sweepDelayMs + SWEEP_MARGIN_MS);
      timers.current.add(timer);
    }
  }, [refsKey, sweep, sweepDelayMs]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // ------------------------------------------------------------ actions shared by the screens
  const tRef = useRef(t);
  tRef.current = t;
  /** Resolves false (after saying so) when the app state could not be saved; onboarding may then come back. */
  const finishOnboarding = useCallback(async () => {
    const ok = await updateAppState((s) => ({ ...s, onboardingDone: true }));
    if (!ok) showToast({ text: tRef.current('m.saveStateFailed') });
    return ok;
  }, [updateAppState, showToast]);

  const chooseLanguage = useCallback(
    (next: Language) => {
      setLanguage(next);
      const current = profileRef.current;
      if (current && current.settings.uiLanguage !== next) {
        edit((p) => ({ ...p, settings: { ...p.settings, uiLanguage: next } }), { immediate: true });
      }
    },
    [edit],
  );

  const newResume = useCallback(
    (locale: Locale) => {
      const title = t(locale.startsWith('zh') ? 'm.defaultTitle.zh' : 'm.defaultTitle.en');
      edit((p) => startResume(p, locale, title), { immediate: true });
      if (navRef.current.tab !== 'resume') dispatch({ type: 'tab', tab: 'resume' });
      dispatch({ type: 'module', module: null });
      scrollTop();
    },
    [edit, t],
  );

  const importFlow = useImportFlow({
    profile,
    loadError: editor.loadError,
    edit,
    files,
    showToast,
    onImported: () => {
      if (onboardingRef.current) {
        void finishOnboarding();
        dispatch({ type: 'replace', state: INITIAL_NAV });
      }
    },
  });

  const resumeImport = useResumeImport({
    profile,
    loadError: editor.loadError,
    ready,
    edit,
    files,
    reader: resumeReader,
    showToast,
    onStored: hold,
    onImported: (resumeId) => {
      if (onboardingRef.current) {
        void finishOnboarding();
        dispatch({ type: 'replace', state: INITIAL_NAV });
      }
      jump(resumeId);
    },
    onStartBlank: (locale) => {
      if (onboardingRef.current) {
        void finishOnboarding();
        dispatch({ type: 'replace', state: INITIAL_NAV });
      }
      newResume(locale);
    },
    incoming: platform?.incoming,
  });
  resumeImportBack.current = resumeImport.back;
  overlayOpenRef.current = resumeImport.open;

  const readStoredProfile = useCallback(async () => {
    await editor.flush();
    return store.load();
  }, [editor.flush, store]);

  // ------------------------------------------------------------ fill browser
  const fillBrowser = platform?.fillBrowser ?? null;
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const browser = useBrowserSession(fillBrowser, nav.browser?.target ?? null, {
    getFillContext: () => ({ profile: profileRef.current, fillLanguage: appStateRef.current?.fillLanguage ?? 'active' }),
    readFile: (id) => files.read(id),
    onTitle: (recentId, title, host) => void updateAppState((s) => updateRecentTitle(s, recentId, title, host)),
  });
  const browserRef = useRef(browser);
  browserRef.current = browser;
  const browserHidden = nav.browser?.hidden ?? false;
  useEffect(() => {
    browser?.session.setHidden(browserHidden);
  }, [browser?.session, browserHidden]);

  // A file opened with or shared to the app while the page shows: the import overlay takes the screen, so the page
  // steps aside behind the return pill (the native page view would cover the review and take its touches).
  useEffect(() => {
    if (resumeImport.open && browserShown) dispatch({ type: 'hideBrowser' });
  }, [resumeImport.open, browserShown]);

  // The browser screen is up (its session exists, so it has mounted): a toast that waited for it goes to its slot now.
  const browserTarget = nav.browser?.target;
  const browserScreenUp = browserShown && browser !== null;
  useEffect(() => {
    if (!browserScreenUp) return;
    openingBrowser.current = false;
    const queued = queuedBrowserToast.current;
    queuedBrowserToast.current = null;
    if (queued) (browserHandle.current ? browserHandle.current.toast : appToast)(queued);
  }, [browserScreenUp, browserTarget, appToast]);

  // The page's renderer died and took the app's with it: the activity was recreated (FillBrowserPlugin). Say so once.
  const crashAsked = useRef(false);
  useEffect(() => {
    if (!fillBrowser || crashAsked.current) return;
    crashAsked.current = true;
    fillBrowser
      .takeCrashNotice()
      .then(({ crashed }) => {
        if (crashed) appToast({ text: tRef.current('m.br.crash.restarted') });
      })
      .catch(() => undefined);
  }, [fillBrowser, appToast]);

  /** Another page while one is open replaces it, asking first when a fill ran there. */
  const [pendingOpen, setPendingOpen] = useState<BrowserOpen | null>(null);
  const openBrowser = useCallback(
    (target: BrowserOpen) => {
      if (!fillBrowser) {
        showToast({ text: tRef.current('m.br.needsPhone') });
        return;
      }
      const open = browserRef.current;
      if (open && open.state.run.phase === 'done') setPendingOpen(target);
      else {
        openingBrowser.current = true;
        dispatch({ type: 'openBrowser', target });
      }
    },
    [fillBrowser, showToast],
  );
  const closeBrowser = useCallback(() => {
    openingBrowser.current = false;
    const returnTo = navRef.current.browser?.returnTo;
    dispatch({ type: 'closeBrowser' });
    if (returnTo === 'home' && !onboardingRef.current) dispatch({ type: 'tab', tab: 'home' });
    scrollTop();
  }, []);
  const goToResume = useCallback(() => {
    if (onboardingRef.current) void finishOnboarding();
    dispatch({ type: 'hideBrowser' });
    scrollTop();
  }, [finishOnboarding]);

  const wipeAll = useCallback(async (): Promise<boolean> => {
    try {
      await editor.flush();
    } catch {
      // Being deleted anyway.
    }
    // The page goes first, so clearing site data afterwards finds no live WebView writing cookies back.
    try {
      await browserRef.current?.session.dispose();
    } catch {
      // Closing is best effort; the wipe goes on.
    }
    dispatch({ type: 'closeBrowser' });
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    let ok = true;
    try {
      await wiper.wipeAll();
    } catch {
      ok = false;
    }
    dispatch({ type: 'reset' });
    onWiped(ok); // remounts this component, which reloads the profile and app state from storage
    return ok;
  }, [editor.flush, wiper, onWiped]);

  const saveDocument = useMemo(
    () => (platform?.saveDocument ? (file: Parameters<NonNullable<Platform['saveDocument']>>[0]) => platform.saveDocument!(file) : undefined),
    [platform],
  );
  const appInfo = useMemo(() => (platform?.appInfo ? () => platform.appInfo!() : undefined), [platform]);

  // ------------------------------------------------------------ loading line, after a moment
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setSlow(true), LOADING_LINE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  // The bottom bar (return pill + tab bar) grows with the font: toasts sit above whatever height it has now.
  const shellRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = bottomRef.current;
    const shell = shellRef.current;
    if (!bar || !shell || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => shell.style.setProperty('--m-bottom-h', `${Math.round(bar.getBoundingClientRect().height)}px`));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [ready, onboarding, resumeImport.open, browserShown]);

  const lang = language === 'zh' ? 'zh-CN' : 'en';

  const browserElement =
    browser && nav.browser && !nav.browser.hidden ? (
      <BrowserScreen
        key={nav.browser.target.url + String(nav.browser.target.recentId ?? '')}
        open={browser}
        profile={profile}
        files={files}
        fillLanguage={appState?.fillLanguage ?? 'active'}
        handleRef={browserHandle}
        onClose={closeBrowser}
        onGoToResume={goToResume}
        showToast={appToast}
      />
    ) : null;
  const returnPill =
    browser && nav.browser?.hidden && !resumeImport.open ? (
      <ReturnPill
        host={browser.state.host.kind === 'demo' ? t('m.br.demoHost') : browser.state.host.host || displayHost(nav.browser.target.url).host}
        onReturn={() => dispatch({ type: 'showBrowser' })}
      />
    ) : null;
  const replaceSheet = (
    <ConfirmSheet
      open={pendingOpen !== null}
      title={t('m.br.closeTitle')}
      text={t('m.br.closeText')}
      confirmLabel={t('m.br.closeConfirm')}
      danger
      onConfirm={() => {
        const next = pendingOpen;
        setPendingOpen(null);
        if (next) dispatch({ type: 'openBrowser', target: next });
      }}
      onClose={() => setPendingOpen(null)}
    />
  );

  if (!ready || onboarding) {
    return (
      <>
        <main className="m-page" lang={lang} inert={resumeImport.open || browserShown || undefined}>
          {!ready ? (
            slow ? (
              <p className="m-status" role="status">
                {t('m.loading')}
              </p>
            ) : null
          ) : (
            <Onboarding
              step={nav.onboardingStep}
              onStep={(step) => dispatch({ type: 'onboardingStep', step })}
              language={language}
              onLanguage={chooseLanguage}
              onSkip={() => {
                void finishOnboarding();
                dispatch({ type: 'replace', state: INITIAL_NAV });
              }}
              onStartBlank={(locale) => {
                void finishOnboarding();
                // A failed save brings onboarding back; trying again opens the resume made the first time.
                if ((profileRef.current?.resumes.length ?? 0) === 0) newResume(locale);
                else jump(profileRef.current!.activeResumeId ?? profileRef.current!.resumes[0]!.id);
              }}
              onImport={importFlow.start}
              onImportResume={resumeImport.pick}
              onTryDemo={() => openBrowser({ url: DEMO_URL, demo: true, source: 'demo-onboarding' })}
              showToast={showToast}
            />
          )}
        </main>
        {returnPill ? <div className="m-shell__bottom">{returnPill}</div> : null}
        {importFlow.element}
        {resumeImport.element}
        {browserElement}
        {toast}
      </>
    );
  }

  let body: ReactNode;
  switch (nav.tab) {
    case 'home':
      body = (
        <HomeScreen
          profile={profile}
          loadError={editor.loadError}
          appState={appState}
          updateAppState={updateAppState}
          onJump={jump}
          onStartResume={newResume}
          onImport={importFlow.start}
          onImportResume={resumeImport.pick}
          onOpenSettings={() => selectTab('settings')}
          onOpenBrowser={openBrowser}
          showToast={showToast}
          now={now}
        />
      );
      break;
    case 'resume':
      body = (
        <ResumeTab
          editor={editor}
          files={files}
          module={nav.module}
          onModule={openModule}
          focus={nav.focus}
          onFocusDone={focusDone}
          showToast={showToast}
          onStored={hold}
          onImportResume={resumeImport.pick}
          onReadStored={resumeImport.openStored}
        />
      );
      break;
    case 'settings':
      body = (
        <SettingsScreen
          profile={profile}
          loadError={editor.loadError}
          page={nav.settingsPage}
          onPage={(page) => {
            dispatch({ type: 'settingsPage', page });
            scrollTop();
          }}
          language={language}
          onLanguage={chooseLanguage}
          appState={appState}
          updateAppState={updateAppState}
          readStoredProfile={readStoredProfile}
          files={files}
          saveDocument={saveDocument}
          appInfo={appInfo}
          onImport={importFlow.start}
          onWipe={wipeAll}
          clearSiteData={fillBrowser ? () => fillBrowser.clearSiteData() : undefined}
          showToast={showToast}
        />
      );
      break;
  }

  return (
    <div
      ref={shellRef}
      className={['m-shell', keyboard ? 'm-shell--keyboard' : '', resumeImport.open ? 'm-shell--overlay' : ''].filter(Boolean).join(' ')}
    >
      <main className="m-page m-shell__main" lang={lang} inert={resumeImport.open || browserShown || undefined}>
        {body}
      </main>
      {resumeImport.open || browserShown ? null : (
        <div className="m-shell__bottom" ref={bottomRef}>
          {returnPill}
          <TabBar tab={nav.tab} onTab={selectTab} />
        </div>
      )}
      {importFlow.element}
      {resumeImport.element}
      {browserElement}
      {replaceSheet}
      {toast}
    </div>
  );
}
