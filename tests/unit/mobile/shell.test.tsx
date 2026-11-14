// Mobile app shell: onboarding on a first run, the three tabs, one back-key order for the whole app, jumping from a
// missing item on Home to its field, and deleting everything. Full App with memory stores and a fake phone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../mobile/app/src/App';
import { createMemoryAppStateStore, type AppStateStore } from '../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore, type FileStore } from '../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../mobile/app/src/store/wipe';
import { exportProfile } from '../../../src/editor';
import { mt } from '../../../mobile/app/src/i18n';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';

const WAIT = { timeout: 4000 };
const zh = (key: string, params?: Record<string, string | number>) => mt('zh', key, params);

type ResumeSeed = { id: string; title: string; locale?: 'zh-CN' | 'en-AU' } & Record<string, unknown>;
function makeProfile(resumes: ResumeSeed[] = [{ id: 'r1', title: '我的简历' }]): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes.map((r) => ResumeSchema.parse({ locale: 'zh-CN', ...r })),
    activeResumeId: resumes[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}

function fakePlatform() {
  let back: (() => boolean) | null = null;
  let pause: (() => void) | null = null;
  const platform: Platform = {
    onBack(handler) {
      back = handler;
      return () => {
        back = null;
      };
    },
    onPause(handler) {
      pause = handler;
      return () => {
        pause = null;
      };
    },
  };
  return { platform, pressBack: () => back!(), pause: () => pause!() };
}

let store: ProfileStore;
let files: FileStore;
let appState: AppStateStore;
let device: ReturnType<typeof fakePlatform>;

/** Render the app on the given stores (a second call on the same stores is "the next start"). */
function start(options: { delay?: number } = {}) {
  device = fakePlatform();
  return render(
    <App
      store={store}
      files={files}
      appState={appState}
      wiper={createStoreWiper({ profile: store, files, appState })}
      platform={device.platform}
      autosaveDelayMs={options.delay ?? 20}
      sweepDelayMs={30}
      now={() => Date.UTC(2026, 10, 15, 4, 0)}
    />,
  );
}

function stores(profile?: Profile, state?: unknown) {
  store = createMemoryStore(profile);
  files = createMemoryFileStore();
  appState = createMemoryAppStateStore(state);
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name }, WAIT);
const nav = () => screen.getByRole('navigation', { name: '主导航' });
const tab = (name: string) => within(nav()).getByRole('button', { name });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const stored = async () => store.load();

const WELCOME_TITLE = '你好，先说三件事';
const START_TITLE = '准备好你的简历';
const ANY_WELCOME = /^(你好，先说三件事|Hi! Three things first)$/;

/** A first run opens in the phone's language (English under jsdom): switch the welcome step to Chinese. */
async function welcomeInChinese() {
  await heading(ANY_WELCOME);
  fireEvent.click(screen.getByRole('radio', { name: '中' }));
  await heading(WELCOME_TITLE);
}

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  setLanguage('en');
});

