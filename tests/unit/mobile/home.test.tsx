// Home: the copied-link card, the resume used for filling with its progress and missing details, the paste-a-link box
// (it hands the link to App, which records and opens it), the sample form and the applications sections
// (the old recent-pages list is no longer shown).
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
      <HomeScreen {...props} appState={api.state} showToast={(t) => setToast({ ...t, id: Math.random() })} />
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
  onOpenLink: Mock<HomeScreenProps['onOpenLink']>;
};

async function renderHome(
  opts: { profile?: Profile | null; loadError?: string | null; state?: Partial<AppState>; store?: AppStateStore; extra?: Partial<HomeScreenProps> } = {},
) {
  store = opts.store ?? createMemoryAppStateStore({ version: 1, onboardingDone: true, ...opts.state });
  callbacks = {
    onJump: vi.fn<HomeScreenProps['onJump']>(),
    onStartResume: vi.fn<HomeScreenProps['onStartResume']>(),
    onImport: vi.fn<() => void>(),
    onOpenSettings: vi.fn<() => void>(),
    onOpenBrowser: vi.fn<HomeScreenProps['onOpenBrowser']>(),
    onOpenLink: vi.fn<HomeScreenProps['onOpenLink']>(async () => undefined),
  };
  render(
    <Harness
      store={store}
      profile={opts.profile === undefined ? profileOf([resume('r1')]) : opts.profile}
      loadError={opts.loadError ?? null}
      now={() => NOW}
      {...callbacks}
      {...opts.extra}
    />,
  );
  await screen.findByRole('heading', { level: 1, name: '首页' });
}

const box = () => screen.getByLabelText('网申链接') as HTMLInputElement;
const typeLink = (text: string) => fireEvent.change(box(), { target: { value: text } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '打开' }));
const toastText = () => screen.getByRole('status').textContent ?? '';


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

  it('with a load error: says so and offers Settings; the applications still show', async () => {
    await renderHome({ profile: null, loadError: 'broken', extra: { applications: <section aria-label="网申记录区">示例科技</section> } });
    expect(screen.getByText('读不出简历资料：broken')).toBeTruthy();
    expect(screen.getByText('可以在设置里删除全部数据后重新开始。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '去设置' }));
    expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: '网申记录区' })).toBeTruthy();
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
    expect(callbacks.onOpenLink).not.toHaveBeenCalled();
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
    expect(callbacks.onOpenLink).not.toHaveBeenCalled();
  });

  it('a valid link goes to App (which records and opens it) as a paste, and the box clears', async () => {
    await renderHome();
    typeLink('https://jobs.example.com/apply/123');
    submit();
    await waitFor(() =>
      expect(callbacks.onOpenLink).toHaveBeenCalledWith({ url: 'https://jobs.example.com/apply/123', host: 'jobs.example.com', insecure: false }, 'paste'),
    );
    expect(callbacks.onOpenLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(box().value).toBe(''));
    expect(callbacks.onOpenBrowser).not.toHaveBeenCalled();
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

  it('share text keeps its title', async () => {
    await renderHome();
    typeLink('【示例科技】2026 校招后端开发 https://jobs.example.com/a?b=1。');
    submit();
    await waitFor(() =>
      expect(callbacks.onOpenLink).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://jobs.example.com/a?b=1', title: '示例科技 2026 校招后端开发' }), 'paste'),
    );
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

});

describe('Home: the sample form', () => {
  it('「没有链接？试试示例表单」 opens the demo, never as a link to record', async () => {
    await renderHome();
    const demo = screen.getByRole('button', { name: /^没有链接？试试示例表单/ });
    expect(demo.querySelector('svg')?.getAttribute('data-icon')).toBe('play-circle');
    expect(screen.getByText('用虚构的简历演示，不碰真实网站。')).toBeTruthy();
    fireEvent.click(demo);
    expect(callbacks.onOpenBrowser).toHaveBeenCalledWith({ url: 'https://appassets.androidplatform.net/demo/form.html', demo: true, source: 'demo-home' });
    await act(async () => undefined);
    expect(callbacks.onOpenLink).not.toHaveBeenCalled();
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

describe('Home: layout and ways in', () => {
  it('order: heading, copied-link card, resume card, paste card, demo, applications; no recent pages', async () => {
    await renderHome({
      extra: {
        clipboardCard: <section aria-label="复制卡">卡</section>,
        applications: <section aria-label="网申记录区">示例科技</section>,
      },
    });
    const main = document.body;
    const order = [
      screen.getByRole('heading', { level: 1, name: '首页' }),
      screen.getByRole('region', { name: '复制卡' }),
      screen.getByRole('button', { name: '编辑简历' }),
      box(),
      screen.getByRole('button', { name: /^没有链接？试试示例表单/ }),
      screen.getByRole('region', { name: '网申记录区' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(main).queryByText('最近的网申页面')).toBeNull();
  });

  it('the paste shortcut focuses the paste box and fills it from the clipboard, without opening', async () => {
    const readClipboard = vi.fn(async () => '【示例科技】网申 https://jobs.example.com/campus 备用 https://b.example.com/');
    const onPasteFocusDone = vi.fn();
    await renderHome({ extra: { pasteFocus: { nonce: 1, read: true }, readClipboard, onPasteFocusDone } });
    await waitFor(() => expect(box().value).toBe('https://jobs.example.com/campus'));
    expect(document.activeElement).toBe(box());
    expect(readClipboard).toHaveBeenCalledTimes(1);
    expect(onPasteFocusDone).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenLink).not.toHaveBeenCalled();
  });

  it('去粘贴链接 (no clipboard read) only focuses; a clip without a link leaves the box empty', async () => {
    const readClipboard = vi.fn(async () => '明天下午面试');
    await renderHome({ extra: { pasteFocus: { nonce: 2, read: false }, readClipboard, onPasteFocusDone: vi.fn() } });
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(readClipboard).not.toHaveBeenCalled();
    cleanup();
    await renderHome({ extra: { pasteFocus: { nonce: 3, read: true }, readClipboard, onPasteFocusDone: vi.fn() } });
    await waitFor(() => expect(readClipboard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(box().value).toBe('');
  });
});
