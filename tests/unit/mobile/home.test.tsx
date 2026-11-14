// Home: the resume used for filling with its progress and missing details, the paste-a-link box, and the list of
// recent application pages (stored in app state, with remove, clear and undo).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useMemo, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HomeScreen, type HomeScreenProps } from '../../../mobile/app/src/home/HomeScreen';
import { createMemoryAppStateStore, type AppState, type AppStateStore } from '../../../mobile/app/src/store/appStateStore';
import { BackStackContext, Toast, createBackStack, type ToastMessage } from '../../../mobile/app/src/ui';
import { useAppState } from '../../../mobile/app/src/useAppState';
import { setLanguage } from '../../../src/i18n';
import { EducationSchema, ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../src/schema';

const NOW = new Date(2026, 10, 15, 14, 30).getTime();
const MIN = 60_000;

function resume(id: string, over: Record<string, unknown> = {}, locale: 'zh-CN' | 'en-AU' = 'zh-CN'): Resume {
  return ResumeSchema.parse({ id, title: locale === 'zh-CN' ? '我的中文简历' : 'My English resume', locale, ...over });
}
function profileOf(resumes: Resume[], active = resumes[0]?.id ?? null): Profile {
  return ProfileSchema.parse({ schemaVersion: 1, resumes, activeResumeId: active, settings: { uiLanguage: 'zh' } });
}
const threeFilled = () =>
  resume('r1', {
    basics: { familyName: '张', givenName: '三' },
    contact: { phone: '13800000000', email: 'zhangsan@example.com' },
    education: [EducationSchema.parse({ school: '示例大学', degree: 'bachelor', major: '计算机科学' })],
  });

function Harness({ store, ...props }: Omit<HomeScreenProps, 'appState' | 'updateAppState' | 'showToast'> & { store: AppStateStore }) {
  const api = useAppState(store, { hasResumes: true });
  const backStack = useMemo(() => createBackStack(), []);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  if (!api.state) return null;
  return (
    <BackStackContext.Provider value={backStack}>
      <HomeScreen {...props} appState={api.state} updateAppState={api.update} showToast={(t) => setToast({ ...t, id: Math.random() })} />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </BackStackContext.Provider>
  );
}

let store: AppStateStore;
let callbacks: {
  onJump: Mock<HomeScreenProps['onJump']>;
  onStartResume: Mock<HomeScreenProps['onStartResume']>;
  onImport: Mock<() => void>;
  onOpenSettings: Mock<() => void>;
  onOpenBrowser: Mock<HomeScreenProps['onOpenBrowser']>;
};

async function renderHome(
  opts: { profile?: Profile | null; loadError?: string | null; state?: Partial<AppState>; store?: AppStateStore } = {},
) {
  store = opts.store ?? createMemoryAppStateStore({ version: 1, onboardingDone: true, ...opts.state });
  callbacks = {
    onJump: vi.fn<HomeScreenProps['onJump']>(),
    onStartResume: vi.fn<HomeScreenProps['onStartResume']>(),
    onImport: vi.fn<() => void>(),
    onOpenSettings: vi.fn<() => void>(),
    onOpenBrowser: vi.fn<HomeScreenProps['onOpenBrowser']>(),
  };
  render(
    <Harness
      store={store}
      profile={opts.profile === undefined ? profileOf([resume('r1')]) : opts.profile}
      loadError={opts.loadError ?? null}
      now={() => NOW}
      {...callbacks}
    />,
  );
  await screen.findByRole('heading', { level: 1, name: '首页' });
}

const stored = async () => (await store.load())!;
const box = () => screen.getByLabelText('网申链接') as HTMLInputElement;
const typeLink = (text: string) => fireEvent.change(box(), { target: { value: text } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '打开' }));
const toastText = () => screen.getByRole('status').textContent ?? '';
const recentList = () => screen.getByRole('list', { name: '最近的网申页面' });

