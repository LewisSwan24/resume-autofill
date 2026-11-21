// One fill-browser session: the state the browser UI binds to (useSyncExternalStore), a pure reducer of the
// native plugin's events, and the wiring around it: the run machine, the page cover, the page view's visibility and,
// when a translator is given, the native FAB. Holds no resume data in its state except inside a finished report
// (the values the page reported writing). Never logs.
import type { FileInfo } from '../../store/fileStore';
import type { FillLanguage } from '../../store/appStateStore';
import type { Profile } from '../../../../../src/schema/resume';
import { PROTOCOL_VERSION } from '../../../../bridge/protocol';
import {
  NATIVE_EVENTS,
  type Capabilities,
  type FabSpec,
  type FillBrowserNative,
  type Insets,
  type ListenerHandle,
  type NativeEventName,
  type NativeEvents,
  type NativeTheme,
} from '../native';
import {
  DEMO_ORIGIN,
  FOCUS_TIMEOUT_MS,
  FRAME_TIMEOUT_MS,
  HELLO_TIMEOUT_MS,
  MAX_FILE_BYTES,
  NEEDS_TIMEOUT_MS,
  UNDO_TIMEOUT_MS,
} from './constants';
import { displayHost } from './displayHost';
import { fabModel, joinA11y, type EngineState, type FabView, type Msg } from './fabModel';
import { MARGIN, anchorFromDrop, placeFab, toAreaBoxes, type Anchor, type Box, type Size } from './fabPlacement';
import { pickResume, type ResumeChoice } from './fillPlan';
import { askFrame, executeFillOne, executeRun, executeUndo, isRunActive, type RunContext, type RunState } from './fillRun';
import { checkInbound, createReplyBook, removeFrame, unreachableCount, type FrameEntry } from './frames';
import { buildReportModel, type ReportModel } from './reportModel';
import { decideExternal, type ExternalDecision } from './urlPolicy';
import { ADVANCE_DEFAULTS, runAutoAdvance, stopAutoAdvance, type PressResult, type StepState } from '../../../../../src/background/autoAdvance';
import type { FillRequestResponse } from '../../../../../src/messaging/protocol';
import { recordStep, stepNumber, summarizeStep, type AdvanceView, type WizardState } from './advance';

export type { ResumeChoice } from './fillPlan';
export type { RunState, UndoResult } from './fillRun';
export type { FrameEntry } from './frames';

export interface BrowserTarget {
  url: string;
  demo: boolean;
  recentId?: string;
}
export type PageError = { kind: 'offline' | 'dns' | 'timeout' | 'ssl' | 'crashed' | 'generic'; host: string };
export type Pending =
  | { kind: 'external'; decision: Exclude<ExternalDecision, { action: 'ignore' } | { action: 'blocked' }> }
  | { kind: 'download'; fileName: string; size: number; url: string; copyable: boolean }
  | { kind: 'fileChooser'; id: number; accept: string[]; multiple: boolean };

/**
 * A short message for the browser's toast slot. `keyParams` are params whose values are i18n keys themselves
 * (translate them first), e.g. `{ what: 'm.br.perm.camera' }`. `id` changes with every toast.
 */
export interface SessionToast {
  id: number;
  key: string;
  params?: Record<string, string | number>;
  keyParams?: Record<string, string>;
}

export interface SessionState {
  target: BrowserTarget;
  generation: number;
  url: string;
  host: ReturnType<typeof displayHost>;
  title: string | null;
  loading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  error: PageError | null;
  capabilities: Capabilities | null;
  isolated: boolean | null;
  engine: EngineState;
  /** { frame, origin, main, count, iframes, incompatible, scanned } */
  frames: FrameEntry[];
  /** Sum of iframes expected − sub-frames checked in, ≥ 0. */
  unreachable: number;
  choice: ResumeChoice;
  run: RunState;
  keyboard: boolean;
  area: Size | null;
  obstacles: Box[];
  fabAnchor: Anchor | null;
  sheet: { open: boolean; modal: boolean };
  pending: Pending | null;
  notice: 'google_login' | null;
  // Extras for the UI:
  /** The session is kept alive behind the 简历 tab (return pill). */
  hidden: boolean;
  /** The FAB found no room over the page: the toolbar shows a 「一键填写」 button instead. */
  fabDocked: boolean;
  toast: SessionToast | null;
  /** Auto-advance on this page: running, or how it last stopped; null before it ever ran. */
  advance: AdvanceView | null;
  /** The steps of a multi-step form filled on this site, for the summary when auto-advance stops. */
  wizard: WizardState | null;
  /** The page shows a Next button after a fill: the report offers auto-advance from this step. */
  stepOffer: { step: number; title: string | null } | null;
}

