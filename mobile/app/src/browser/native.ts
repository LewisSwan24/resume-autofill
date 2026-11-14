// The native fill browser's contract (Capacitor plugin "FillBrowser"). FillBrowserPlugin.java implements it, and
// the session model (model/session.ts) is its only caller apart from clearSiteData. All lengths are dp (= CSS px of
// the UI WebView); colours are ARGB ints. createFakeFillBrowser() is the stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

export interface Insets {
  top: number;
  bottom: number;
}
export interface NativeTheme {
  bg: number;
  surface: number;
  text: number;
  line: number;
  accent: number;
  scrim: number;
}

export interface Capabilities {
  documentStartScript: boolean;
  messageListener: boolean;
  isolatedWorld: boolean;
  /** e.g. "com.google.android.webview" */
  webViewPackage: string | null;
  /** versionName, e.g. "133.0.6943.137" */
  webViewVersion: string | null;
}

export type FabIcon = 'magic' | 'busy' | 'report' | 'warning';
export type FabSpec =
  | { visible: false }
  | {
      visible: true;
      icon: FabIcon;
      text: string;
      subtext: string | null;
      a11y: string;
      switchSideLabel: string;
      theme: NativeTheme;
      x?: number;
      y?: number;
    };

export type FileChooserAnswer = { id: number } & (
  | { kind: 'files'; files: { name: string; mimeType: string; data: string }[] }
  | { kind: 'system' }
  | { kind: 'cancel' }
);

export interface NativeEvents {
  message: { frame: number; generation: number; origin: string; main: boolean; data: string };
  frameGone: { frame: number; generation: number };
  navigation: {
    phase: 'started' | 'finished' | 'history';
    url: string;
    generation: number;
    canGoBack: boolean;
    canGoForward: boolean;
  };
  /** 0..100 */
  progress: { value: number };
  title: { title: string; generation: number };
  loadError: { kind: 'offline' | 'dns' | 'timeout' | 'ssl' | 'generic'; url: string; code: number };
  crashed: Record<string, never>;
  external: { url: string; gesture: boolean; main: boolean };
  /** size -1 when unknown */
  download: { url: string; mimeType: string; fileName: string; size: number };
  fileChooser: { id: number; accept: string[]; multiple: boolean; capture: boolean };
  permission: { kind: 'camera' | 'microphone' | 'location' | 'other' };
  keyboard: { visible: boolean; height: number };
  pageArea: { width: number; height: number };
  fabTap: Record<string, never>;
  fabMoved: { x: number; y: number };
  fabAction: { action: 'switchSide' };
  scrimTap: Record<string, never>;
}

export type NativeEventName = keyof NativeEvents;

export interface ListenerHandle {
  remove(): Promise<void>;
}

export interface FillBrowserNative {
  capabilities(): Promise<Capabilities>;
  /** Create the page WebView (replacing any previous one) and load url. */
  open(o: { url: string; insets: Insets; theme: NativeTheme }): Promise<{ isolated: boolean }>;
  close(): Promise<void>;
  setVisible(o: { visible: boolean }): Promise<void>;
  setInsets(o: Insets): Promise<void>;
  setTheme(o: NativeTheme): Promise<void>;
  loadUrl(o: { url: string }): Promise<void>;
  navigate(o: { action: 'back' | 'forward' | 'reload' | 'stop' }): Promise<void>;
  /** Deliver a command to one frame of the current generation. */
  post(o: { frame: number; generation: number; data: string }): Promise<{ delivered: boolean }>;
  /** Blocker (fill running) and scrim (modal sheet). scrim implies blocking. */
  setPageCover(o: { block: boolean; scrim: boolean }): Promise<void>;
  /** Show, update or hide the FAB; resolves its measured size. Position is page-area relative, top-left. */
  setFab(o: FabSpec): Promise<{ width: number; height: number }>;
  answerFileChooser(o: FileChooserAnswer): Promise<void>;
  /** tel:, mailto:, sms:, smsto: (DIAL / SENDTO) and http(s) (VIEW, chooser). Anything else: opened = false. */
  openExternal(o: { url: string }): Promise<{ opened: boolean }>;
  /** Cookies, web storage, HTTP cache, form data of every site. */
  clearSiteData(): Promise<void>;
  /** True once after the activity was recreated because the WebView renderer died (it serves the app's UI too). */
  takeCrashNotice(): Promise<{ crashed: boolean }>;
  addListener<E extends NativeEventName>(event: E, cb: (e: NativeEvents[E]) => void): Promise<ListenerHandle>;
}

/** Every plugin method; FillBrowserPlugin.java has exactly these @PluginMethods (tests/unit/mobile/nativeContract). */
export const NATIVE_METHODS = [
  'capabilities',
  'open',
  'close',
  'setVisible',
  'setInsets',
  'setTheme',
  'loadUrl',
  'navigate',
  'post',
  'setPageCover',
  'setFab',
  'answerFileChooser',
  'openExternal',
  'clearSiteData',
  'takeCrashNotice',
] as const;

/** Every event the plugin emits with notifyListeners. */
export const NATIVE_EVENTS = [
  'message',
  'frameGone',
  'navigation',
  'progress',
  'title',
  'loadError',
  'crashed',
  'external',
  'download',
  'fileChooser',
  'permission',
  'keyboard',
  'pageArea',
  'fabTap',
  'fabMoved',
  'fabAction',
  'scrimTap',
] as const;

