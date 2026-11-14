// The fill browser inside the whole App: a file shared to the app while a page shows, the
// return pill's place in the layout, the recent-page save failure said where it can be seen, and the note after the
// app restarted because the page's renderer died.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../../mobile/app/src/App';
import { createFakeFillBrowser, type FakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { mt } from '../../../../mobile/app/src/i18n';
import type { IncomingEvent, IncomingFileSource } from '../../../../mobile/app/src/resumeImport/incoming';
import { createMemoryAppStateStore, type AppStateStore } from '../../../../mobile/app/src/store/appStateStore';
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
function start(fake: FakeFillBrowser, opts: { appState?: AppStateStore; incoming?: IncomingFileSource } = {}) {
  const store = createMemoryStore(profile());
  const files = createMemoryFileStore();
  const appState = opts.appState ?? createMemoryAppStateStore({ version: 1, onboardingDone: true });
  const platform: Platform = {
    fillBrowser: fake,
    ...(opts.incoming ? { incoming: opts.incoming } : {}),
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

  it('when the recent page cannot be saved, 没能保存 shows in the browser where it can be seen', async () => {
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