export interface BrowserSessionDeps {
  target: BrowserTarget;
  native: FillBrowserNative;
  getFillContext(): { profile: Profile | null; fillLanguage: FillLanguage };
  readFile(id: string): Promise<{ info: FileInfo; bytes: Uint8Array } | null>;
  /** App writes it with updateRecentTitle. */
  onTitle(recentId: string, title: string, host: string): void;
  now?: () => number;
  newId?: () => string;
  timeouts?: Partial<Record<'needs' | 'fill' | 'hello' | 'undo' | 'focus', number>>;
  /**
   * Translator for the native FAB's words. When given, the session drives native.setFab itself (fabModel +
   * placeFab) and handles fabTap / fabMoved / fabAction; without it the FAB stays untouched.
   */
  translate?: (key: string, params?: Record<string, string | number>) => string;
}

export type FabTapEvent =
  | { kind: 'fill'; result: Awaited<ReturnType<BrowserSession['fill']>> }
  | { kind: 'report' }
  | { kind: 'explain'; which: 'unsupported' | 'missing' };

export interface BrowserSession {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  start(insets: Insets, theme: NativeTheme): Promise<void>;
  setInsets(i: Insets): void;
  setTheme(t: NativeTheme): void;
  setHidden(hidden: boolean): void;
  back(): Promise<boolean>;
  forward(): void;
  reloadOrStop(): void;
  retry(): void;
  choose(choice: ResumeChoice): void;
  fill(): Promise<'started' | 'busy' | 'no_resume' | 'unavailable'>;
  confirmLarge(go: boolean): void;
  /** Answer to the confirmSites question: true fills the other sites' frames too. */
  confirmSites(go: boolean): void;
  focus(rowKey: string): Promise<'ok' | 'gone'>;
  /** 「这次填上」: write the sensitive field of this row once, whatever the setting says. */
  fillOne(rowKey: string): Promise<'ok' | 'gone' | 'failed'>;
  undo(): Promise<void>;
  /** Auto-advance from this step to the last page; the UI has asked the person first (once per site). */
  startAdvance(): void;
  /** Stop auto-advance before its next step. */
  stopAdvance(): void;
  /** Drives setPageCover scrim and FAB hiding. */
  setSheet(s: { open: boolean; modal: boolean }): void;
  moveFab(drop: { x: number; y: number }): void;
  switchFabSide(): void;
  answerExternal(open: boolean): Promise<void>;
  answerFile(answer: { kind: 'stored'; fileId: string } | { kind: 'system' } | { kind: 'cancel' }): Promise<'ok' | 'too_big' | 'failed'>;
  dismissPending(): void;
  dismissNotice(): void;
  dispose(): Promise<void>;
  // Extras:
  /** What a FAB tap did (only when deps.translate is given, i.e. the session drives the FAB). */
  onFabTap(listener: (e: FabTapEvent) => void): () => void;
  /** The native scrim over the page was tapped (close the modal sheet). */
  onScrimTap(listener: () => void): () => void;
}

// ---------------------------------------------------------------- pure state

export function initialSessionState(target: BrowserTarget): SessionState {
  return {
    target,
    generation: 0,
    url: target.url,
    host: displayHost(target.url),
    title: null,
    loading: true,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
    capabilities: null,
    isolated: null,
    engine: 'waiting',
    frames: [],
    unreachable: 0,
    choice: { kind: 'default' },
    run: { phase: 'idle' },
    keyboard: false,
    area: null,
    obstacles: [],
    fabAnchor: null,
    sheet: { open: false, modal: false },
    pending: null,
    notice: null,
    hidden: false,
    fabDocked: false,
    toast: null,
    advance: null,
    wizard: null,
    stepOffer: null,
  };
}

export type NativeEvent = { [E in NativeEventName]: { type: E; payload: NativeEvents[E] } }[NativeEventName];

const googleNotice = (url: string): SessionState['notice'] => {
  try {
    return new URL(url).hostname.toLowerCase() === 'accounts.google.com' ? 'google_login' : null;
  } catch {
    return null;
  }
};