const page = (id: string, url: string, host: string, minutesAgo: number, title?: string) => ({
  id,
  url,
  host,
  addedAt: NOW - minutesAgo * MIN,
  ...(title ? { title } : {}),
});

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('Home: resume in use', () => {
  it('shows the resume in use: title, language tag, "关键模块已填 3/7" and a progressbar with value 3 of 7', async () => {
    await renderHome({ profile: profileOf([threeFilled()]) });
    expect(screen.getByText('填写时会用这份简历')).toBeTruthy();
    expect(screen.getByText('我的中文简历')).toBeTruthy();
    expect(screen.getByText('中')).toBeTruthy();
    expect(screen.getByText('关键模块已填 3/7')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: '关键模块填写进度' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('7');
    expect(screen.getByText('还缺这些')).toBeTruthy();
    expect(screen.getByRole('button', { name: '意向职位' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '简历文件 (PDF)' })).toBeTruthy();
  });

  it('lists the first three missing items and "还有 N 项", which opens a sheet with all of them', async () => {
    await renderHome();
    const missing = screen.getByRole('list', { name: '还缺这些' });
    expect(within(missing).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['姓名', '手机号码', '邮箱', '还有 5 项']);
    fireEvent.click(screen.getByRole('button', { name: '还有 5 项' }));
    const sheet = screen.getByRole('dialog', { name: '还缺的信息' });
    expect(within(sheet).getAllByRole('button').filter((b) => b.textContent?.trim()).map((b) => b.textContent?.trim())).toEqual([
      '姓名', '手机号码', '邮箱', '学校', '学历', '专业', '意向职位', '简历文件 (PDF)',
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: '专业' }));
    expect(callbacks.onJump).toHaveBeenCalledWith('r1', { module: 'education', field: 'major' });
  });

  it('when everything key is filled, says so', async () => {
    const full = resume('r1', {
      basics: { familyName: '张', givenName: '三' },
      contact: { phone: '13800000000', email: 'zhangsan@example.com' },
      education: [EducationSchema.parse({ school: '示例大学', degree: 'bachelor', major: '数学' })],
      jobIntention: { positions: ['后端开发'] },
      attachments: { resumeFileId: 'f1' },
    });
    await renderHome({ profile: profileOf([full]) });
    expect(screen.getByText('关键信息都填好了')).toBeTruthy();
    expect(screen.queryByText('还缺这些')).toBeNull();
  });

  it('tapping a missing item asks to jump to that field of that resume', async () => {
    await renderHome();
    fireEvent.click(screen.getByRole('button', { name: '手机号码' }));
    expect(callbacks.onJump).toHaveBeenCalledWith('r1', { module: 'contact', field: 'phone' });
    fireEvent.click(screen.getByRole('button', { name: '编辑简历' }));
    expect(callbacks.onJump).toHaveBeenLastCalledWith('r1');
  });

  it('fill language en with an English resume linked: shows the English one', async () => {
    const zh = resume('r1', { linkedResumeId: 'r2' });
    const en = resume('r2', { linkedResumeId: 'r1' }, 'en-AU');
    await renderHome({ profile: profileOf([zh, en], 'r1'), state: { fillLanguage: 'en' } });
    expect(screen.getByText('My English resume')).toBeTruthy();
    expect(screen.getByText('EN')).toBeTruthy();
    expect(screen.queryByText(/会先用这份/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '手机号码' }));
    expect(callbacks.onJump).toHaveBeenCalledWith('r2', { module: 'contact', field: 'phone' });
  });

  it('fill language en with no English resume: shows the fallback line', async () => {
    await renderHome({ state: { fillLanguage: 'en' } });
    expect(screen.getByText('没有英文简历，会先用这份。')).toBeTruthy();
    expect(screen.getByText('我的中文简历')).toBeTruthy();
  });

  it('with no resume: offers new Chinese, new English and import', async () => {
    await renderHome({ profile: profileOf([]) });
    expect(screen.getByText('还没有简历')).toBeTruthy();
    expect(screen.getByText('先建一份，或者导入电脑上导出的文件。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建中文简历' }));
    expect(callbacks.onStartResume).toHaveBeenLastCalledWith('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '新建英文简历' }));
    expect(callbacks.onStartResume).toHaveBeenLastCalledWith('en-AU');
    fireEvent.click(screen.getByRole('button', { name: '从文件导入' }));
    expect(callbacks.onImport).toHaveBeenCalledTimes(1);
  });

  it('with a load error: says so and offers Settings; recent pages still show', async () => {
    await renderHome({
      profile: null,
      loadError: 'broken',
      state: { recentPages: [page('p1', 'https://jobs.example.com/a', 'jobs.example.com', 5)] },
    });
    expect(screen.getByText('读不出简历资料：broken')).toBeTruthy();
    expect(screen.getByText('可以在设置里删除全部数据后重新开始。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '去设置' }));
    expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(within(recentList()).getByText('jobs.example.com')).toBeTruthy();
  });
});

describe('Home: paste a link', () => {
  it('submitting an invalid link shows the error, saves nothing, keeps focus in the box', async () => {
    await renderHome();
    box().focus();
    typeLink('投递链接在群里');
    submit();
    expect(await screen.findByText('这段文字里没有找到链接。')).toBeTruthy();
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(box());
    expect((await stored()).recentPages).toEqual([]);
  });

  it('an empty box says to paste a link first', async () => {
    await renderHome();
    fireEvent.submit(box().form!);
    expect(await screen.findByText('先粘贴一个链接。')).toBeTruthy();
  });

  it('a javascript: link is refused with the http/https message', async () => {
    await renderHome();
    typeLink('javascript:alert(1)');
    submit();
    expect(await screen.findByText('只能打开 http 或 https 开头的网页链接。')).toBeTruthy();
    expect((await stored()).recentPages).toEqual([]);
  });

  it('a valid link is saved to recent pages, the box clears, and the browser opens on it with its recent id', async () => {
    await renderHome();
    typeLink('https://jobs.example.com/apply/123');
    submit();
    await waitFor(async () => expect((await stored()).recentPages.map((p) => p.url)).toEqual(['https://jobs.example.com/apply/123']));
    const id = (await stored()).recentPages[0]!.id;
    await waitFor(() =>
      expect(callbacks.onOpenBrowser).toHaveBeenCalledWith({ url: 'https://jobs.example.com/apply/123', demo: false, recentId: id, source: 'paste' }),
    );
    expect(callbacks.onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(box().value).toBe('');
    expect(toastText()).not.toContain('已存到');
    expect(toastText()).not.toContain('下个版本');
    expect(within(recentList()).getByText('jobs.example.com')).toBeTruthy();
    expect(within(recentList()).getByText('刚刚')).toBeTruthy();
  });

  it('pasting a link already listed moves it to the top and opens it with the same id', async () => {
    await renderHome({
      state: {
        recentPages: [
          page('p1', 'https://careers.example.com/x', 'careers.example.com', 5),
          page('p2', 'https://jobs.example.com/apply/1', 'jobs.example.com', 60),
        ],
      },
    });
    typeLink('https://jobs.example.com/apply/1');
    submit();
    await waitFor(async () => expect((await stored()).recentPages.map((p) => p.id)).toEqual(['p2', 'p1']));
    await waitFor(() => expect(callbacks.onOpenBrowser).toHaveBeenCalledWith(expect.objectContaining({ recentId: 'p2', source: 'paste' })));
  });

  it('while typing a valid link it shows "将打开：host"; an http link also shows the not-encrypted note', async () => {
    await renderHome();
    typeLink('https://www.example.com/jobs');
    expect(await screen.findByText('将打开：example.com')).toBeTruthy();
    expect(screen.queryByText('这个页面没有加密（http），填写时多留意。')).toBeNull();
    typeLink('http://jobs.example.com/a');
    expect(await screen.findByText('将打开：jobs.example.com')).toBeTruthy();
    expect(screen.getByText('这个页面没有加密（http），填写时多留意。')).toBeTruthy();
    // Errors wait for a submit.
    typeLink('投递链接在群里');
    await waitFor(() => expect(screen.queryByText('将打开：jobs.example.com')).toBeNull());
    expect(screen.queryByText('这段文字里没有找到链接。')).toBeNull();
  });

  it('share text keeps its title, shown in the row', async () => {
    await renderHome();
    typeLink('【示例科技】2026 校招后端开发 https://jobs.example.com/a?b=1。');
    submit();
    await waitFor(() => expect(within(recentList()).getByText('示例科技 2026 校招后端开发')).toBeTruthy());
    expect((await stored()).recentPages[0]).toMatchObject({ url: 'https://jobs.example.com/a?b=1', title: '示例科技 2026 校招后端开发' });
  });

  it('paste from clipboard fills the box; when the clipboard cannot be read, says to long-press', async () => {
    const readText = vi.fn().mockResolvedValueOnce('https://jobs.example.com/x').mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { readText, writeText: vi.fn() }, configurable: true });
    await renderHome();
    fireEvent.click(screen.getByRole('button', { name: '从剪贴板粘贴' }));
    await waitFor(() => expect(box().value).toBe('https://jobs.example.com/x'));
    fireEvent.click(screen.getByRole('button', { name: '从剪贴板粘贴' }));
    await waitFor(() => expect(toastText()).toContain('读不到剪贴板，请长按输入框粘贴。'));
  });

  it('no clipboard button when the clipboard cannot be read at all', async () => {
    await renderHome();
    expect(screen.queryByRole('button', { name: '从剪贴板粘贴' })).toBeNull();
  });

  it('when saving app state fails, says so, the list on screen goes back, and the browser still opens', async () => {
    const memory = createMemoryAppStateStore({ version: 1, onboardingDone: true });
    const failing: AppStateStore = { load: () => memory.load(), save: () => Promise.reject(new Error('disk')), clear: () => memory.clear() };
    await renderHome({ store: failing });
    typeLink('https://jobs.example.com/apply/9');
    submit();
    await waitFor(() => expect(toastText()).toContain('没能保存，请再试一次。'));
    await waitFor(() =>
      expect(callbacks.onOpenBrowser).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://jobs.example.com/apply/9', demo: false, source: 'paste' })),
    );
    expect(screen.queryByText('jobs.example.com')).toBeNull();
    expect(screen.getByText('粘贴过的链接会出现在这里。')).toBeTruthy();
  });
});

