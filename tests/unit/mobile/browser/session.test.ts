import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileSchema, ResumeSchema } from '../../../../src/schema';
import { encode } from '../../../../mobile/bridge/protocol';
import { createFakeFillBrowser, type FabSpec, type FakeFillBrowser, type NativeEvents } from '../../../../mobile/app/src/browser/native';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';
import {
  createBrowserSession,
  initialSessionState,
  reduceNativeEvent,
  type BrowserSession,
  type BrowserSessionDeps,
  type BrowserTarget,
} from '../../../../mobile/app/src/browser/model/session';

const URL_ = 'https://jobs.example.com/apply';
const theme = { bg: 1, surface: 2, text: 3, line: 4, accent: 5, scrim: 6 };
const insets = { top: 56, bottom: 56 };
const resume = ResumeSchema.parse({ id: 'r1', title: '', locale: 'zh-CN', basics: { familyName: '张' } });
const nav = (phase: 'started' | 'finished' | 'history', url = URL_, generation = 1): NativeEvents['navigation'] => ({
  phase,
  url,
  generation,
  canGoBack: false,
  canGoForward: false,
});

interface Made {
  native: FakeFillBrowser;
  session: BrowserSession;
  onTitle: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
}

async function make(target: BrowserTarget = { url: URL_, demo: false, recentId: 'rec1' }, over: Partial<BrowserSessionDeps> = {}, caps = {}): Promise<Made> {
  const native = createFakeFillBrowser({ capabilities: caps });
  const onTitle = vi.fn();
  const readFile = vi.fn(async () => null);
  let n = 0;
  const session = createBrowserSession({
    target,
    native,
    getFillContext: () => ({ profile: ProfileSchema.parse({ schemaVersion: 1, resumes: [resume], activeResumeId: 'r1' }), fillLanguage: 'active' }),
    readFile,
    onTitle,
    newId: () => `id${++n}`,
    translate: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key),
    ...over,
  });
  await session.start(insets, theme);
  return { native, session, onTitle, readFile };
}

const mainHello = (m: Made, generation = 1) => {
  m.native.emit('message', { frame: 0, generation, origin: 'https://jobs.example.com', main: true, data: encode({ v: 1, kind: 'hello', iframes: 0 }) });
  m.native.emit('message', { frame: 0, generation, origin: 'https://jobs.example.com', main: true, data: encode({ v: 1, kind: 'scan', count: 4, iframes: 0 }) });
};
const lastFab = (m: Made) => m.native.callsOf('setFab').at(-1) as FabSpec | undefined;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('reduceNativeEvent', () => {
  const s0 = initialSessionState({ url: URL_, demo: false });

  it('navigation started bumps the generation, clears frames and sets loading', () => {
    let s = reduceNativeEvent(s0, { type: 'navigation', payload: nav('started') });
    s = reduceNativeEvent(s, { type: 'message', payload: { frame: 0, generation: 1, origin: 'https://jobs.example.com', main: true, data: encode({ v: 1, kind: 'hello', iframes: 0 }) } });
    expect(s.frames).toHaveLength(1);
    expect(s.engine).toBe('ready');
    s = reduceNativeEvent(s, { type: 'navigation', payload: nav('started', 'https://jobs.example.com/b', 2) });
    expect(s).toMatchObject({ generation: 2, frames: [], loading: true, url: 'https://jobs.example.com/b', engine: 'waiting', error: null });
  });

  it('accounts.google.com as the top host sets the notice', () => {
    const s = reduceNativeEvent(s0, { type: 'navigation', payload: nav('started', 'https://accounts.google.com/signin', 1) });
    expect(s.notice).toBe('google_login');
    expect(reduceNativeEvent(s, { type: 'navigation', payload: nav('started', URL_, 2) }).notice).toBeNull();
  });

  it('keyboard, pageArea, progress and loadError', () => {
    expect(reduceNativeEvent(s0, { type: 'keyboard', payload: { visible: true, height: 300 } }).keyboard).toBe(true);
    expect(reduceNativeEvent(s0, { type: 'pageArea', payload: { width: 360, height: 600 } }).area).toEqual({ width: 360, height: 600 });
    expect(reduceNativeEvent(s0, { type: 'progress', payload: { value: 40 } }).progress).toBe(40);
    expect(reduceNativeEvent(s0, { type: 'loadError', payload: { kind: 'dns', url: URL_, code: -2 } }).error).toEqual({ kind: 'dns', host: 'jobs.example.com' });
  });

  it('external decisions become pending; ignored ones change nothing', () => {
    const s = reduceNativeEvent(s0, { type: 'external', payload: { url: 'tel:10086', gesture: true, main: true } });
    expect(s.pending).toEqual({ kind: 'external', decision: { action: 'ask', kind: 'call', target: '10086', url: 'tel:10086' } });
    expect(reduceNativeEvent(s0, { type: 'external', payload: { url: 'weixin://x', gesture: false, main: true } })).toBe(s0);
  });

  it('download and file chooser become pending', () => {
    expect(reduceNativeEvent(s0, { type: 'download', payload: { url: 'blob:https://a/b', mimeType: 'x', fileName: 'a.pdf', size: -1 } }).pending).toEqual({
      kind: 'download',
      fileName: 'a.pdf',
      size: -1,
      url: 'blob:https://a/b',
      copyable: false,
    });
    expect(reduceNativeEvent(s0, { type: 'fileChooser', payload: { id: 3, accept: ['.pdf'], multiple: false, capture: false } }).pending).toEqual({
      kind: 'fileChooser',
      id: 3,
      accept: ['.pdf'],
      multiple: false,
    });
  });
});