const isHttp = (url: string): boolean => /^https?:/i.test(url);

const toast = (s: SessionState, key: string, extra: Omit<SessionToast, 'id' | 'key'> = {}): SessionToast => ({ id: (s.toast?.id ?? 0) + 1, key, ...extra });

const PERMISSION_KEY: Readonly<Record<NativeEvents['permission']['kind'], string>> = {
  camera: 'm.br.perm.camera',
  microphone: 'm.br.perm.microphone',
  location: 'm.br.perm.location',
  other: 'm.br.perm.other',
};

/** A page message through the inbound checks; returns the accepted message for reply matching. */
export function applyMessage(state: SessionState, payload: NativeEvents['message']) {
  const checked = checkInbound({ generation: state.generation, frames: state.frames }, payload);
  const message = checked.message;
  if (checked.state.frames === state.frames && !message) return { state, message: null, frame: null };
  let next: SessionState = { ...state, frames: checked.state.frames, unreachable: unreachableCount(checked.state) };
  if (message?.kind === 'hello' && payload.main && (state.engine === 'waiting' || state.engine === 'missing')) next.engine = 'ready';
  if (message?.kind === 'obstacles') {
    next = { ...next, obstacles: state.area ? toAreaBoxes(message.boxes, message.viewport, state.area) : [] };
  }
  return { state: next, message, frame: checked.frame };
}

/** All event handling of the session, pure. Wiring (timers, native calls, onTitle) lives in createBrowserSession. */
export function reduceNativeEvent(state: SessionState, event: NativeEvent): SessionState {
  switch (event.type) {
    case 'navigation': {
      const e = event.payload;
      const nav = { url: e.url, host: displayHost(e.url), canGoBack: e.canGoBack, canGoForward: e.canGoForward };
      if (e.phase === 'started' && e.generation !== state.generation) {
        const run: RunState = isRunActive(state.run) ? { phase: 'failed', code: 'failed' } : { phase: 'idle' };
        return {
          ...state,
          ...nav,
          generation: e.generation,
          frames: [],
          unreachable: 0,
          obstacles: [],
          title: null,
          loading: true,
          progress: 0,
          error: null,
          engine: state.engine === 'unsupported' ? 'unsupported' : 'waiting',
          run,
          notice: googleNotice(e.url),
          stepOffer: null,
        };
      }
      if (e.phase === 'started') return { ...state, ...nav, loading: true, notice: googleNotice(e.url) };
      if (e.phase === 'finished') return { ...state, ...nav, loading: false, progress: 100 };
      return { ...state, ...nav, notice: googleNotice(e.url) };
    }
    case 'progress':
      return { ...state, progress: Math.max(0, Math.min(100, event.payload.value)) };
    case 'title':
      return event.payload.generation === state.generation ? { ...state, title: event.payload.title } : state;
    case 'loadError': {
      const host = displayHost(event.payload.url).host || state.host.host;
      return { ...state, error: { kind: event.payload.kind, host }, loading: false };
    }
    case 'crashed':
      return {
        ...state,
        error: { kind: 'crashed', host: state.host.host },
        loading: false,
        frames: [],
        unreachable: 0,
        run: isRunActive(state.run) ? { phase: 'failed', code: 'failed' } : state.run.phase === 'done' ? { phase: 'idle' } : state.run,
      };
    case 'frameGone': {
      const frames = removeFrame({ generation: state.generation, frames: state.frames }, event.payload.frame, event.payload.generation);
      return frames.frames === state.frames ? state : { ...state, frames: frames.frames, unreachable: unreachableCount(frames) };
    }
    case 'message':
      return applyMessage(state, event.payload).state;
    case 'external': {
      const decision = decideExternal(event.payload);
      if (decision.action === 'ignore') return state;
      if (decision.action === 'blocked') return { ...state, toast: toast(state, 'm.br.ext.blocked') };
      return { ...state, pending: { kind: 'external', decision } };
    }
    case 'download': {
      const e = event.payload;
      const copyable = isHttp(e.url);
      return { ...state, pending: { kind: 'download', fileName: e.fileName, size: e.size, url: e.url, copyable } };
    }
    case 'fileChooser': {
      const e = event.payload;
      return { ...state, pending: { kind: 'fileChooser', id: e.id, accept: e.accept, multiple: e.multiple } };
    }
    case 'permission':
      return { ...state, toast: toast(state, 'm.br.perm.denied', { keyParams: { what: PERMISSION_KEY[event.payload.kind] } }) };
    case 'keyboard':
      return event.payload.visible === state.keyboard ? state : { ...state, keyboard: event.payload.visible };
    case 'pageArea': {
      const { width, height } = event.payload;
      return state.area && state.area.width === width && state.area.height === height ? state : { ...state, area: { width, height } };
    }
    default:
      return state;
  }
}