describe('Home: recent pages', () => {
  const two = () => ({
    recentPages: [
      page('p1', 'https://jobs.example.com/apply/1', 'jobs.example.com', 5, '示例科技 校招'),
      page('p2', 'https://careers.example.com/x', 'careers.example.com', 60 * 24 * 12),
    ],
  });

  it('recent rows show host, title and relative time', async () => {
    await renderHome({ state: two() });
    const rows = within(recentList()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('jobs.example.com')).toBeTruthy();
    expect(within(rows[0]!).getByText('示例科技 校招')).toBeTruthy();
    expect(within(rows[0]!).getByText('5 分钟前')).toBeTruthy();
    expect(within(rows[1]!).getByText('careers.example.com')).toBeTruthy();
    expect(within(rows[1]!).getByText('11月3日')).toBeTruthy();
  });

  it('removing one (from its ⋯ sheet) offers undo, which puts it back', async () => {
    await renderHome({ state: two() });
    expect(screen.queryByRole('button', { name: '从列表移除：jobs.example.com' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作：jobs.example.com' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '从列表移除' }));
    });
    await waitFor(() => expect(screen.queryByText('jobs.example.com')).toBeNull());
    expect(toastText()).toContain('已移除 jobs.example.com');
    await waitFor(async () => expect((await stored()).recentPages.map((p) => p.id)).toEqual(['p2']));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(within(recentList()).getByText('jobs.example.com')).toBeTruthy());
    await waitFor(async () => expect((await stored()).recentPages.map((p) => p.id)).toEqual(['p1', 'p2']));
  });

  it('clear all asks first; after clearing, undo restores the list', async () => {
    await renderHome({ state: two() });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    const sheet = screen.getByRole('dialog', { name: '清空最近的网申页面？' });
    expect(within(sheet).getByText('会移除列表里的 2 个链接，简历不受影响。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(recentList()).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清空' }));
    await waitFor(() => expect(screen.getByText('粘贴过的链接会出现在这里。')).toBeTruthy());
    expect(toastText()).toContain('已清空');
    await waitFor(async () => expect((await stored()).recentPages).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(within(recentList()).getAllByRole('listitem')).toHaveLength(2));
  });

  it('empty list says links will show up here, with nothing to clear', async () => {
    await renderHome();
    expect(screen.getByText('粘贴过的链接会出现在这里。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
  });

  it('tapping a row opens the browser on its link and moves it to the top', async () => {
    await renderHome({ state: two() });
    fireEvent.click(screen.getByRole('button', { name: '打开 careers.example.com' }));
    await waitFor(() =>
      expect(callbacks.onOpenBrowser).toHaveBeenCalledWith({ url: 'https://careers.example.com/x', demo: false, recentId: 'p2', source: 'recent' }),
    );
    await waitFor(async () => expect((await stored()).recentPages.map((p) => p.id)).toEqual(['p2', 'p1']));
    expect((await stored()).recentPages[0]!.addedAt).toBe(NOW);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the ⋯ button opens the detail sheet with 打开, 复制链接 and 从列表移除; copy writes the link', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderHome({ state: two() });
    const more = screen.getByRole('button', { name: '更多操作：jobs.example.com' });
    expect(more.querySelector('svg')?.getAttribute('data-icon')).toBe('three-dots');
    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: '网申页面' });
    expect(within(sheet).getByText('https://jobs.example.com/apply/1')).toBeTruthy();
    expect(within(sheet).queryByText(/还在做/)).toBeNull();
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent?.trim()).filter(Boolean)).toEqual(['打开', '复制链接', '从列表移除']);
    fireEvent.click(within(sheet).getByRole('button', { name: '复制链接' }));
    await waitFor(() => expect(toastText()).toContain('已复制'));
    expect(writeText).toHaveBeenCalledWith('https://jobs.example.com/apply/1');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '复制链接' }));
    await waitFor(() => expect(toastText()).toContain('没能复制，请长按链接手动复制。'));
  });

  it('打开 in the detail sheet closes it and opens the browser', async () => {
    await renderHome({ state: two() });
    fireEvent.click(screen.getByRole('button', { name: '更多操作：jobs.example.com' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '打开' }));
    await waitFor(() => expect(callbacks.onOpenBrowser).toHaveBeenCalledWith(expect.objectContaining({ recentId: 'p1', source: 'recent' })));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the detail sheet can remove the page from the list', async () => {
    await renderHome({ state: two() });
    fireEvent.click(screen.getByRole('button', { name: '更多操作：careers.example.com' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '从列表移除' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.queryByText('careers.example.com')).toBeNull());
    expect(toastText()).toContain('已移除 careers.example.com');
  });
});

