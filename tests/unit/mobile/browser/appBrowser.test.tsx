// The fill browser inside the whole App: a file shared to the app while a page shows, the
// return pill's place in the layout, the record's save failure said where it can be seen, and the note after the
// app restarted because the page's renderer died. Fills land on the page's application record, closing
// after a fill asks 提交了吗？, reminders are synced, and Home shows the applications sections, not recent pages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../../mobile/app/src/App';
import { createFakeFillBrowser, type FakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { mt } from '../../../../mobile/app/src/i18n';
import type { IncomingEvent, IncomingFileSource } from '../../../../mobile/app/src/resumeImport/incoming';
import { createFakeReminders, type FakeReminders } from '../../../../mobile/app/src/native/reminders';
import { createFakeShortcuts, type FakeShortcuts } from '../../../../mobile/app/src/native/appShortcuts';
import { createFakeIncomingIntent, type FakeIncomingIntent } from '../../../../mobile/app/src/native/incomingIntent';
import { createMemoryAppStateStore, type AppStateStore } from '../../../../mobile/app/src/store/appStateStore';
import { decodeAppCommand } from '../../../../mobile/bridge/protocol';
import type { FieldReport } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { createMemoryFileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore } from '../../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../../mobile/app/src/store/wipe';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const WAIT = { timeout: 4000 };
const URL_A = 'https://jobs.example.com/apply';
const zh = (key: string, params?: Record<string, string | number>) => mt('zh', key, params);

const profile = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: '我的简历', locale: 'zh-CN', basics: { familyName: '张' } })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });

function fakeIncoming() {
  let handler: ((event: IncomingEvent) => void) | null = null;
  const source: IncomingFileSource = {
    subscribe(h) {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return { source, emit: (event: IncomingEvent) => act(() => handler!(event)), subscribed: () => handler !== null };
}

let back: (() => boolean) | null = null;
function start(
  fake: FakeFillBrowser,
  opts: { appState?: AppStateStore; incoming?: IncomingFileSource; reminders?: FakeReminders; shortcuts?: FakeShortcuts; intent?: FakeIncomingIntent } = {},
) {
  const store = createMemoryStore(profile());
  const files = createMemoryFileStore();
  const appState = opts.appState ?? createMemoryAppStateStore({ version: 1, onboardingDone: true });
  const platform: Platform = {
    fillBrowser: fake,
    ...(opts.incoming ? { incoming: opts.incoming } : {}),
    ...(opts.reminders ? { reminders: opts.reminders } : {}),
    ...(opts.shortcuts ? { shortcuts: opts.shortcuts } : {}),
    ...(opts.intent ? { incomingIntent: opts.intent } : {}),
    onBack(handler) {
      back = handler;
      return () => {
        back = null;
      };
    },
    onPause: () => () => {},
  };
  render(
    <App store={store} files={files} appState={appState} wiper={createStoreWiper({ profile: store, files, appState })} platform={platform} autosaveDelayMs={20} now={() => Date.UTC(2026, 10, 15, 4, 0)} />,
  );
}

async function openPasted(fake: FakeFillBrowser) {
  await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
  fireEvent.change(screen.getByLabelText('网申链接'), { target: { value: URL_A } });
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  await screen.findByRole('button', { name: '关闭网申页面' }, WAIT);
  await waitFor(() => expect(fake.callsOf('open')).toHaveLength(1), WAIT);
}

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  back = null;
  setLanguage('en');
});

