// Links, shared text and shortcuts from other apps: one waiting slot, newest wins, run when the app is free
//. First the hook on its own, then the whole App with the native fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useIncomingLinks, type IncomingActions } from '../../../../mobile/app/src/incoming/useIncomingLinks';
import { createFakeIncomingIntent, type FakeIncomingIntent } from '../../../../mobile/app/src/native/incomingIntent';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';
import App, { type Platform } from '../../../../mobile/app/src/App';
import { createFakeFillBrowser, type FakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { mt } from '../../../../mobile/app/src/i18n';
import { createFakeShortcuts } from '../../../../mobile/app/src/native/appShortcuts';
import { createFakeBrowserRole } from '../../../../mobile/app/src/native/browserRole';
import { createFakeClipboard, type FakeClipboard } from '../../../../mobile/app/src/native/clipboardPeek';
import { ApplicationRecordSchema, createMemoryAppStateStore, type AppStateStore, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore } from '../../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../../mobile/app/src/store/wipe';
import { decodeAppCommand } from '../../../../mobile/bridge/protocol';
import type { FieldReport } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const WAIT = { timeout: 3000 };
const ready = (rest: Record<string, unknown>) => ({ state: 'ready', ...rest });

interface Busy {
  ready: boolean;
  importOpen: boolean;
  runActive: boolean;
  onboarding: boolean;
}

function makeActs() {
  return {
    openLink: vi.fn(),
    openDemo: vi.fn(),
    pasteFocus: vi.fn(),
    openApplication: vi.fn(),
    missing: vi.fn(),
    say: vi.fn(),
  } satisfies IncomingActions;
}

function Harness({ source, busy, act: acts, ids }: { source: FakeIncomingIntent; busy: Busy; act: IncomingActions; ids: string[] }) {
  const recordIds = useMemo(() => new Set(ids), [ids]);
  const knownKeys = useMemo(() => new Set(['https://b.example.com/']), []);
  const incoming = useIncomingLinks({ source, ...busy, recordIds, knownKeys, act: acts });
  return <>{incoming.element}</>;
}

function rig(busy: Partial<Busy> = {}, ids: string[] = ['rec-1']) {
  const source = createFakeIncomingIntent();
  const acts = makeActs();
  const backStack = createBackStack();
  let current: Busy = { ready: true, importOpen: false, runActive: false, onboarding: false, ...busy };
  const view = render(
    <BackStackContext.Provider value={backStack}>
      <Harness source={source} busy={current} act={acts} ids={ids} />
    </BackStackContext.Provider>,
  );
  const set = (next: Partial<Busy>) => {
    current = { ...current, ...next };
    view.rerender(
      <BackStackContext.Provider value={backStack}>
        <Harness source={source} busy={current} act={acts} ids={ids} />
      </BackStackContext.Provider>,
    );
  };
  const deliver = async (payload: Record<string, unknown>) => {
    await act(async () => {
      source.deliver(ready(payload));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  };
  return { source, acts, set, deliver, backStack };
}

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('useIncomingLinks', () => {
  it('a VIEW at cold start waits for loading, then opens once', async () => {
    const r = rig({ ready: false });
    await r.deliver({ kind: 'view', url: 'https://jobs.example.com/a' });
    expect(r.acts.openLink).not.toHaveBeenCalled();
    r.set({ ready: true });
    await waitFor(() => expect(r.acts.openLink).toHaveBeenCalledTimes(1), WAIT);
    expect(r.acts.openLink).toHaveBeenCalledWith({ url: 'https://jobs.example.com/a', host: 'jobs.example.com', insecure: false }, 'view');
    r.set({ runActive: true });
    r.set({ runActive: false });
    expect(r.acts.openLink).toHaveBeenCalledTimes(1);
  });

  it('an application id is checked once loaded, not at arrival', async () => {
    const r = rig({ ready: false });
    await r.deliver({ kind: 'application', recordId: 'rec-1', open: 'page' });
    r.set({ ready: true });
    await waitFor(() => expect(r.acts.openApplication).toHaveBeenCalledWith('rec-1', 'page'), WAIT);
    await r.deliver({ kind: 'application', recordId: 'gone', open: 'page' });
    await waitFor(() => expect(r.acts.missing).toHaveBeenCalledTimes(1), WAIT);
  });

  it('during an import it waits with a toast once, then opens; the newest arrival wins', async () => {
    const r = rig({ importOpen: true });
    await r.deliver({ kind: 'view', url: 'https://jobs.example.com/first' });
    expect(r.acts.say).toHaveBeenCalledWith('m.in.waiting', undefined);
    await r.deliver({ kind: 'view', url: 'https://jobs.example.com/second' });
    expect(r.acts.openLink).not.toHaveBeenCalled();
    r.set({ importOpen: false });
    await waitFor(() => expect(r.acts.openLink).toHaveBeenCalledTimes(1), WAIT);
    expect(r.acts.openLink.mock.calls[0]![0]).toMatchObject({ url: 'https://jobs.example.com/second' });
  });

  it('during a fill a page waits with the fill toast; paste runs now', async () => {
    const r = rig({ runActive: true });
    await r.deliver({ kind: 'demo' });
    expect(r.acts.say).toHaveBeenCalledWith('m.in.waitingFill', undefined);
    expect(r.acts.openDemo).not.toHaveBeenCalled();
    await r.deliver({ kind: 'paste' });
    expect(r.acts.pasteFocus).toHaveBeenCalledTimes(1);
    r.set({ runActive: false });
    // The demo was replaced by the paste (one waiting slot), so nothing more runs.
    expect(r.acts.openDemo).not.toHaveBeenCalled();
  });

  it('a refusal is said at once, even during an import', async () => {
    const r = rig({ importOpen: true });
    await r.deliver({ kind: 'refused', reason: 'scheme' });
    expect(r.acts.say).toHaveBeenCalledWith('m.paste.err.unsupported_scheme', undefined);
  });

  it('during onboarding paste and details are dropped with a word; links open', async () => {
    const r = rig({ onboarding: true });
    await r.deliver({ kind: 'paste' });
    expect(r.acts.pasteFocus).not.toHaveBeenCalled();
    expect(r.acts.say).toHaveBeenCalledWith('m.in.finishOnboarding', undefined);
    await r.deliver({ kind: 'view', url: 'https://jobs.example.com/a' });
    expect(r.acts.openLink).toHaveBeenCalledTimes(1);
  });

  it('a share with one titled link opens it and says the title', async () => {
    const r = rig();
    await r.deliver({ kind: 'text', text: '【示例科技校园招聘】网申入口 https://jobs.example.com/campus', cut: false });
    // Said only once the page really opens (a replace-confirm may be waiting): openLink carries the words.
    expect(r.acts.openLink).toHaveBeenCalledWith(expect.objectContaining({ title: '示例科技校园招聘 网申入口' }), 'share', {
      key: 'm.in.openedShared',
      params: { title: '示例科技校园招聘 网申入口' },
    });
    expect(r.acts.say).not.toHaveBeenCalled();
  });

  it('a share without a link says so', async () => {
    const r = rig();
    await r.deliver({ kind: 'text', text: '明天下午面试', cut: false });
    expect(r.acts.say).toHaveBeenCalledWith('m.in.noLink', undefined);
  });

  it('a share with two links shows the choice sheet and opens the chosen one', async () => {
    const r = rig();
    await r.deliver({ kind: 'text', text: '示例科技 https://a.example.com/x 示例银行 https://b.example.com/', cut: false });
    const sheet = await screen.findByRole('dialog', { name: '打开哪个链接？' }, WAIT);
    expect(within(sheet).getByText('分享的文字里有 2 个链接。')).toBeTruthy();
    const rows = within(sheet).getAllByRole('button', { name: /^打开 / });
    expect(rows).toHaveLength(2);
    // A link already in the tracker says so, aloud too; every row carries its full URL as the description.
    expect(within(rows[1]!).getByText('已在网申记录里')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: '打开 b.example.com 示例银行 已在网申记录里' })).toBe(rows[1]);
    expect(within(sheet).getByRole('button', { name: '打开 a.example.com 示例科技', description: /https:\/\/a\.example\.com\/x/ })).toBe(rows[0]);
    fireEvent.click(rows[1]!);
    expect(r.acts.openLink).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://b.example.com/' }), 'share');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
  });

  it('each choice row says its title and the 已在网申记录里 tag aloud, so two links on one host differ', async () => {
    const r = rig();
    await r.deliver({ kind: 'text', text: '【示例科技校园招聘】https://b.example.com/ 实习 https://b.example.com/intern', cut: false });
    const sheet = await screen.findByRole('dialog', { name: '打开哪个链接？' }, WAIT);
    expect(within(sheet).getAllByRole('button', { name: /^打开 b\.example\.com/ })).toHaveLength(2);
    // The tracked one says so; the titled one says its title; the plain one is just 打开 + host.
    const known = within(sheet).getByRole('button', { name: /^打开 b\.example\.com .*已在网申记录里$/ });
    expect(within(known).getByText('已在网申记录里')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: /^打开 b\.example\.com 示例科技校园招聘/ })).toBe(known);
    expect(within(sheet).getByRole('button', { name: '打开 b.example.com 实习' })).not.toBe(known);
  });

  it('the choice sheet counts what it leaves out, and cancels with 取消 or the back key', async () => {
    const r = rig();
    const text = Array.from({ length: 12 }, (_, i) => `https://jobs.example.com/${i}`).join(' ');
    await r.deliver({ kind: 'text', text, cut: false });
    const sheet = await screen.findByRole('dialog', { name: '打开哪个链接？' }, WAIT);
    expect(within(sheet).getAllByRole('button', { name: /^打开 / })).toHaveLength(10);
    expect(within(sheet).getByText('还有 2 个链接没列出来。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    await r.deliver({ kind: 'text', text, cut: false });
    await screen.findByRole('dialog', { name: '打开哪个链接？' }, WAIT);
    act(() => void r.backStack.pop());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(r.acts.openLink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- the whole App with the native fakes

const JOB = 'https://jobs.example.com/campus';
const zhT = (key: string, params?: Record<string, string | number>) => mt('zh', key, params);

const appProfile = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [
      ResumeSchema.parse({
        id: 'r1',
        title: '我的简历',
        locale: 'zh-CN',
        basics: { familyName: '张', givenName: '三' },
        contact: { email: 'zhangsan@example.com' },
      }),
    ],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });

const record = (id: string, url: string, company: string): ApplicationRecord =>
  ApplicationRecordSchema.parse({ id, url, host: new URL(url).hostname, company, companyGuessed: false, statusAt: 1, createdAt: 1, openedAt: 1, updatedAt: 1 });

interface AppRig {
  fake: FakeFillBrowser;
  intent: FakeIncomingIntent;
  clip: FakeClipboard;
  appState: AppStateStore;
  deliver(payload: Record<string, unknown>): Promise<void>;
}

/** Answers the fill protocol like a page with two fields, so a fill can finish. */
function answeringPage(fake: FakeFillBrowser, url: string) {
  fake.deliver = (o) => {
    const cmd = decodeAppCommand(o.data);
    if (!cmd) return true;
    const rows: FieldReport[] = [{ fieldId: 'f1', label: '姓名', fieldKey: null, section: null, outcome: 'filled', confidence: 1 }];
    const reply =
      cmd.kind === 'needs'
        ? { v: 1, kind: 'needs', reqId: cmd.reqId, needs: { fieldKeys: ['basics.fullName'], repeatSections: [], attachmentKeys: [] } }
        : cmd.kind === 'fill'
          ? { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url, startedAt: 1, finishedAt: 2, fields: rows, counts: countOutcomes(rows) } }
          : null;
    if (reply) void Promise.resolve().then(() => act(() => fake.emit('message', { frame: o.frame, generation: 1, origin: new URL(url).origin, main: true, data: JSON.stringify(reply) })));
    return true;
  };
}

function loadPage(fake: FakeFillBrowser, url: string) {
  const origin = new URL(url).origin;
  act(() => {
    fake.emit('navigation', { phase: 'started', url, generation: 1, canGoBack: false, canGoForward: false });
    fake.emit('navigation', { phase: 'finished', url, generation: 1, canGoBack: false, canGoForward: false });
    fake.emit('message', { frame: 1, generation: 1, origin, main: true, data: JSON.stringify({ v: 1, kind: 'hello', iframes: 0 }) });
    fake.emit('message', { frame: 1, generation: 1, origin, main: true, data: JSON.stringify({ v: 1, kind: 'scan', count: 2, iframes: 0 }) });
  });
}

function startApp(opts: { state?: Record<string, unknown>; clipText?: string | null; profile?: Profile | null } = {}): AppRig {
  const fake = createFakeFillBrowser();
  const intent = createFakeIncomingIntent();
  const clip = createFakeClipboard({ text: opts.clipText ?? null, stamp: opts.clipText ? 5 : null });
  const store = createMemoryStore(opts.profile === null ? undefined : (opts.profile ?? appProfile()));
  const files = createMemoryFileStore();
  const appState = createMemoryAppStateStore(opts.state === undefined ? { version: 2, onboardingDone: true } : opts.state);
  const platform: Platform = {
    fillBrowser: fake,
    incomingIntent: intent,
    clipboard: clip,
    shortcuts: createFakeShortcuts(),
    browserRole: createFakeBrowserRole(),
    onBack: () => () => {},
    onPause: () => () => {},
  };
  render(
    <App store={store} files={files} appState={appState} wiper={createStoreWiper({ profile: store, files, appState })} platform={platform} autosaveDelayMs={20} now={() => Date.UTC(2026, 10, 15, 4, 0)} />,
  );
  return {
    fake,
    intent,
    clip,
    appState,
    deliver: async (payload) => {
      await act(async () => {
        intent.deliver({ state: 'ready', ...payload });
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
    },
  };
}

const homeHeading = () => screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
const browserUp = () => screen.findByRole('button', { name: '关闭网申页面' }, WAIT);
const opened = (r: AppRig) => r.fake.callsOf('open').map((o) => o.url);

describe('ways in: the whole App', () => {
  it('a VIEW at cold start opens the browser after loading and records the page', async () => {
    const r = startApp();
    r.intent.deliver({ state: 'ready', kind: 'view', url: JOB });
    await browserUp();
    await waitFor(() => expect(opened(r)).toEqual([JOB]), WAIT);
    await waitFor(async () => expect((await r.appState.load())?.applications.map((a) => a.url)).toEqual([JOB]), WAIT);
    const id = (await r.appState.load())!.applications[0]!.id;
    expect(r.fake.callsOf('open')[0]).toMatchObject({ url: JOB });
    // The record id travels with the page, so its title lands on the record.
    loadPage(r.fake, JOB);
    act(() => r.fake.emit('title', { title: '示例科技2027届校园招聘 - 产品经理', generation: 1 }));
    await waitFor(async () => expect((await r.appState.load())!.applications[0]).toMatchObject({ id, company: '示例科技' }), WAIT);
  });

  it('a VIEW while another page is open without a fill replaces it', async () => {
    const r = startApp();
    await homeHeading();
    await r.deliver({ kind: 'view', url: JOB });
    await browserUp();
    await r.deliver({ kind: 'view', url: 'https://careers.example.com/x' });
    await waitFor(() => expect(opened(r)).toEqual([JOB, 'https://careers.example.com/x']), WAIT);
    expect(screen.queryByRole('dialog', { name: zhT('m.br.closeTitle') })).toBeNull();
  });

  it('after a fill it asks before replacing', async () => {
    const r = startApp();
    await homeHeading();
    answeringPage(r.fake, JOB);
    await r.deliver({ kind: 'view', url: JOB });
    await browserUp();
    loadPage(r.fake, JOB);
    act(() => r.fake.emit('fabTap', {}));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    await r.deliver({ kind: 'view', url: 'https://careers.example.com/x' });
    const ask = await screen.findByRole('dialog', { name: zhT('m.br.closeTitle') }, WAIT);
    expect(opened(r)).toEqual([JOB]);
    fireEvent.click(within(ask).getAllByRole('button', { name: zhT('m.br.closeConfirm') }).find((b) => b.classList.contains('m-button'))!);
    await waitFor(() => expect(opened(r)).toEqual([JOB, 'https://careers.example.com/x']), WAIT);
  });

  it('a shared titled link says 已打开 only once the page really opens, never when the replace is cancelled', async () => {
    const r = startApp();
    await homeHeading();
    answeringPage(r.fake, JOB);
    await r.deliver({ kind: 'view', url: JOB });
    await browserUp();
    loadPage(r.fake, JOB);
    act(() => r.fake.emit('fabTap', {}));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    const shared = { kind: 'text', text: '【示例科技校园招聘】https://careers.example.com/x', cut: false };
    await r.deliver(shared);
    let ask = await screen.findByRole('dialog', { name: zhT('m.br.closeTitle') }, WAIT);
    expect(screen.queryByText(/已打开：/)).toBeNull();
    fireEvent.click(within(ask).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: zhT('m.br.closeTitle') })).toBeNull(), WAIT);
    await act(async () => undefined);
    expect(screen.queryByText(/已打开：/)).toBeNull();
    expect(opened(r)).toEqual([JOB]);
    await r.deliver(shared);
    ask = await screen.findByRole('dialog', { name: zhT('m.br.closeTitle') }, WAIT);
    fireEvent.click(within(ask).getAllByRole('button', { name: zhT('m.br.closeConfirm') }).find((b) => b.classList.contains('m-button'))!);
    await waitFor(() => expect(opened(r)).toEqual([JOB, 'https://careers.example.com/x']), WAIT);
    expect(await screen.findByText('已打开：示例科技校园招聘', undefined, WAIT)).toBeTruthy();
  });

  it('a share with two links shows the choice sheet and opens the chosen one', async () => {
    const r = startApp();
    await homeHeading();
    await r.deliver({ kind: 'text', text: `示例科技 ${JOB}\n示例银行 https://bank.example.com/jobs`, cut: false });
    const sheet = await screen.findByRole('dialog', { name: '打开哪个链接？' }, WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: '打开 bank.example.com 示例银行' }));
    await browserUp();
    await waitFor(() => expect(opened(r)).toEqual(['https://bank.example.com/jobs']), WAIT);
    await waitFor(async () => expect((await r.appState.load())!.applications[0]).toMatchObject({ url: 'https://bank.example.com/jobs', title: '示例银行' }), WAIT);
  });

  it('a share without a link says so', async () => {
    const r = startApp();
    await homeHeading();
    await r.deliver({ kind: 'text', text: '明天下午面试', cut: false });
    expect(await screen.findByText('分享的内容里没有网页链接。', undefined, WAIT)).toBeTruthy();
    expect(opened(r)).toEqual([]);
  });

  it('the paste shortcut focuses the paste box and fills it from the clipboard', async () => {
    const r = startApp({ clipText: `网申入口 ${JOB}` });
    await homeHeading();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '设置' }));
    await screen.findByRole('heading', { level: 1, name: '设置' }, WAIT);
    const readsBefore = r.clip.reads;
    await r.deliver({ kind: 'paste' });
    await homeHeading();
    const box = screen.getByLabelText('网申链接') as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe(JOB), WAIT);
    expect(document.activeElement).toBe(box);
    expect(r.clip.reads).toBe(readsBefore + 1);
    expect(opened(r)).toEqual([]);
  });

  it('the paste shortcut from another tab focuses the paste box even with nothing on the clipboard', async () => {
    const r = startApp();
    await homeHeading();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '设置' }));
    await screen.findByRole('heading', { level: 1, name: '设置' }, WAIT);
    await r.deliver({ kind: 'paste' });
    await homeHeading();
    const box = screen.getByLabelText('网申链接') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(box), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('');
  });

  it('the demo shortcut opens the demo', async () => {
    const r = startApp();
    await homeHeading();
    await r.deliver({ kind: 'demo' });
    await browserUp();
    await waitFor(() => expect(opened(r)).toEqual(['https://appassets.androidplatform.net/demo/form.html']), WAIT);
    expect((await r.appState.load())?.applications ?? []).toEqual([]);
  });

  it('an application shortcut opens that page; a deleted one says so', async () => {
    const r = startApp({ state: { version: 2, onboardingDone: true, applications: [record('rec-1', JOB, '示例科技')] } });
    await homeHeading();
    await r.deliver({ kind: 'application', recordId: 'rec-1', open: 'page' });
    await browserUp();
    await waitFor(() => expect(opened(r)).toEqual([JOB]), WAIT);
    fireEvent.click(screen.getByRole('button', { name: '关闭网申页面' }));
    await homeHeading();
    await r.deliver({ kind: 'application', recordId: 'no-such-id', open: 'page' });
    expect(await screen.findByText('这条网申记录已经删了。', undefined, WAIT)).toBeTruthy();
    expect(opened(r)).toEqual([JOB]);
  });

  it('a reminder tap opens the detail', async () => {
    const r = startApp({ state: { version: 2, onboardingDone: true, applications: [record('rec-1', JOB, '示例科技')] } });
    await homeHeading();
    await r.deliver({ kind: 'application', recordId: 'rec-1', open: 'detail' });
    expect(await screen.findByRole('heading', { level: 1, name: '示例科技' }, WAIT)).toBeTruthy();
    const bar = screen.getByRole('navigation', { name: '主导航' });
    expect(within(bar).getByRole('button', { name: '网申' }).getAttribute('aria-current')).toBe('page');
  });

  it('during onboarding a link opens and returns to onboarding', async () => {
    const r = startApp({ state: { version: 2, onboardingDone: false }, profile: null });
    await screen.findByRole('heading', { level: 1, name: /^(你好，先说三件事|Hi! Three things first)$/ }, WAIT);
    await r.deliver({ kind: 'view', url: JOB });
    const close = await screen.findByRole('button', { name: /^(关闭网申页面|Close application page)$/ }, WAIT);
    fireEvent.click(close);
    await screen.findByRole('heading', { level: 1, name: /^(你好，先说三件事|Hi! Three things first)$/ }, WAIT);
    expect((await r.appState.load())?.onboardingDone).toBe(false);
    // The paste shortcut has no box to fill during onboarding.
    await r.deliver({ kind: 'paste' });
    expect(await screen.findByText(/^(先完成开始的设置，再用这个功能。|Finish getting started first.)$/, undefined, WAIT)).toBeTruthy();
  });

  it('a copied link on Home opens through the card and is recorded; the card never shows in the browser', async () => {
    const r = startApp({ clipText: `示例科技 ${JOB}` });
    await homeHeading();
    const card = await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    fireEvent.click(within(card).getByRole('button', { name: '打开' }));
    await browserUp();
    await waitFor(() => expect(opened(r)).toEqual([JOB]), WAIT);
    await waitFor(async () => expect((await r.appState.load())!.applications.map((a) => a.url)).toEqual([JOB]), WAIT);
    // A new clip while the page shows: no look at all until the page is gone.
    const hints = r.clip.hints;
    r.clip.set({ text: 'https://bank.example.com/', stamp: 6 });
    await act(async () => {
      r.clip.focus();
      await Promise.resolve();
    });
    expect(r.clip.hints).toBe(hints);
    expect(screen.queryByRole('region', { name: '打开刚复制的链接？' })).toBeNull();
  });
});