describe('Shell – onboarding', () => {
  it('first run with no data shows onboarding, not the tab bar', async () => {
    stores();
    start();
    await welcomeInChinese();
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull();
  });

  it('skip marks onboarding done; a new App on the same stores opens on Home', async () => {
    stores();
    start();
    await welcomeInChinese();
    press('跳过');
    await heading('首页');
    await waitFor(async () => expect((await appState.load())?.onboardingDone).toBe(true), WAIT);
    cleanup();
    start();
    await heading('首页');
    expect(screen.queryByRole('heading', { name: WELCOME_TITLE })).toBeNull();
  });

  it('an existing profile with resumes and no app state goes straight to Home', async () => {
    stores(makeProfile());
    start();
    await heading('首页');
    expect(nav()).toBeTruthy();
    await waitFor(async () => expect((await appState.load())?.onboardingDone).toBe(true), WAIT);
  });

  it('start from scratch creates a Chinese resume and opens the 简历 tab', async () => {
    stores();
    start();
    await welcomeInChinese();
    press('继续');
    await heading(START_TITLE);
    press(/^从空白开始/);
    press('新建中文简历');
    await heading('简历资料');
    expect(screen.getByRole('list', { name: '简历模块' })).toBeTruthy();
    expect(tab('简历').getAttribute('aria-current')).toBe('page');
    await waitFor(async () => expect((await stored()).resumes.map((r) => r.locale)).toEqual(['zh-CN']), WAIT);
    await waitFor(async () => expect((await appState.load())?.onboardingDone).toBe(true), WAIT);
  });

  it('import from computer during onboarding (plain file) lands on Home with the resume', async () => {
    stores();
    start();
    await welcomeInChinese();
    press('继续');
    await heading(START_TITLE);
    press(/^从电脑导入/);
    const incoming = makeProfile([{ id: 'x1', title: '示例简历', basics: { familyName: '张', givenName: '三' } }]);
    const file = new File([exportProfile(incoming)], 'profile.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('从文件导入'), { target: { files: [file] } });
    const preview = await screen.findByRole('dialog', { name: '文件里有什么' }, WAIT);
    fireEvent.click(within(preview).getByRole('button', { name: '导入' }));
    await heading('首页');
    expect(screen.getAllByText('示例简历').length).toBeGreaterThan(0);
    await waitFor(async () => expect((await stored()).resumes.map((r) => r.title)).toEqual(['示例简历']), WAIT);
  });

  it('back during onboarding: step 2 to step 1, then the system', async () => {
    stores();
    start();
    await welcomeInChinese();
    press('继续');
    await heading(START_TITLE);
    expect(device.pressBack()).toBe(true);
    await heading(WELCOME_TITLE);
    expect(device.pressBack()).toBe(false);
  });
});

describe('Shell – tabs and the back key', () => {
  it('the tab bar has Home, Resumes and Settings; the current one is aria-current="page" and each shows its heading', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    expect(within(nav()).getAllByRole('button').map((b) => b.textContent!.trim())).toEqual(['首页', '简历', '设置']);
    expect(tab('首页').getAttribute('aria-current')).toBe('page');
    for (const [name, title] of [
      ['简历', '简历资料'],
      ['设置', '设置'],
      ['首页', '首页'],
    ] as const) {
      fireEvent.click(tab(name));
      const h1 = await heading(title);
      expect(tab(name).getAttribute('aria-current')).toBe('page');
      expect(within(nav()).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page')).toHaveLength(1);
      await waitFor(() => expect(document.activeElement).toBe(h1), WAIT);
    }
  });

  it('back: closes a sheet, then a module, then goes home, then lets the system have it', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    fireEvent.click(tab('简历'));
    await heading('简历资料');
    press(/^语言能力/);
    press(zh('options.add', { name: zh('options.module.languages') }));
    press(/^熟练程度/);
    expect(screen.getByRole('dialog')).toBeTruthy();

    expect(device.pressBack()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(device.pressBack()).toBe(true);
    await heading('简历资料');
    expect(device.pressBack()).toBe(true);
    await heading('首页');
    expect(device.pressBack()).toBe(false);
  });

  it('back from the privacy page: settings, then home, then the system', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    fireEvent.click(tab('设置'));
    await heading('设置');
    press(/^隐私说明/);
    await heading('隐私说明');
    expect(device.pressBack()).toBe(true);
    await heading('设置');
    expect(device.pressBack()).toBe(true);
    await heading('首页');
    expect(device.pressBack()).toBe(false);
  });

  it('a module left open on the 简历 tab is still open when coming back', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    fireEvent.click(tab('简历'));
    press(/^基本信息/);
    await heading('基本信息');
    fireEvent.click(tab('首页'));
    await heading('首页');
    fireEvent.click(tab('简历'));
    await heading('基本信息');
    fireEvent.click(tab('简历'));
    await heading('简历资料');
  });

  it('toast sits above the tab bar (--m-tabbar-h is set when the tab bar renders)', async () => {
    document.documentElement.style.removeProperty('--m-tabbar-h');
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--m-tabbar-h')).toMatch(/px$/), WAIT);
  });
});