describe('App + fill browser – edge cases', () => {
  it('a file shared to the app while a page shows: the page steps aside, back leaves the import, the pill brings the page back', async () => {
    const fake = createFakeFillBrowser();
    const incoming = fakeIncoming();
    start(fake, { incoming: incoming.source });
    await openPasted(fake);
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'reading', name: '张三简历.pdf' });
    expect(await screen.findByRole('dialog', { name: '正在读取简历' }, WAIT)).toBeTruthy();
    // The native page no longer covers the review, and the browser screen is gone.
    await waitFor(() => expect(fake.callsOf('setVisible').at(-1)).toEqual({ visible: false }), WAIT);
    expect(screen.queryByRole('button', { name: '关闭网申页面' })).toBeNull();
    // Back goes to the import, never to the page.
    act(() => void expect(back!()).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '正在读取简历' })).toBeNull(), WAIT);
    expect(fake.callsOf('navigate')).toEqual([]);
    expect(fake.callsOf('close')).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: '回到网申页面：jobs.example.com' }, WAIT));
    await screen.findByRole('button', { name: '关闭网申页面' }, WAIT);
    await waitFor(() => expect(fake.callsOf('setVisible').at(-1)).toEqual({ visible: true }), WAIT);
  });

  it('the return pill sits in the bottom bar with the tabs (taking room, never over content), and the keyboard hides it', async () => {
    // A shared file the app cannot read hides the page; after closing the explanation the pill waits on the tabs.
    const fake = createFakeFillBrowser();
    const incoming = fakeIncoming();
    start(fake, { incoming: incoming.source });
    await openPasted(fake);
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'error', reason: 'wrong_type' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: zh('m.ri.fail.title.wrong_type') }, WAIT)).getByRole('button', { name: '关闭' }));
    const incomingPill = await screen.findByRole('button', { name: '回到网申页面：jobs.example.com' }, WAIT);
    const bottom = incomingPill.closest('.m-shell__bottom');
    expect(bottom).not.toBeNull();
    expect(within(bottom as HTMLElement).getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(incomingPill.closest('.m-br-return')).not.toBeNull();
    const css = readFileSync(join(process.cwd(), 'mobile/app/src/browser/browser.css'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'mobile/app/src/styles.css'), 'utf8');
    // In the flow, not fixed over the content; gone with the keyboard like the tab bar.
    expect(css).not.toMatch(/\.m-br-return\s*\{[^}]*position:\s*fixed/);
    expect(css + app).toMatch(/\.m-shell--keyboard \.m-br-return\s*\{[^}]*display:\s*none/);
    expect(app).toMatch(/\.m-shell__bottom\s*\{[^}]*position:\s*sticky/);
    // Toasts sit above the whole bottom bar, whatever its measured height.
    expect(app).toMatch(/\.m-shell \.m-toast-region\s*\{[^}]*var\(--m-bottom-h/);
  });

  it('when the record cannot be saved, 没能保存 shows in the browser where it can be seen', async () => {
    const fake = createFakeFillBrowser();
    const inner = createMemoryAppStateStore({ version: 1, onboardingDone: true });
    const appState: AppStateStore = { load: () => inner.load(), clear: () => inner.clear(), save: () => Promise.reject(new Error('busy')) };
    start(fake, { appState });
    await openPasted(fake);
    const slot = document.querySelector('.m-br-toasts') as HTMLElement;
    expect(await within(slot).findByText(zh('m.saveStateFailed'), undefined, WAIT)).toBeTruthy();
  });

  it('after the app restarted because the page crashed, Home says what happened', async () => {
    const fake = createFakeFillBrowser();
    fake.crashNotice = true;
    start(fake);
    expect(await screen.findByText(zh('m.br.crash.restarted'), undefined, WAIT)).toBeTruthy();
    expect(fake.callsOf('takeCrashNotice')).toHaveLength(1);
    cleanup();
    start(fake);
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.queryByText(zh('m.br.crash.restarted'))).toBeNull();
  });
});

describe('App + fill browser – the tracker', () => {
  /** A page that answers the fill: one field filled, one to check. */
  function answering(fake: FakeFillBrowser) {
    fake.deliver = (o) => {
      const cmd = decodeAppCommand(o.data);
      if (!cmd) return true;
      const rows: FieldReport[] = [
        { fieldId: 'f1', label: '姓名', fieldKey: null, section: null, outcome: 'filled', confidence: 1 },
        { fieldId: 'f2', label: '性别', fieldKey: null, section: null, outcome: 'needs_review', confidence: 1 },
      ];
      const reply =
        cmd.kind === 'needs'
          ? { v: 1, kind: 'needs', reqId: cmd.reqId, needs: { fieldKeys: ['basics.fullName'], repeatSections: [], attachmentKeys: [] } }
          : cmd.kind === 'fill'
            ? { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url: URL_A, startedAt: 1, finishedAt: 2, fields: rows, counts: countOutcomes(rows) } }
            : null;
      if (reply) void Promise.resolve().then(() => act(() => fake.emit('message', { frame: o.frame, generation: 1, origin: 'https://jobs.example.com', main: true, data: JSON.stringify(reply) })));
      return true;
    };
  }
  function loadAndFill(fake: FakeFillBrowser) {
    act(() => {
      fake.emit('navigation', { phase: 'started', url: URL_A, generation: 1, canGoBack: false, canGoForward: false });
      fake.emit('navigation', { phase: 'finished', url: URL_A, generation: 1, canGoBack: false, canGoForward: false });
      fake.emit('message', { frame: 1, generation: 1, origin: 'https://jobs.example.com', main: true, data: JSON.stringify({ v: 1, kind: 'hello', iframes: 0 }) });
      fake.emit('message', { frame: 1, generation: 1, origin: 'https://jobs.example.com', main: true, data: JSON.stringify({ v: 1, kind: 'scan', count: 2, iframes: 0 }) });
      fake.emit('fabTap', {});
    });
  }

  it('a fill lands on the record (counts only) and closing the page asks 提交了吗？; 已提交 marks it', async () => {
    const fake = createFakeFillBrowser();
    answering(fake);
    const appState = createMemoryAppStateStore({ version: 2, onboardingDone: true });
    start(fake, { appState });
    await openPasted(fake);
    loadAndFill(fake);
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    await waitFor(async () => expect((await appState.load())!.applications[0]!.history).toHaveLength(1), WAIT);
    const saved = (await appState.load())!.applications[0]!;
    expect(saved).toMatchObject({ status: 'filling', history: [{ filled: 1, attention: 1, resumeId: 'r1' }] });
    expect(JSON.stringify(saved)).not.toContain('张');
    fireEvent.click(screen.getByRole('button', { name: '关闭网申页面' }));
    const confirm = screen.queryByRole('dialog', { name: zh('m.br.closeTitle') });
    if (confirm) fireEvent.click(within(confirm).getAllByRole('button', { name: zh('m.br.closeConfirm') }).find((b) => b.classList.contains('m-button'))!);
    const ask = await screen.findByRole('dialog', { name: '提交了吗？' }, WAIT);
    fireEvent.click(within(ask).getByRole('button', { name: '已提交' }));
    await waitFor(async () => expect((await appState.load())!.applications[0]!.status).toBe('submitted'), WAIT);
  });

  it('reminders are synced from the app state on the phone', async () => {
    const fake = createFakeFillBrowser();
    const reminders = createFakeReminders({ permission: 'granted', enabled: true });
    const appState = createMemoryAppStateStore({
      version: 2,
      onboardingDone: true,
      applications: [
        {
          id: 'rec-1',
          url: URL_A,
          host: 'jobs.example.com',
          company: '示例科技',
          companyGuessed: false,
          statusAt: 1,
          createdAt: 1,
          openedAt: 1,
          updatedAt: 1,
          deadline: { date: '2026-11-30' },
          remind: true,
        },
      ],
    });
    start(fake, { appState, reminders });
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    await waitFor(() => expect(reminders.synced.length).toBeGreaterThan(0), { timeout: 6000 });
    expect(reminders.synced.at(-1)!.entries.map((e) => e.recordId)).toContain('rec-1');
  });

  it('Home shows the applications sections and no recent pages', async () => {
    const fake = createFakeFillBrowser();
    start(fake);
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    expect(screen.getByText('打开过的网申页面会记在「网申」里。')).toBeTruthy();
    expect(screen.queryByText('最近的网申页面')).toBeNull();
    await openPasted(fake);
    fireEvent.click(screen.getByRole('button', { name: '关闭网申页面' }));
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    expect(await screen.findByRole('button', { name: /^全部网申记录（1）/ }, WAIT)).toBeTruthy();
  });
});