describe('browser session', () => {
  it('start opens the page with insets and theme and reads capabilities', async () => {
    const m = await make();
    expect(m.native.callsOf('open')).toEqual([{ url: URL_, insets, theme }]);
    expect(m.session.getState().capabilities?.documentStartScript).toBe(true);
    expect(m.session.getState().isolated).toBe(false);
  });

  it('no main hello 8 s after finished → engine missing', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('navigation', nav('finished'));
    await vi.advanceTimersByTimeAsync(7_999);
    expect(m.session.getState().engine).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2);
    expect(m.session.getState().engine).toBe('missing');
  });

  it('a main hello in time keeps the engine ready', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('navigation', nav('finished'));
    mainHello(m);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(m.session.getState().engine).toBe('ready');
  });

  it('capabilities without document-start → unsupported, and fill() → unavailable', async () => {
    const m = await make(undefined, {}, { documentStartScript: false });
    expect(m.session.getState().engine).toBe('unsupported');
    expect(await m.session.fill()).toBe('unavailable');
    m.native.emit('navigation', nav('started'));
    expect(m.session.getState().engine).toBe('unsupported');
  });

  it('title with a recentId calls onTitle; on the demo it does not', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('title', { title: '示例公司 网申', generation: 1 });
    expect(m.session.getState().title).toBe('示例公司 网申');
    expect(m.onTitle).toHaveBeenCalledWith('rec1', '示例公司 网申', 'jobs.example.com');
    const d = await make({ url: DEMO_URL, demo: true, recentId: 'x' });
    d.native.emit('navigation', nav('started', DEMO_URL));
    d.native.emit('title', { title: '示例', generation: 1 });
    expect(d.onTitle).not.toHaveBeenCalled();
  });

  it('loadError ssl → error and setVisible(false); retry() loads the last URL again', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('loadError', { kind: 'ssl', url: URL_, code: -11 });
    expect(m.session.getState().error).toEqual({ kind: 'ssl', host: 'jobs.example.com' });
    await flush();
    expect(m.native.callsOf('setVisible').at(-1)).toEqual({ visible: false });
    m.session.retry();
    await flush();
    expect(m.native.callsOf('loadUrl').at(-1)).toEqual({ url: URL_ });
    expect(m.session.getState().error).toBeNull();
  });

  it('crashed shows the crashed error', async () => {
    const m = await make();
    m.native.emit('crashed', {});
    expect(m.session.getState().error?.kind).toBe('crashed');
  });

  it('a modal sheet sets the scrim and hides the FAB', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('pageArea', { width: 360, height: 600 });
    mainHello(m);
    await flush();
    expect(lastFab(m)?.visible).toBe(true);
    m.session.setSheet({ open: true, modal: true });
    await flush();
    expect(m.native.callsOf('setPageCover').at(-1)).toEqual({ block: true, scrim: true });
    expect(lastFab(m)).toEqual({ visible: false });
    m.session.setSheet({ open: false, modal: false });
    await flush();
    expect(m.native.callsOf('setPageCover').at(-1)).toEqual({ block: false, scrim: false });
    expect(lastFab(m)?.visible).toBe(true);
  });

  it('the FAB carries translated text, a11y and a placement', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('pageArea', { width: 360, height: 600 });
    mainHello(m);
    await flush();
    const fab = lastFab(m);
    expect(fab).toMatchObject({ visible: true, icon: 'magic', text: 'fab.autofill', subtext: 'm.br.fab.count{"n":4}', a11y: 'm.br.fab.a11y{"n":4}', switchSideLabel: 'm.br.fab.switchSide', theme });
    if (fab?.visible) expect(fab.x).toBe(360 - 120 - 16);
  });

  it('keyboard visible hides the FAB', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.native.emit('pageArea', { width: 360, height: 600 });
    mainHello(m);
    await flush();
    m.native.emit('keyboard', { visible: true, height: 300 });
    await flush();
    expect(lastFab(m)).toEqual({ visible: false });
  });

  it('accounts.google.com top navigation sets the notice; dismissNotice clears it', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started', 'https://accounts.google.com/x'));
    expect(m.session.getState().notice).toBe('google_login');
    m.session.dismissNotice();
    expect(m.session.getState().notice).toBeNull();
  });

  it('answerFile stored: reads the file and answers with base64; over 10 MB → too_big without cancel', async () => {
    const small = { info: { id: 'f1', name: 'cv.pdf', type: 'application/pdf', size: 3, createdAt: 0 }, bytes: new Uint8Array([1, 2, 3]) };
    const big = { info: { id: 'f2', name: 'big.pdf', type: 'application/pdf', size: 11 * 1024 * 1024, createdAt: 0 }, bytes: new Uint8Array(11 * 1024 * 1024) };
    const readFile = vi.fn(async (id: string) => (id === 'f1' ? small : id === 'f2' ? big : null));
    const m = await make(undefined, { readFile });
    m.native.emit('fileChooser', { id: 7, accept: ['.pdf'], multiple: false, capture: false });
    expect(await m.session.answerFile({ kind: 'stored', fileId: 'f2' })).toBe('too_big');
    expect(m.native.callsOf('answerFileChooser')).toEqual([]);
    expect(m.session.getState().pending?.kind).toBe('fileChooser');
    expect(await m.session.answerFile({ kind: 'stored', fileId: 'nope' })).toBe('failed');
    expect(await m.session.answerFile({ kind: 'stored', fileId: 'f1' })).toBe('ok');
    expect(m.native.callsOf('answerFileChooser')).toEqual([{ id: 7, kind: 'files', files: [{ name: 'cv.pdf', mimeType: 'application/pdf', data: 'AQID' }] }]);
    expect(m.session.getState().pending).toBeNull();
  });

  it('dismissPending on a file chooser answers cancel', async () => {
    const m = await make();
    m.native.emit('fileChooser', { id: 9, accept: [], multiple: false, capture: false });
    m.session.dismissPending();
    await flush();
    expect(m.native.callsOf('answerFileChooser')).toEqual([{ id: 9, kind: 'cancel' }]);
    expect(m.session.getState().pending).toBeNull();
  });

  it('answerExternal(true) on a tel: decision calls openExternal; false calls nothing', async () => {
    const m = await make();
    m.native.emit('external', { url: 'tel:10086', gesture: true, main: true });
    await m.session.answerExternal(false);
    expect(m.native.callsOf('openExternal')).toEqual([]);
    m.native.emit('external', { url: 'tel:10086', gesture: true, main: true });
    await m.session.answerExternal(true);
    expect(m.native.callsOf('openExternal')).toEqual([{ url: 'tel:10086' }]);
    expect(m.session.getState().pending).toBeNull();
  });

  it('a frame inside the page cannot launch an app or replace the page; it can still offer a call', async () => {
    const m = await make();
    m.native.emit('external', { url: 'intent://x#Intent;scheme=weixin;S.browser_fallback_url=https%3A%2F%2Fm.example.com%2F;end', gesture: true, main: false });
    expect(m.session.getState().pending).toBeNull();
    m.native.emit('external', { url: 'weixin://dl/business/?t=x', gesture: true, main: false });
    expect(m.session.getState().pending).toBeNull();
    await m.session.answerExternal(true);
    expect(m.native.callsOf('openExternal')).toEqual([]);
    expect(m.native.callsOf('loadUrl')).toEqual([]);
    m.native.emit('external', { url: 'tel:10086', gesture: true, main: false });
    expect(m.session.getState().pending).toMatchObject({ kind: 'external', decision: { action: 'ask', kind: 'call' } });
  });

  it('a fallback decision loads the web version here', async () => {
    const m = await make();
    m.native.emit('external', { url: 'intent://x#Intent;scheme=weixin;S.browser_fallback_url=https%3A%2F%2Fm.example.com%2F;end', gesture: true, main: true });
    await m.session.answerExternal(true);
    expect(m.native.callsOf('loadUrl').at(-1)).toEqual({ url: 'https://m.example.com/' });
  });

  it('a blocked external link with a gesture toasts', async () => {
    const m = await make();
    m.native.emit('external', { url: 'javascript:alert(1)', gesture: true, main: true });
    expect(m.session.getState().toast).toMatchObject({ key: 'm.br.ext.blocked' });
    expect(m.session.getState().pending).toBeNull();
  });

  it('back() goes back when it can, else returns false', async () => {
    const m = await make();
    expect(await m.session.back()).toBe(false);
    m.native.emit('navigation', { ...nav('history'), canGoBack: true });
    expect(await m.session.back()).toBe(true);
    expect(m.native.callsOf('navigate')).toEqual([{ action: 'back' }]);
  });

  it('reloadOrStop stops while loading and reloads otherwise', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    m.session.reloadOrStop();
    m.native.emit('navigation', nav('finished'));
    m.session.reloadOrStop();
    await flush();
    expect(m.native.callsOf('navigate')).toEqual([{ action: 'stop' }, { action: 'reload' }]);
  });

  it('setHidden toggles the native page view', async () => {
    const m = await make();
    m.session.setHidden(true);
    await flush();
    expect(m.native.callsOf('setVisible').at(-1)).toEqual({ visible: false });
    m.session.setHidden(false);
    await flush();
    expect(m.native.callsOf('setVisible').at(-1)).toEqual({ visible: true });
  });

  it('subscribers hear changes; dispose closes native and removes listeners', async () => {
    const m = await make();
    const listener = vi.fn();
    const off = m.session.subscribe(listener);
    m.native.emit('progress', { value: 50 });
    expect(listener).toHaveBeenCalled();
    off();
    await m.session.dispose();
    expect(m.native.callsOf('close')).toHaveLength(1);
    expect(m.native.listenerCount('message')).toBe(0);
  });

  it('a FAB tap on ready starts a fill and tells the UI', async () => {
    const m = await make();
    const taps = vi.fn();
    m.session.onFabTap(taps);
    m.native.emit('navigation', nav('started'));
    m.native.emit('pageArea', { width: 360, height: 600 });
    mainHello(m);
    await flush();
    m.native.emit('fabTap', {});
    await flush();
    expect(taps).toHaveBeenCalledWith({ kind: 'fill', result: 'started' });
  });

  it('moveFab and switchFabSide set the anchor', async () => {
    const m = await make();
    m.native.emit('pageArea', { width: 360, height: 600 });
    m.session.moveFab({ x: 10, y: 300 });
    expect(m.session.getState().fabAnchor).toEqual({ side: 'start', fromBottom: 600 - 356 });
    m.session.switchFabSide();
    expect(m.session.getState().fabAnchor).toEqual({ side: 'end', fromBottom: 600 - 356 });
  });

  it('focus(rowKey) posts focus to that frame and answers ok / gone', async () => {
    const m = await make();
    m.native.emit('navigation', nav('started'));
    mainHello(m);
    m.native.deliver = (o) => {
      const cmd = JSON.parse(o.data) as { kind: string; reqId: string; fieldId: string };
      if (cmd.kind === 'focus') {
        void Promise.resolve().then(() =>
          m.native.emit('message', { frame: 0, generation: 1, origin: 'https://jobs.example.com', main: true, data: encode({ v: 1, kind: 'focused', reqId: cmd.reqId, ok: cmd.fieldId === 'c1' }) }),
        );
      }
      return true;
    };
    expect(await m.session.focus('0:c1')).toBe('ok');
    expect(await m.session.focus('0:c2')).toBe('gone');
    expect(await m.session.focus('7:c1')).toBe('gone');
  });
});

describe('browser session – edge cases', () => {
  const build = () => {
    const native = createFakeFillBrowser();
    const session = createBrowserSession({
      target: { url: URL_, demo: false },
      native,
      getFillContext: () => ({ profile: null, fillLanguage: 'active' }),
      readFile: async () => null,
      onTitle: () => undefined,
    });
    return { native, session };
  };

  it('disposed while starting: the page is never opened', async () => {
    const { native, session } = build();
    const starting = session.start(insets, theme);
    await session.dispose();
    await starting;
    await flush();
    expect(native.callsOf('open')).toEqual([]);
  });

  it('disposed while the open call is on its way: the page it made is closed again', async () => {
    const { native, session } = build();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realOpen = native.open.bind(native);
    native.open = async (o) => {
      await gate;
      return realOpen(o);
    };
    const starting = session.start(insets, theme);
    await flush();
    await session.dispose();
    const closesAtDispose = native.callsOf('close').length;
    release();
    await starting;
    await flush();
    expect(native.callsOf('close').length).toBeGreaterThan(closesAtDispose);
  });
});