describe('Shell – jumping from Home to a missing field', () => {
  it('a missing item on Home opens the field on the 简历 tab with the cursor in it', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    press(zh('options.field.phone'));
    await heading(zh('options.module.contact'));
    expect(tab('简历').getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(zh('options.field.phone'))), WAIT);
    expect(document.activeElement!.closest('[data-field-path]')!.getAttribute('data-field-path')).toBe('contact.phone');
    expect(document.activeElement!.closest('.m-field--target')).not.toBeNull();
  });

  it('jumping to a missing school with no education entry focuses the add button', async () => {
    stores(
      makeProfile([
        { id: 'r1', title: '我的简历', basics: { familyName: '张', givenName: '三' }, contact: { phone: '13800000000', email: 'zhangsan@example.com' } },
      ]),
      { version: 1, onboardingDone: true },
    );
    start();
    await heading('首页');
    press(zh('options.field.school'));
    await heading(zh('options.module.education'));
    const add = screen.getByRole('button', { name: zh('options.add', { name: zh('options.module.education') }) });
    await waitFor(() => expect(document.activeElement).toBe(add), WAIT);
  });

  it('jumping to a school in an existing entry opens that entry and focuses the school', async () => {
    stores(
      makeProfile([
        {
          id: 'r1',
          title: '我的简历',
          basics: { familyName: '张', givenName: '三' },
          contact: { phone: '13800000000', email: 'zhangsan@example.com' },
          education: [{ major: '计算机' }, { major: '数学' }],
        },
      ]),
      { version: 1, onboardingDone: true },
    );
    start();
    await heading('首页');
    press(zh('options.field.school'));
    await heading(zh('options.module.education'));
    await waitFor(() => expect(document.activeElement?.closest('[data-field-path]')?.getAttribute('data-field-path')).toBe('education.0.school'), WAIT);
  });

  it('jumping to the resume PDF focuses its choose-file button', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    press(new RegExp(`^${zh('m.home.missingMore', { n: '\\d+' })}`));
    const sheet = await screen.findByRole('dialog', { name: '还缺的信息' }, WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: zh('options.attach.resume') }));
    await heading(zh('options.module.attachments'));
    const label = zh('options.attach.resume');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(`${label} – 选择文件`)), WAIT);
  });

  it('jump with fill language en makes the English resume the active one first', async () => {
    stores(
      makeProfile([
        { id: 'r1', title: '中文版简历' },
        { id: 'r2', title: 'English resume', locale: 'en-AU' },
      ]),
      { version: 1, onboardingDone: true, fillLanguage: 'en' },
    );
    start();
    await heading('首页');
    expect(screen.getAllByText('English resume').length).toBeGreaterThan(0);
    press(zh('options.field.phone'));
    await heading(zh('options.module.contact'));
    await waitFor(async () => expect((await stored()).activeResumeId).toBe('r2'), WAIT);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(zh('options.field.phone'))), WAIT);
  });
});

describe('Shell – data', () => {
  it('a pasted link is stored in the app-state store, not the profile store', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    fireEvent.change(screen.getByLabelText('网申链接'), { target: { value: 'https://jobs.example.com/apply/1' } });
    press('打开');
    await waitFor(async () => expect((await appState.load())?.recentPages.map((p) => p.url)).toEqual(['https://jobs.example.com/apply/1']), WAIT);
    expect(JSON.stringify(await stored())).not.toContain('jobs.example.com');
  });

  it('interface language moved to Settings: switching to EN changes the tab labels', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start();
    await heading('首页');
    fireEvent.click(tab('设置'));
    await heading('设置');
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' }, WAIT);
    const bar = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent!.trim())).toEqual(['Home', 'Resumes', 'Settings']);
    await waitFor(async () => expect((await stored()).settings.uiLanguage).toBe('en'), WAIT);
  });

  it('delete all: every store is emptied and onboarding shows again', async () => {
    stores(makeProfile(), {
      version: 1,
      onboardingDone: true,
      recentPages: [{ id: 'p1', url: 'https://jobs.example.com/apply/1', host: 'jobs.example.com', addedAt: 1 }],
    });
    const file = await files.put({ name: 'cv.pdf', type: 'application/pdf', bytes: new Uint8Array(4) });
    const profile = await store.load();
    profile.resumes[0]!.attachments.resumeFileId = file.id;
    await store.save(profile);
    start();
    await heading('首页');
    fireEvent.click(tab('设置'));
    await heading('设置');
    press(/^删除这台手机上的全部数据/);
    const sheet = await screen.findByRole('dialog', { name: '删除全部数据？' }, WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: '永久删除' }));
    await heading(ANY_WELCOME); // settings are gone too, so the phone's language again
    expect(await screen.findByText('这台手机上的数据已全部删除', undefined, WAIT)).toBeTruthy();
    expect((await stored()).resumes).toEqual([]);
    expect(await files.list()).toEqual([]);
    const state = await appState.load();
    expect(state === null || (state.onboardingDone === false && state.recentPages.length === 0)).toBe(true);
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull();
  });

  it('the app still saves at once when it goes to the background, from any tab', async () => {
    stores(makeProfile(), { version: 1, onboardingDone: true });
    start({ delay: 60_000 });
    await heading('首页');
    fireEvent.click(tab('简历'));
    press(/^基本信息/);
    fireEvent.change(screen.getByLabelText('名'), { target: { value: '三' } });
    fireEvent.click(tab('设置'));
    await heading('设置');
    device.pause();
    await waitFor(async () => expect((await stored()).resumes[0]!.basics.givenName).toBe('三'), WAIT);
  });
});