describe('App – edge cases', () => {
  const record = (id: string, company: string, o: Record<string, unknown> = {}) => ({
    id,
    url: `https://jobs.example.com/${id}`,
    host: 'jobs.example.com',
    company,
    companyGuessed: false,
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    ...o,
  });
  const tab = (name: string) => within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name });

  it('state from a newer version never syncs reminders or shortcuts (the defaults in memory would wipe them)', async () => {
    const fake = createFakeFillBrowser();
    const reminders = createFakeReminders({ permission: 'granted', enabled: true });
    const shortcuts = createFakeShortcuts();
    const appState = createMemoryAppStateStore({ version: 99, onboardingDone: true });
    start(fake, { appState, reminders, shortcuts });
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(reminders.calls.filter((c) => c.method === 'sync' || c.method === 'clear')).toEqual([]);
    expect(shortcuts.calls.filter((c) => c.method === 'sync' || c.method === 'clearAll')).toEqual([]);
  });

  it('a page opened from a Home row closes back to Home, not to an old detail in 网申', async () => {
    const fake = createFakeFillBrowser();
    const appState = createMemoryAppStateStore({
      version: 2,
      onboardingDone: true,
      applications: [record('rec-a', '示例科技', { openedAt: 2 }), record('rec-b', '示例银行', { status: 'filling', openedAt: 1 })],
    });
    start(fake, { appState });
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    fireEvent.click(tab('网申'));
    fireEvent.click(await screen.findByRole('button', { name: /^示例科技/ }, WAIT));
    await screen.findByRole('heading', { level: 1, name: '示例科技' }, WAIT);
    fireEvent.click(tab('首页'));
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    fireEvent.click(await screen.findByRole('button', { name: '打开示例银行的网申页面' }, WAIT));
    await screen.findByRole('button', { name: '关闭网申页面' }, WAIT);
    fireEvent.click(screen.getByRole('button', { name: '关闭网申页面' }));
    expect(await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: '示例科技' })).toBeNull();
  });

  it('a page opened from a reminder notification closes back to 网申', async () => {
    const fake = createFakeFillBrowser();
    const intent = createFakeIncomingIntent();
    const appState = createMemoryAppStateStore({ version: 2, onboardingDone: true, applications: [record('rec-a', '示例科技')] });
    start(fake, { appState, intent });
    await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
    await act(async () => {
      intent.deliver({ state: 'ready', kind: 'application', recordId: 'rec-a', open: 'page', from: 'reminder' });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    await screen.findByRole('button', { name: '关闭网申页面' }, WAIT);
    fireEvent.click(screen.getByRole('button', { name: '关闭网申页面' }));
    expect(await screen.findByRole('heading', { level: 1, name: '网申记录' }, WAIT)).toBeTruthy();
  });
});