/** The report sheet's model for a finished run, or null. */
export function reportOf(state: SessionState): ReportModel | null {
  const run = state.run;
  if (run.phase !== 'done') return null;
  return buildReportModel({
    report: run.report,
    liveFrames: new Set(state.frames.filter((f) => !f.incompatible).map((f) => f.frame)),
    unreachable: state.unreachable,
    fallback: run.fallback,
    isolated: state.isolated,
    handedOver: run.handedOver,
    undo: run.undo,
  });
}

// ---------------------------------------------------------------- wiring

const CHUNK = 0x8000;
/**
 * Same as toBase64 in store/fileStore.ts, copied so the model does not pull in that module (it lazily imports the
 * extension's src/storage for the desktop preview).
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

const DEFAULT_FAB: Size = { width: 140, height: 56 };
const v = PROTOCOL_VERSION as 1;

let idCounter = 0;
const defaultId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r${Date.now().toString(36)}${(++idCounter).toString(36)}`;

function originOf(url: string): string | null {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

/** runAutoAdvance keys its runs by tab: each session is its own "tab". */
let nextAdvanceTab = 1;

export function createBrowserSession(deps: BrowserSessionDeps): BrowserSession {
  const native = deps.native;
  const newId = deps.newId ?? defaultId;
  const timeouts = {
    needs: deps.timeouts?.needs ?? NEEDS_TIMEOUT_MS,
    fill: deps.timeouts?.fill ?? FRAME_TIMEOUT_MS,
    hello: deps.timeouts?.hello ?? HELLO_TIMEOUT_MS,
    undo: deps.timeouts?.undo ?? UNDO_TIMEOUT_MS,
    focus: deps.timeouts?.focus ?? FOCUS_TIMEOUT_MS,
  };
  const book = createReplyBook();
  const listeners = new Set<() => void>();
  const tapListeners = new Set<(e: FabTapEvent) => void>();
  const scrimListeners = new Set<() => void>();
  const handles: Promise<ListenerHandle>[] = [];

  let state = initialSessionState(deps.target);
  let theme: NativeTheme | null = null;
  let lastRequestedUrl = deps.target.url;
  let helloTimer: ReturnType<typeof setTimeout> | undefined;
  let settling = false;
  let disposed = false;
  let largeAnswer: ((go: boolean) => void) | null = null;
  let sentVisible = true;
  let sentCover = { block: false, scrim: false };
  let fabSize: Size = DEFAULT_FAB;
  let lastFabSpec = '';
  let lastPlacementSide: 'start' | 'end' = 'end';
  let fabChain: Promise<void> = Promise.resolve();

  const ignore = () => undefined;

  function setState(next: SessionState): void {
    if (next === state || disposed) return;
    state = next;
    afterChange();
    for (const l of [...listeners]) l();
  }
  const patch = (p: Partial<SessionState>) => setState({ ...state, ...p });

  function afterChange(): void {
    const visible = !state.hidden && !state.error;
    if (visible !== sentVisible) {
      sentVisible = visible;
      native.setVisible({ visible }).catch(ignore);
    }
    const scrim = state.sheet.open && state.sheet.modal;
    const cover = { block: isRunActive(state.run) || scrim, scrim };
    if (cover.block !== sentCover.block || cover.scrim !== sentCover.scrim) {
      sentCover = cover;
      native.setPageCover(cover).catch(ignore);
    }
    syncFab();
  }

  // ---- FAB

  function currentFab(): FabView | null {
    if (state.hidden || state.advance?.running) return null;
    return fabModel({ engine: state.engine, frames: state.frames, run: state.run, settling });
  }

  function syncFab(): void {
    if (!deps.translate || disposed) return;
    fabChain = fabChain.then(pushFab).catch(ignore);
  }

  async function sendFab(spec: FabSpec): Promise<Size> {
    const key = JSON.stringify(spec);
    if (key === lastFabSpec) return fabSize;
    lastFabSpec = key;
    const size = await native.setFab(spec);
    return spec.visible && size.width > 0 && size.height > 0 ? size : fabSize;
  }

  async function pushFab(): Promise<void> {
    const tr = deps.translate;
    if (!tr || disposed) return;
    const s = state;
    const fab = currentFab();
    if (!fab || !s.area || !theme) {
      await sendFab({ visible: false });
      return;
    }
    const say = (m: Msg) => tr(m.key, m.params);
    const base = {
      visible: true as const,
      icon: fab.icon,
      text: say(fab.text),
      subtext: fab.subtext ? say(fab.subtext) : null,
      a11y: joinA11y(fab.a11y.map(say)),
      switchSideLabel: tr('m.br.fab.switchSide'),
      theme,
    };
    const hidden = { keyboard: s.keyboard, sheet: s.sheet.open, error: s.error !== null, loading: false };
    for (let attempt = 0; attempt < 2; attempt++) {
      const place = placeFab({ area: s.area, fab: fabSize, obstacles: s.obstacles, anchor: s.fabAnchor, hidden });
      const docked = place.docked === true;
      if (docked !== state.fabDocked) patch({ fabDocked: docked });
      if (!place.show) {
        await sendFab({ visible: false });
        return;
      }
      lastPlacementSide = place.side;
      const measured = await sendFab({ ...base, x: place.x, y: place.y });
      if (measured.width === fabSize.width && measured.height === fabSize.height) return;
      fabSize = measured;
    }
  }

  async function onFabTap(): Promise<void> {
    const fab = currentFab();
    if (!fab) return;
    let event: FabTapEvent;
    if (fab.tap === 'report') event = { kind: 'report' };
    else if (fab.tap === 'explainUnsupported') event = { kind: 'explain', which: 'unsupported' };
    else if (fab.tap === 'explainMissing') event = { kind: 'explain', which: 'missing' };
    else event = { kind: 'fill', result: await session.fill() };
    for (const l of [...tapListeners]) l(event);
  }

  // ---- hello timer (engine missing) and settling (FAB scanning)

  function clearHello(): void {
    if (helloTimer !== undefined) clearTimeout(helloTimer);
    helloTimer = undefined;
    settling = false;
  }

  function armHello(): void {
    clearHello();
    if (!isHttp(state.url)) return;
    settling = true;
    const generation = state.generation;
    helloTimer = setTimeout(() => {
      helloTimer = undefined;
      settling = false;
      if (state.generation !== generation) return;
      const hasMain = state.frames.some((f) => f.main && !f.incompatible);
      if (!hasMain && state.engine === 'waiting') patch({ engine: 'missing' });
      else syncFab();
    }, timeouts.hello);
  }

  // ---- steps of a multi-step form, and auto-advance

  /** Per run: the step read after it finished (the summary line and the offer). */
  const stepChecks = new Map<string, Promise<void>>();
  const advanceTab = nextAdvanceTab++;
  let advanceBase = 0;

  function mainFrame(): FrameEntry | undefined {
    return state.frames.find((f) => f.main && !f.incompatible);
  }

  async function askStep(): Promise<(StepState & { title: string | null }) | null> {
    const main = mainFrame();
    if (!main) return null;
    const answer = await askFrame(runCtx, main.frame, state.generation, 'step', (reqId) => ({ v, kind: 'step', reqId }), timeouts.focus);
    return answer?.kind === 'step' ? answer.state : null;
  }

  /** After a fill: which step this is, what it got, and whether the page offers a Next to advance with. */
  async function checkStep(run: Extract<RunState, { phase: 'done' }>): Promise<void> {
    const step = await askStep().catch(() => null);
    const now = state.run;
    if (!step || now.phase !== 'done' || now.runId !== run.runId) return;
    const origin = originOf(state.url);
    if (!origin) return;
    const wizard = recordStep(state.wizard, origin, summarizeStep(run.report, step.fingerprint, step.title));
    const offer = step.action === 'next' && !state.advance?.running ? { step: stepNumber(wizard, step.fingerprint), title: step.title } : null;
    patch({ wizard, stepOffer: offer });
  }

  /** Fill the step auto-advance has just reached, and wait until its report and step line are in. */
  async function fillForAdvance(origin: string): Promise<FillRequestResponse> {
    if (originOf(state.url) !== origin) return { ok: false, error: 'origin_changed' };
    const started = startRun();
    if (started !== 'started') return { ok: false, error: 'fill_failed' };
    await until(() => !isRunActive(state.run));
    const run = state.run;
    if (run.phase === 'done') {
      await stepChecks.get(run.runId);
      return { ok: true };
    }
    if (run.phase === 'failed' && run.code === 'no_frames') return { ok: false, error: 'no_frames' };
    return { ok: false, error: 'fill_failed' };
  }

  function until(done: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      if (done() || disposed) {
        resolve();
        return;
      }
      const off = session.subscribe(() => {
        if (!done() && !disposed) return;
        off();
        resolve();
      });
    });
  }

  function startRun(): 'started' | 'no_resume' | 'unavailable' | 'busy' {
    if (state.engine === 'unsupported') return 'unavailable';
    if (isRunActive(state.run)) return 'busy';
    const ctx = deps.getFillContext();
    const pick = pickResume(originOf(state.url) ?? '', state.choice, ctx.profile, ctx.fillLanguage);
    if ('empty' in pick) return 'no_resume';
    const sensitiveFields = ctx.profile?.settings.sensitiveFields === 'fill' ? ('fill' as const) : undefined;
    void executeRun(runCtx, { ...pick, ...(sensitiveFields ? { sensitiveFields } : {}) }).catch(() => {
      if (isRunActive(state.run)) patch({ run: { phase: 'failed', code: 'failed' } });
    });
    return 'started';
  }

  // ---- run context

  const runCtx: RunContext = {
    generation: () => state.generation,
    frames: () => state.frames.filter((f) => !f.incompatible),
    post: async (frame, generation, data) => (await native.post({ frame, generation, data })).delivered,
    book,
    newId,
    timeouts,
    loadFile: async (id) => {
      const file = await deps.readFile(id);
      if (!file || file.bytes.length > MAX_FILE_BYTES || file.info.size > MAX_FILE_BYTES) return null;
      const type = file.info.type || 'application/octet-stream';
      return { info: file.info, data: { name: file.info.name, type, dataUrl: `data:${type};base64,${toBase64(file.bytes)}` } };
    },
    getRun: () => state.run,
    setRun: (run) => {
      patch({ run });
      if (run.phase === 'done' && !run.undo && !stepChecks.has(run.runId)) stepChecks.set(run.runId, checkStep(run));
    },
    confirmLarge: () =>
      new Promise<boolean>((resolve) => {
        largeAnswer = resolve;
      }),
    // One question at a time, so both share the answer slot (and every reset that answers no).
    confirmSites: () =>
      new Promise<boolean>((resolve) => {
        largeAnswer = resolve;
      }),
  };

  function resolveLarge(go: boolean): void {
    const answer = largeAnswer;
    largeAnswer = null;
    answer?.(go);
  }

  // ---- events

  function handle(event: NativeEvent): void {
    if (disposed) return;
    switch (event.type) {
      case 'message': {
        const r = applyMessage(state, event.payload);
        setState(r.state);
        if (r.message) book.settle(event.payload.frame, r.message);
        return;
      }
      case 'navigation': {
        const e = event.payload;
        const newDoc = e.phase === 'started' && e.generation !== state.generation;
        if (newDoc) {
          clearHello();
          book.cancelAll();
          resolveLarge(false);
          lastRequestedUrl = e.url;
        }
        setState(reduceNativeEvent(state, event));
        if (e.phase === 'finished' && e.generation === state.generation) armHello();
        return;
      }
      case 'title': {
        const before = state;
        setState(reduceNativeEvent(state, event));
        const t = deps.target;
        if (state !== before && t.recentId && !t.demo) deps.onTitle(t.recentId, event.payload.title, state.host.host);
        return;
      }
      case 'crashed':
        clearHello();
        book.cancelAll();
        resolveLarge(false);
        setState(reduceNativeEvent(state, event));
        return;
      case 'fabTap':
        if (deps.translate) void onFabTap();
        return;
      case 'fabMoved':
        if (deps.translate) session.moveFab(event.payload);
        return;
      case 'fabAction':
        if (deps.translate && event.payload.action === 'switchSide') session.switchFabSide();
        return;
      case 'scrimTap':
        for (const l of [...scrimListeners]) l();
        return;
      default:
        setState(reduceNativeEvent(state, event));
    }
  }

  const session: BrowserSession = {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(insets, t) {
      theme = t;
      for (const name of NATIVE_EVENTS) {
        handles.push(native.addListener(name, (payload) => handle({ type: name, payload } as NativeEvent)));
      }
      await Promise.all(handles);
      // Closed while starting (back pressed at once): open nothing, or the page would cover the app with no owner.
      if (disposed) return;
      let caps: Capabilities | null = null;
      try {
        caps = await native.capabilities();
      } catch {
        caps = null;
      }
      if (disposed) return;
      if (caps) {
        const unsupported = !caps.documentStartScript || !caps.messageListener;
        patch({ capabilities: caps, ...(unsupported ? { engine: 'unsupported' as const } : {}) });
      }
      try {
        const { isolated } = await native.open({ url: deps.target.url, insets, theme: t });
        // dispose() ran while the open call was on its way: its close went first, so close the new page too.
        if (disposed) {
          await native.close().catch(ignore);
          return;
        }
        patch({ isolated });
      } catch {
        patch({ error: { kind: 'generic', host: state.host.host }, loading: false });
      }
    },

    setInsets(i) {
      native.setInsets(i).catch(ignore);
    },

    setTheme(t) {
      theme = t;
      native.setTheme(t).catch(ignore);
      syncFab();
    },

    setHidden(hidden) {
      if (hidden !== state.hidden) patch({ hidden });
    },

    async back() {
      if (!state.canGoBack) return false;
      await native.navigate({ action: 'back' }).catch(ignore);
      return true;
    },

    forward() {
      if (state.canGoForward) native.navigate({ action: 'forward' }).catch(ignore);
    },

    reloadOrStop() {
      // A reload starts the form over: what earlier steps got, and how the last auto-advance stopped, no longer hold.
      if (!state.loading && !state.advance?.running) patch({ wizard: null, advance: null, stepOffer: null });
      native.navigate({ action: state.loading ? 'stop' : 'reload' }).catch(ignore);
    },

    retry() {
      patch({ error: null, loading: true });
      native.loadUrl({ url: lastRequestedUrl }).catch(ignore);
    },

    choose(choice) {
      patch({ choice });
    },

    async fill() {
      if (state.advance?.running) return 'busy';
      const started = startRun();
      // A fill by hand starts afresh: the last auto-advance stop belongs to the run that ended.
      if (started === 'started' && state.advance) patch({ advance: null });
      return started;
    },

    confirmLarge(go) {
      resolveLarge(go);
    },

    confirmSites(go) {
      if (state.run.phase === 'confirmSites') resolveLarge(go);
    },

    async focus(rowKey) {
      const colon = rowKey.indexOf(':');
      const frame = Number(rowKey.slice(0, colon));
      const fieldId = rowKey.slice(colon + 1);
      if (colon < 0 || !Number.isInteger(frame) || !state.frames.some((f) => f.frame === frame && !f.incompatible)) return 'gone';
      const answer = await askFrame(runCtx, frame, state.generation, 'focus', (reqId) => ({ v, kind: 'focus', reqId, fieldId }), timeouts.focus);
      return answer?.kind === 'focused' && answer.ok ? 'ok' : 'gone';
    },

    async fillOne(rowKey) {
      const ctx = deps.getFillContext();
      const pick = pickResume(originOf(state.url) ?? '', state.choice, ctx.profile, ctx.fillLanguage);
      if ('empty' in pick || pick.sample) return 'gone';
      return executeFillOne(runCtx, rowKey, pick.resume).catch(() => 'failed' as const);
    },

    async undo() {
      await executeUndo(runCtx);
    },

    startAdvance() {
      if (state.advance?.running || isRunActive(state.run)) return;
      const origin = originOf(state.url);
      if (!origin) return;
      // Going on after a stop on the same form keeps counting; another site starts again.
      advanceBase = state.advance && state.wizard?.origin === origin ? state.advance.steps : 0;
      patch({ advance: { running: true, steps: advanceBase }, stepOffer: null });
      void runAutoAdvance(advanceTab, {
        ...ADVANCE_DEFAULTS,
        readStep: async () => {
          const step = await askStep();
          if (!step) return null;
          const { title: _title, ...rest } = step;
          return rest;
        },
        pressNext: async (): Promise<PressResult> => {
          const main = mainFrame();
          if (!main) return { pressed: false };
          const answer = await askFrame(runCtx, main.frame, state.generation, 'press', (reqId) => ({ v, kind: 'press', reqId }), timeouts.focus);
          if (answer?.kind !== 'pressed') return { pressed: false };
          return answer.reason ? { pressed: answer.pressed, reason: answer.reason } : { pressed: answer.pressed };
        },
        fill: (_tab, at) => fillForAdvance(at),
        sessionOrigin: async () => (originOf(state.url) === origin ? origin : null),
        publish: async (_tab, a) => {
          const view: AdvanceView = { running: a.running, steps: advanceBase + a.steps, ...(a.stopReason ? { stopReason: a.stopReason } : {}) };
          patch({ advance: view, ...(a.running ? { stepOffer: null } : {}) });
        },
        now: deps.now ?? (() => Date.now()),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }).catch(() => {
        if (state.advance?.running) patch({ advance: { running: false, steps: state.advance.steps, stopReason: 'no_page' } });
      });
    },

    stopAdvance() {
      stopAutoAdvance(advanceTab);
    },

    setSheet(s) {
      if (s.open !== state.sheet.open || s.modal !== state.sheet.modal) patch({ sheet: { open: s.open, modal: s.open && s.modal } });
    },

    moveFab(drop) {
      if (!state.area) return;
      patch({ fabAnchor: anchorFromDrop(drop, fabSize, state.area) });
    },

    switchFabSide() {
      const side = state.fabAnchor?.side ?? lastPlacementSide;
      patch({ fabAnchor: { side: side === 'end' ? 'start' : 'end', fromBottom: state.fabAnchor?.fromBottom ?? MARGIN } });
    },

    async answerExternal(open) {
      const pending = state.pending;
      if (pending?.kind !== 'external') return;
      patch({ pending: null });
      if (!open) return;
      const d = pending.decision;
      if (d.action === 'ask') {
        let opened = false;
        try {
          opened = (await native.openExternal({ url: d.url })).opened;
        } catch {
          opened = false;
        }
        if (!opened) patch({ toast: toast(state, 'm.br.ext.noApp') });
      } else if (d.action === 'fallback') {
        lastRequestedUrl = d.url;
        await native.loadUrl({ url: d.url }).catch(ignore);
      }
    },

    async answerFile(answer) {
      const pending = state.pending;
      if (pending?.kind !== 'fileChooser') return 'failed';
      const id = pending.id;
      if (answer.kind === 'stored') {
        let file: { info: FileInfo; bytes: Uint8Array } | null = null;
        try {
          file = await deps.readFile(answer.fileId);
        } catch {
          file = null;
        }
        if (!file) return 'failed';
        if (file.bytes.length > MAX_FILE_BYTES || file.info.size > MAX_FILE_BYTES) return 'too_big';
        try {
          await native.answerFileChooser({
            id,
            kind: 'files',
            files: [{ name: file.info.name, mimeType: file.info.type || 'application/octet-stream', data: toBase64(file.bytes) }],
          });
        } catch {
          return 'failed';
        }
      } else {
        await native.answerFileChooser({ id, kind: answer.kind }).catch(ignore);
      }
      if (state.pending === pending) patch({ pending: null });
      return 'ok';
    },

    dismissPending() {
      const pending = state.pending;
      if (!pending) return;
      if (pending.kind === 'fileChooser') native.answerFileChooser({ id: pending.id, kind: 'cancel' }).catch(ignore);
      patch({ pending: null });
    },

    dismissNotice() {
      if (state.notice) patch({ notice: null });
    },

    async dispose() {
      if (disposed) return;
      stopAutoAdvance(advanceTab);
      clearHello();
      book.cancelAll();
      resolveLarge(false);
      disposed = true;
      listeners.clear();
      tapListeners.clear();
      scrimListeners.clear();
      for (const h of handles) await h.then((x) => x.remove()).catch(ignore);
      await native.close().catch(ignore);
    },

    onFabTap(listener) {
      tapListeners.add(listener);
      return () => tapListeners.delete(listener);
    },

    onScrimTap(listener) {
      scrimListeners.add(listener);
      return () => scrimListeners.delete(listener);
    },
  };
  return session;
}

/** True on the built-in demo form. */
export const isDemoState = (state: SessionState): boolean => state.host.kind === 'demo' || state.url.startsWith(DEMO_ORIGIN + '/');
