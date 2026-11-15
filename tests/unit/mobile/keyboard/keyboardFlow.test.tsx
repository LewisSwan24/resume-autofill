// The resume keyboard wired into the whole app: an edit reaches writeData after the
// debounce; delete all sends no write once it starts and clears after; the Settings row reads the state; the WeChat
// hint leads to the setup screen; back returns to the Settings root; a read-only state sends nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../../mobile/app/src/App';
import { createFakeResumeKeyboard, type FakeResumeKeyboard } from '../../../../mobile/app/src/native/resumeKeyboard';
import { createMemoryAppStateStore, type AppStateStore } from '../../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore, type FileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../../mobile/app/src/store/wipe';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const WAIT = { timeout: 5000 };

const profileWith = (basics: Record<string, string>): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: '我的简历', locale: 'zh-CN', basics })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });

let store: ProfileStore;
let files: FileStore;
let appState: AppStateStore;
let back: (() => boolean) | null = null;

function start(kb: FakeResumeKeyboard | null, o: { profile?: Profile; state?: unknown } = {}) {
  store = createMemoryStore(o.profile ?? profileWith({ familyName: '张' }));
  files = createMemoryFileStore();
  appState = createMemoryAppStateStore(o.state ?? { version: 2, onboardingDone: true });
  const platform: Platform = {
    ...(kb ? { resumeKeyboard: kb } : {}),
    onBack(handler) {
      back = handler;
      return () => {
        back = null;
      };
    },
    onPause: () => () => undefined,
  };
  render(
    <App
      store={store}
      files={files}
      appState={appState}
      wiper={createStoreWiper({ profile: store, files, appState })}
      platform={platform}
      autosaveDelayMs={20}
      sweepDelayMs={30}
      now={() => Date.UTC(2026, 10, 15, 4, 0)}
    />,
  );
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name }, WAIT);
const tab = (name: string) => within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dataCalls = (kb: FakeResumeKeyboard) => kb.calls.filter((c) => c.method === 'writeData' || c.method === 'clearData');

async function editGivenName(value: string) {
  fireEvent.click(tab('简历'));
  fireEvent.click(await screen.findByRole('button', { name: /^基本信息/ }, WAIT));
  fireEvent.change(await screen.findByLabelText('名', undefined, WAIT), { target: { value } });
}

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  setLanguage('en');
  back = null;
});

describe('resume keyboard in the app', () => {
  it('while enabled, a profile edit reaches writeData after the debounce', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true });
    start(kb);
    await heading('首页');
    await editGivenName('三');
    await waitFor(() => expect(kb.stored ?? '').toContain('张三'), WAIT);
  });

  it('not enabled: the app clears the copy instead of writing it', async () => {
    const kb = createFakeResumeKeyboard({ enabled: false, stored: '{"stale":true}' });
    start(kb, { profile: profileWith({ familyName: '张', givenName: '三' }) });
    await heading('首页');
    await waitFor(() => expect(kb.calls.some((c) => c.method === 'clearData')).toBe(true), WAIT);
    expect(kb.calls.some((c) => c.method === 'writeData')).toBe(false);
    expect(kb.stored).toBeNull();
  });

  it('delete all: no writeData once the wipe starts, and clearData after', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true });
    start(kb, { profile: profileWith({ familyName: '张', givenName: '三' }) });
    await heading('首页');
    await waitFor(() => expect(kb.stored ?? '').toContain('张三'), WAIT);
    // A change whose write is still waiting for the debounce when the wipe starts.
    await editGivenName('四');
    fireEvent.click(tab('设置'));
    await heading('设置');
    fireEvent.click(screen.getByRole('button', { name: /^删除这台手机上的全部数据/ }));
    const sheet = await screen.findByRole('dialog', { name: '删除全部数据？' }, WAIT);
    const before = kb.calls.length;
    fireEvent.click(within(sheet).getByRole('button', { name: '永久删除' }));
    await heading(/^(你好，先说三件事|Hi! Three things first)$/);
    await waitFor(() => expect(kb.calls.slice(before).some((c) => c.method === 'clearData')).toBe(true), WAIT);
    await sleep(1500); // past any debounce that could still fire
    const after = kb.calls.slice(before);
    expect(after.filter((c) => c.method === 'writeData')).toEqual([]);
    expect(kb.stored).toBeNull();
  });

  it('the Settings row reads 正在使用 when the keyboard is current, and opens the setup screen; back returns', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true, current: true });
    start(kb);
    await heading('首页');
    fireEvent.click(tab('设置'));
    await heading('设置');
    const row = await screen.findByRole('button', { name: /^简历输入法/ }, WAIT);
    await waitFor(() => expect(within(row).getByText('正在使用')).toBeTruthy(), WAIT);
    fireEvent.click(row);
    await heading('简历输入法');
    expect(screen.getByRole('status', { name: '当前状态' }).textContent).toContain('正在使用简历输入法');
    expect(back!()).toBe(true);
    await heading('设置');
  });

  it('no Settings row and no hint without the plugin', async () => {
    start(null);
    await heading('首页');
    fireEvent.change(screen.getByRole('textbox', { name: '网申链接' }), { target: { value: '#小程序://示例招聘/abc' } });
    expect(screen.queryByText('在微信里填？用简历输入法')).toBeNull();
    fireEvent.click(tab('设置'));
    await heading('设置');
    expect(screen.queryByRole('button', { name: /^简历输入法/ })).toBeNull();
  });

  it('the Home hint leads to the setup screen', async () => {
    const kb = createFakeResumeKeyboard();
    start(kb);
    await heading('首页');
    fireEvent.change(screen.getByRole('textbox', { name: '网申链接' }), { target: { value: '#小程序://示例招聘/abc' } });
    const hint = screen.getByRole('note', { name: '在微信里填？用简历输入法' });
    fireEvent.click(within(hint).getByRole('button', { name: '设置简历输入法' }));
    await heading('简历输入法');
    expect(tab('设置').getAttribute('aria-current')).toBe('page');
  });

  it('a read-only state (written by a newer version) makes no keyboard data calls', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true, current: true, stored: '{"kept":true}' });
    start(kb, { profile: profileWith({ familyName: '张', givenName: '三' }), state: { version: 99, onboardingDone: true } });
    await heading('首页');
    await sleep(1500);
    expect(dataCalls(kb)).toEqual([]);
    expect(kb.stored).toBe('{"kept":true}');
  });
});