describe('Home: the sample form', () => {
  it('「没有链接？试试示例表单」 opens the demo and writes no recent entry', async () => {
    await renderHome();
    const demo = screen.getByRole('button', { name: /^没有链接？试试示例表单/ });
    expect(demo.querySelector('svg')?.getAttribute('data-icon')).toBe('play-circle');
    expect(screen.getByText('用虚构的简历演示，不碰真实网站。')).toBeTruthy();
    fireEvent.click(demo);
    expect(callbacks.onOpenBrowser).toHaveBeenCalledWith({ url: 'https://appassets.androidplatform.net/demo/form.html', demo: true, source: 'demo-home' });
    await act(async () => undefined);
    expect((await stored()).recentPages).toEqual([]);
  });
});

describe('Home: icons keep one meaning each', () => {
  it('"还有 N 项" opens a list (not the three-dots menu icon); 编辑简历 goes to the 简历 tab (not the rename pencil)', async () => {
    await renderHome();
    const more = screen.getByRole('button', { name: '还有 5 项' });
    expect(more.querySelector('svg')?.getAttribute('data-icon')).toBe('list-ul');
    const edit = screen.getByRole('button', { name: '编辑简历' });
    expect(edit.querySelector('svg')?.getAttribute('data-icon')).toBe('person-vcard');
  });
});