// Compile-time check that the lists and the types agree.
type MethodName = Exclude<keyof FillBrowserNative, 'addListener'>;
const methodsComplete: Record<MethodName, true> = Object.fromEntries(NATIVE_METHODS.map((m) => [m, true])) as Record<
  (typeof NATIVE_METHODS)[number],
  true
>;
const eventsComplete: Record<NativeEventName, true> = Object.fromEntries(NATIVE_EVENTS.map((e) => [e, true])) as Record<
  (typeof NATIVE_EVENTS)[number],
  true
>;
void methodsComplete;
void eventsComplete;

/** The real plugin (only on a phone). */
export function createNativeFillBrowser(): FillBrowserNative {
  return registerPlugin<FillBrowserNative>('FillBrowser');
}

// ---------------------------------------------------------------- fake for tests

export interface FakeCall {
  method: MethodName;
  args: unknown;
}

export interface FakeFillBrowser extends FillBrowserNative {
  /** Every method call in order (addListener excluded). */
  readonly calls: FakeCall[];
  /** Data strings of post() calls, with frame and generation. */
  readonly posts: { frame: number; generation: number; data: string }[];
  /** Calls of one method, args only. */
  callsOf<M extends MethodName>(method: M): Parameters<FillBrowserNative[M]>[0][];
  /** Deliver an event to the listeners. */
  emit<E extends NativeEventName>(event: E, payload: NativeEvents[E]): void;
  /** Number of live listeners of an event. */
  listenerCount(event: NativeEventName): number;
  capabilitiesValue: Capabilities;
  /** open() resolves this. */
  isolated: boolean;
  /** setFab() resolves this size when visible. */
  fabSize: { width: number; height: number };
  /** post() resolves delivered = this (or the function's answer). */
  deliver: boolean | ((o: { frame: number; generation: number; data: string }) => boolean);
  /** openExternal() resolves opened = this. */
  externalOpens: boolean;
  /** Methods that should reject (with the fixed code "no_browser"). */
  failing: Set<MethodName>;
  /** takeCrashNotice() resolves crashed = this once, then false. */
  crashNotice: boolean;
}

export const FULL_CAPABILITIES: Capabilities = {
  documentStartScript: true,
  messageListener: true,
  isolatedWorld: false,
  webViewPackage: 'com.google.android.webview',
  webViewVersion: '133.0.6943.137',
};

export function createFakeFillBrowser(options: { capabilities?: Partial<Capabilities>; isolated?: boolean } = {}): FakeFillBrowser {
  const listeners = new Map<NativeEventName, Set<(e: unknown) => void>>();
  const calls: FakeCall[] = [];
  const posts: { frame: number; generation: number; data: string }[] = [];

  const fake = {
    calls,
    posts,
    capabilitiesValue: { ...FULL_CAPABILITIES, ...options.capabilities },
    isolated: options.isolated ?? false,
    fabSize: { width: 120, height: 56 },
    deliver: true as FakeFillBrowser['deliver'],
    externalOpens: true,
    failing: new Set<MethodName>(),
    crashNotice: false,
  } as unknown as FakeFillBrowser;

  const record = async <T>(method: MethodName, args: unknown, answer: () => T): Promise<T> => {
    calls.push({ method, args });
    if (fake.failing.has(method)) throw new Error('no_browser');
    return answer();
  };

  Object.assign(fake, {
    callsOf: (method: MethodName) => calls.filter((c) => c.method === method).map((c) => c.args),
    emit: (event: NativeEventName, payload: unknown) => {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(payload);
    },
    listenerCount: (event: NativeEventName) => listeners.get(event)?.size ?? 0,
    capabilities: () => record('capabilities', undefined, () => ({ ...fake.capabilitiesValue })),
    open: (o: unknown) => record('open', o, () => ({ isolated: fake.isolated })),
    close: () => record('close', undefined, () => undefined),
    setVisible: (o: unknown) => record('setVisible', o, () => undefined),
    setInsets: (o: unknown) => record('setInsets', o, () => undefined),
    setTheme: (o: unknown) => record('setTheme', o, () => undefined),
    loadUrl: (o: unknown) => record('loadUrl', o, () => undefined),
    navigate: (o: unknown) => record('navigate', o, () => undefined),
    post: (o: { frame: number; generation: number; data: string }) =>
      record('post', o, () => {
        posts.push(o);
        const delivered = typeof fake.deliver === 'function' ? fake.deliver(o) : fake.deliver;
        return { delivered };
      }),
    setPageCover: (o: unknown) => record('setPageCover', o, () => undefined),
    setFab: (o: FabSpec) =>
      record('setFab', o, () => (o.visible ? { ...fake.fabSize } : { width: 0, height: 0 })),
    answerFileChooser: (o: unknown) => record('answerFileChooser', o, () => undefined),
    openExternal: (o: unknown) => record('openExternal', o, () => ({ opened: fake.externalOpens })),
    clearSiteData: () => record('clearSiteData', undefined, () => undefined),
    takeCrashNotice: () =>
      record('takeCrashNotice', undefined, () => {
        const crashed = fake.crashNotice;
        fake.crashNotice = false;
        return { crashed };
      }),
    addListener: async (event: NativeEventName, cb: (e: unknown) => void) => {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
      return {
        remove: async () => {
          listeners.get(event)?.delete(cb);
        },
      };
    },
  });
  return fake;
}