describe('Shell – edge cases', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('focus moves to the new heading on screen changes that are not tab changes', async () => {
    stores();
    start();
    await welcomeInChinese();
    press('继续');
    const ready = await heading(START_TITLE);
    await waitFor(() => expect(document.activeElement).toBe(ready), WAIT);
    press('跳过');
    const home = await heading('首页');
    await waitFor(() => expect(document.activeElement).toBe(home), WAIT);
    fireEvent.click(tab('设置'));
    await heading('设置');
    press(/^隐私说明/);
    const privacy = await heading('隐私说明');
    await waitFor(() => expect(document.activeElement).toBe(privacy), WAIT);
    press('返回');
    const settings = await heading('设置');
    await waitFor(() => expect(document.activeElement).toBe(settings), WAIT);
  });

  it('with a profile that cannot be read: import says it cannot, and delete all names the unreadable data', async () => {
    const inner = createMemoryStore();
    store = { load: () => Promise.reject(new Error('解不开')), save: (p) => inner.save(p) };
    files = createMemoryFileStore();
    appState = createMemoryAppStateStore({ version: 1, onboardingDone: true });
    start();
    await heading('首页');
    fireEvent.click(tab('设置'));
    await heading('设置');
    press(/^从文件导入/);
    const sheet = await screen.findByRole('dialog', { name: '现在不能导入' }, WAIT);
    fireEvent.click(within(sheet).getAllByRole('button', { name: '关闭' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    press(/^删除这台手机上的全部数据/);
    const wipe = await screen.findByRole('dialog', { name: '删除全部数据？' }, WAIT);
    expect(within(wipe).getByText('简历：读不出来的资料也会一起删掉')).toBeTruthy();
  });

  it('when app state can never be saved, 跳过 says so and Home stays for this run', async () => {
    store = createMemoryStore();
    files = createMemoryFileStore();
    appState = { load: async () => null, clear: async () => {}, save: () => Promise.reject(new Error('no key')) };
    start();
    await welcomeInChinese();
    press('跳过');
    await heading('首页');
    expect(await screen.findByText('没能保存，请再试一次。', undefined, WAIT)).toBeTruthy();
    await act(() => sleep(50));
    expect(screen.getByRole('heading', { level: 1, name: '首页' })).toBeTruthy();
  });

  it('a failed save when starting from scratch says so, and trying again does not make a second resume', async () => {
    stores();
    const inner = appState;
    let saves = 0;
    appState = { load: () => inner.load(), clear: () => inner.clear(), save: (s) => (++saves === 2 ? Promise.reject(new Error('busy')) : inner.save(s)) };
    start();
    await welcomeInChinese();
    press('继续');
    await heading(START_TITLE);
    press(/^从空白开始/);
    press('新建中文简历');
    expect(await screen.findByText('没能保存，请再试一次。', undefined, WAIT)).toBeTruthy();
    await heading(START_TITLE);
    press(/^从空白开始/);
    press('新建中文简历');
    await heading('简历资料');
    await waitFor(async () => expect((await appState.load())?.onboardingDone).toBe(true), WAIT);
    await act(() => sleep(50));
    expect((await stored()).resumes).toHaveLength(1);
  });
});
