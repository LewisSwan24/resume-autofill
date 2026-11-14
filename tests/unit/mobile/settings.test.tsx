// Settings: interface language, the resume used for filling, export (plain or with a password), import, delete
// everything, the privacy page and the about sheet.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useMemo, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsScreen, type SettingsScreenProps } from '../../../mobile/app/src/settings/SettingsScreen';
import { decryptExport } from '../../../mobile/app/src/data/exportCrypto';
import { createMemoryAppStateStore, type AppState, type AppStateStore } from '../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore, type FileStore } from '../../../mobile/app/src/store/fileStore';
import { BackStackContext, Toast, createBackStack, type ToastMessage } from '../../../mobile/app/src/ui';
import { useAppState } from '../../../mobile/app/src/useAppState';
import type { SettingsPage } from '../../../mobile/app/src/navigation';
import { parseProfileJson } from '../../../src/editor';
import { setLanguage, useLanguage, type Language } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';

type SaveDocument = NonNullable<SettingsScreenProps['saveDocument']>;

function profileOf(titles: { id: string; title: string; locale?: 'zh-CN' | 'en-AU' }[]): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: titles.map((r) => ResumeSchema.parse({ locale: 'zh-CN', ...r })),
    activeResumeId: titles[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}
const two = () => profileOf([{ id: 'r1', title: '中文简历' }, { id: 'r2', title: 'English resume', locale: 'en-AU' }]);

interface Fakes {
  profile?: Profile | null;
  stored?: Profile;
  saveDocument?: SaveDocument;
  appInfo?: SettingsScreenProps['appInfo'];
  onWipe?: () => Promise<boolean>;
  state?: Partial<AppState>;
  files?: FileStore;
  loadError?: string | null;
  title?: string;
  clearSiteData?: () => Promise<void>;
}

let store: AppStateStore;
let spies: { onLanguage: Mock<(l: Language) => void>; onImport: Mock<() => void>; readStoredProfile: Mock<() => Promise<Profile>>; onWipe: Mock<() => Promise<boolean>> };

function Harness(props: Omit<SettingsScreenProps, 'page' | 'onPage' | 'language' | 'onLanguage' | 'appState' | 'updateAppState' | 'showToast'> & { store: AppStateStore; onLanguageSpy: (l: Language) => void }) {
  const { store: s, onLanguageSpy, ...rest } = props;
  const api = useAppState(s, { hasResumes: true });
  const language = useLanguage();
  const [page, setPage] = useState<SettingsPage>('root');
  const backStack = useMemo(() => createBackStack(), []);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  if (!api.state) return null;
  return (
    <BackStackContext.Provider value={backStack}>
      <SettingsScreen
        {...rest}
        page={page}
        onPage={setPage}
        language={language}
        onLanguage={(l) => {
          setLanguage(l);
          onLanguageSpy(l);
        }}
        appState={api.state}
        updateAppState={api.update}
        showToast={(t) => setToast({ ...t, id: Math.random() })}
      />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </BackStackContext.Provider>
  );
}

async function renderSettings(f: Fakes = {}) {
  store = createMemoryAppStateStore({ version: 1, onboardingDone: true, ...f.state });
  const stored = f.stored ?? (f.profile === undefined ? two() : f.profile ?? profileOf([]));
  spies = {
    onLanguage: vi.fn<(l: Language) => void>(),
    onImport: vi.fn<() => void>(),
    readStoredProfile: vi.fn<() => Promise<Profile>>(async () => stored),
    onWipe: vi.fn<() => Promise<boolean>>(f.onWipe ?? (async () => true)),
  };
  render(
    <Harness
      store={store}
      onLanguageSpy={spies.onLanguage}
      profile={f.profile === undefined ? two() : f.profile}
      readStoredProfile={spies.readStoredProfile}
      files={f.files ?? createMemoryFileStore()}
      saveDocument={f.saveDocument}
      appInfo={f.appInfo}
      onImport={spies.onImport}
      onWipe={spies.onWipe}
      loadError={f.loadError ?? null}
      clearSiteData={f.clearSiteData}
    />,
  );
  await screen.findByRole('heading', { level: 1, name: f.title ?? '设置' });
}

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const toastText = () => screen.getByRole('status').textContent ?? '';
const openExport = () => {
  fireEvent.click(screen.getByRole('button', { name: /^导出全部数据/ }));
  return screen.getByRole('dialog', { name: '导出全部数据' });
};
const savingDoc = (result: 'saved' | 'cancelled' = 'saved') => vi.fn<SaveDocument>(async () => result);

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  setLanguage('zh');
});

describe('Settings: general', () => {
  it('has the groups and rows', async () => {
    await renderSettings();
    for (const name of ['通用', '数据', '关于']) expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^填写时默认用/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^删除这台手机上的全部数据/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^隐私说明/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^关于这个 App/ })).toBeTruthy();
  });

  it('interface language: picking EN switches the words', async () => {
    await renderSettings();
    const group = screen.getByRole('radiogroup', { name: '界面语言' });
    fireEvent.click(within(group).getByRole('radio', { name: 'EN' }));
    expect(spies.onLanguage).toHaveBeenCalledWith('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(within(screen.getByRole('radiogroup', { name: 'Interface language' })).getByRole('radio', { name: 'EN' }).getAttribute('aria-checked')).toBe('true');
  });

  it('fill language sheet stores the choice', async () => {
    await renderSettings();
    const row = screen.getByRole('button', { name: /^填写时默认用/ });
    expect(row.textContent).toContain('简历页当前选中的那份');
    fireEvent.click(row);
    const sheet = screen.getByRole('dialog', { name: '填写时默认用' });
    expect(within(sheet).getByText('首页显示的就是这份简历。')).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: '简历页当前选中的那份' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(sheet).getByRole('radio', { name: '中文简历' }));
    await waitFor(async () => expect((await store.load())!.fillLanguage).toBe('zh'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^填写时默认用/ }).textContent).toContain('中文简历');
  });

  it('import row starts the import flow', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /^从文件导入/ }));
    expect(spies.onImport).toHaveBeenCalledTimes(1);
  });
});

describe('Settings: export', () => {
  it('export without password hands saveDocument a JSON file the extension can read', async () => {
    const saveDocument = savingDoc();
    await renderSettings({ saveDocument });
    const sheet = openExport();
    expect(within(sheet).getByText('包含 2 份简历和设置。')).toBeTruthy();
    expect(within(sheet).getByText('不含附件文件（简历 PDF、照片、成绩单），换手机后要重新上传。')).toBeTruthy();
    expect(within(sheet).getByText('导出的文件不受 App 保护，放在哪里由你决定。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    const file = saveDocument.mock.calls[0]![0];
    expect(file.mimeType).toBe('application/json');
    expect(file.name).toMatch(/^resume-autofill-profile-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = parseProfileJson(textOf(file.bytes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile).toEqual(await spies.readStoredProfile.mock.results[0]!.value);
    await waitFor(() => expect(toastText()).toContain('已导出'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('export reads the stored profile, not an unsaved on-screen value', async () => {
    const saveDocument = savingDoc();
    const stored = profileOf([{ id: 'r1', title: '已保存的标题' }]);
    await renderSettings({ saveDocument, profile: profileOf([{ id: 'r1', title: '屏幕上还没保存的标题' }]), stored });
    fireEvent.click(within(openExport()).getByRole('button', { name: '导出文件' }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(spies.readStoredProfile).toHaveBeenCalled();
    const text = textOf(saveDocument.mock.calls[0]![0].bytes);
    expect(text).toContain('已保存的标题');
    expect(text).not.toContain('屏幕上还没保存的标题');
  });

  it('nothing is said on cancelled; the sheet stays open', async () => {
    const saveDocument = savingDoc('cancelled');
    await renderSettings({ saveDocument });
    fireEvent.click(within(openExport()).getByRole('button', { name: '导出文件' }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: '导出全部数据' })).getByRole('button', { name: '导出文件' })).toBeTruthy());
    expect(toastText()).toBe('');
  });

  it('export with a short password or a mismatch shows the error and saves nothing', async () => {
    const saveDocument = savingDoc();
    await renderSettings({ saveDocument });
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '用密码加密这个文件' }));
    expect(within(sheet).getByText(/忘了密码就打不开这个文件/)).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'short' } });
    fireEvent.change(within(sheet).getByLabelText('再输一次密码'), { target: { value: 'short' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect(await within(sheet).findByText('密码至少 8 个字符。')).toBeTruthy();
    expect(within(sheet).getByLabelText('密码').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'example-pass-123' } });
    fireEvent.change(within(sheet).getByLabelText('再输一次密码'), { target: { value: 'example-pass-124' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect(await within(sheet).findByText('两次输入的密码不一样。')).toBeTruthy();
    expect(within(sheet).queryByText('密码至少 8 个字符。')).toBeNull();
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('the password field can be shown and hidden', async () => {
    await renderSettings({ saveDocument: savingDoc() });
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '用密码加密这个文件' }));
    const pw = within(sheet).getByLabelText('密码') as HTMLInputElement;
    expect(pw.type).toBe('password');
    expect(pw.autocomplete).toBe('new-password');
    fireEvent.click(within(sheet).getAllByRole('button', { name: '显示密码' })[0]!);
    expect(pw.type).toBe('text');
    fireEvent.click(within(sheet).getByRole('button', { name: '隐藏密码' }));
    expect(pw.type).toBe('password');
  });

  it('export with a password writes an envelope that opens with that password', async () => {
    const saveDocument = savingDoc();
    await renderSettings({ saveDocument });
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '用密码加密这个文件' }));
    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'example-pass-123' } });
    fireEvent.change(within(sheet).getByLabelText('再输一次密码'), { target: { value: 'example-pass-123' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1), { timeout: 20_000 });
    const file = saveDocument.mock.calls[0]![0];
    expect(file.name).toMatch(/-encrypted\.json$/);
    const text = textOf(file.bytes);
    expect(text).not.toContain('中文简历');
    const plain = await decryptExport(text, 'example-pass-123');
    const parsed = parseProfileJson(plain);
    expect(parsed.ok && parsed.profile).toEqual(await spies.readStoredProfile.mock.results[0]!.value);
  }, 30_000);

  it('export is disabled with no resumes', async () => {
    const saveDocument = savingDoc();
    await renderSettings({ saveDocument, profile: profileOf([]) });
    const sheet = openExport();
    expect(within(sheet).getByText('还没有可以导出的简历。')).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: '导出文件' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failing save shows the danger notice', async () => {
    const saveDocument = vi.fn<SaveDocument>(async () => {
      throw new Error('WRITE_FAILED');
    });
    await renderSettings({ saveDocument });
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect(await within(sheet).findByText('没能保存文件，换个位置再试。')).toBeTruthy();
  });
});

describe('Settings: about and privacy', () => {
  it('about shows the name and version from the phone', async () => {
    await renderSettings({ appInfo: async () => ({ name: '网申简历填写', version: '0.1.0', build: '7' }) });
    fireEvent.click(screen.getByRole('button', { name: /^关于这个 App/ }));
    const sheet = screen.getByRole('dialog', { name: '关于这个 App' });
    expect(await within(sheet).findByText('版本 0.1.0（7）')).toBeTruthy();
    expect(within(sheet).getByText('网申简历填写')).toBeTruthy();
    expect(within(sheet).getByText('把简历存在手机里，网申时帮你填好，提交前自己检查。')).toBeTruthy();
  });

  it('about says version unavailable when it cannot be read', async () => {
    await renderSettings({ appInfo: () => Promise.reject(new Error('no')) });
    fireEvent.click(screen.getByRole('button', { name: /^关于这个 App/ }));
    expect(await within(screen.getByRole('dialog')).findByText('版本信息读取失败')).toBeTruthy();
    cleanup();
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /^关于这个 App/ }));
    expect(await within(screen.getByRole('dialog')).findByText('版本信息读取失败')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('网申简历填写')).toBeTruthy();
  });

  it('privacy row opens the privacy page, which has all six sections', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /^隐私说明/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '隐私说明' })).toBeTruthy();
    const zhHeads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());
    expect(zhHeads).toEqual(['资料存在哪里', '不上传', '不替你提交', '填写时交出什么', '导出的文件', '随时删除']);
    setLanguage('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing is uploaded' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  });
});

describe('Settings: site sign-ins', () => {
  it('「清除网站登录状态」 asks first, then clears and says so', async () => {
    const clearSiteData = vi.fn(async () => undefined);
    await renderSettings({ clearSiteData });
    const row = screen.getByRole('button', { name: /^清除网站登录状态/ });
    expect(row.querySelector('svg')?.getAttribute('data-icon')).toBe('trash');
    expect(within(row).getByText('网申网站的登录、cookie 和缓存')).toBeTruthy();
    fireEvent.click(row);
    let sheet = screen.getByRole('dialog', { name: '清除所有网站的登录状态？' });
    expect(within(sheet).getByText('下次打开网申页面需要重新登录，简历和附件不受影响。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(clearSiteData).not.toHaveBeenCalled();
    fireEvent.click(row);
    sheet = screen.getByRole('dialog', { name: '清除所有网站的登录状态？' });
    fireEvent.click(within(sheet).getByRole('button', { name: '清除' }));
    await waitFor(() => expect(toastText()).toContain('已清除网站登录状态'));
    expect(clearSiteData).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('when clearing fails, says so', async () => {
    await renderSettings({ clearSiteData: () => Promise.reject(new Error('no')) });
    fireEvent.click(screen.getByRole('button', { name: /^清除网站登录状态/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清除' }));
    await waitFor(() => expect(toastText()).toContain('没能清除，请再试一次。'));
  });

  it('without the fill browser plugin (browser preview) the row is absent', async () => {
    await renderSettings();
    expect(screen.queryByRole('button', { name: /^清除网站登录状态/ })).toBeNull();
  });

  it('the privacy page says where site sign-ins live and what a page is handed', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /^隐私说明/ }));
    await screen.findByRole('heading', { level: 1, name: '隐私说明' });
    expect(screen.getByText(/App 内浏览器的登录状态、cookie 和网页缓存由系统 WebView 保存/)).toBeTruthy();
    expect(screen.getByText(/只有你点「一键填写」时，App 才会把网页需要的那部分简历交出去/)).toBeTruthy();
    expect(screen.queryByText(/上线后/)).toBeNull();
  });
});

describe('Settings: delete all', () => {
  async function withData(onWipe?: () => Promise<boolean>) {
    const files = createMemoryFileStore();
    await files.put({ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });
    await files.put({ name: 'b.jpg', type: 'image/jpeg', bytes: new Uint8Array([2]) });
    const page = (id: string) => ({ id, url: `https://jobs.example.com/${id}`, host: 'jobs.example.com', addedAt: 1 });
    await renderSettings({
      files,
      onWipe,
      profile: profileOf([
        { id: 'r1', title: '简历一' },
        { id: 'r2', title: '简历二' },
        { id: 'r3', title: '简历三' },
        { id: 'r4', title: '简历四' },
      ]),
      state: { recentPages: [page('p1'), page('p2'), page('p3')] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^删除这台手机上的全部数据/ }));
    return screen.getByRole('dialog', { name: '删除全部数据？' });
  }

  it('the sheet names what will go: resume titles, file count, recent page count, settings', async () => {
    const sheet = await withData();
    expect(within(sheet).getByText('会从这台手机上永久删除：')).toBeTruthy();
    expect(within(sheet).getByText('4 份简历：简历一、简历二、简历三，还有 1 份')).toBeTruthy();
    expect(await within(sheet).findByText('2 个附件文件')).toBeTruthy();
    expect(within(sheet).getByText('3 个最近的网申页面')).toBeTruthy();
    expect(within(sheet).getByText('设置和引导进度')).toBeTruthy();
    expect(within(sheet).getByText('删除后无法恢复。需要留底的话，先导出一份。')).toBeTruthy();
  });

  it('with no resumes it says so', async () => {
    await renderSettings({ profile: profileOf([]) });
    fireEvent.click(screen.getByRole('button', { name: /^删除这台手机上的全部数据/ }));
    expect(within(screen.getByRole('dialog')).getByText('简历：没有')).toBeTruthy();
    expect(await within(screen.getByRole('dialog')).findByText('0 个附件文件')).toBeTruthy();
  });

  it('cancel does nothing; confirm calls onWipe once and shows the busy state', async () => {
    let finish!: (ok: boolean) => void;
    const sheet = await withData(() => new Promise<boolean>((resolve) => (finish = resolve)));
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(spies.onWipe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^删除这台手机上的全部数据/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '永久删除' }));
    const busy = await within(screen.getByRole('dialog')).findByRole('button', { name: '正在删除…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(spies.onWipe).toHaveBeenCalledTimes(1);
    finish(false);
    expect(await within(screen.getByRole('dialog')).findByText('没能删完，请再试一次。')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '永久删除' })).toBeTruthy();
  });

  it('"先导出一份" in the delete sheet opens the export sheet', async () => {
    const sheet = await withData();
    fireEvent.click(within(sheet).getByRole('button', { name: '先导出一份' }));
    expect(screen.getByRole('dialog', { name: '导出全部数据' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '删除全部数据？' })).toBeNull();
  });
});

describe('Settings: edge cases', () => {
  it('a password error is announced and the cursor goes to the field that needs fixing', async () => {
    await renderSettings({ saveDocument: savingDoc() });
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '用密码加密这个文件' }));
    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'short' } });
    fireEvent.change(within(sheet).getByLabelText('再输一次密码'), { target: { value: 'short' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect((await within(sheet).findByRole('alert')).textContent).toContain('密码至少 8 个字符。');
    expect(document.activeElement).toBe(within(sheet).getByLabelText('密码'));
    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'example-pass-123' } });
    fireEvent.change(within(sheet).getByLabelText('再输一次密码'), { target: { value: 'example-pass-124' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect((await within(sheet).findByRole('alert')).textContent).toContain('两次输入的密码不一样。');
    expect(document.activeElement).toBe(within(sheet).getByLabelText('再输一次密码'));
  });

  it('when the stored data cannot be read, export says so instead of blaming the save location', async () => {
    const saveDocument = savingDoc();
    await renderSettings({ saveDocument });
    spies.readStoredProfile.mockRejectedValueOnce(new Error('vault'));
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect(await within(sheet).findByText('没能读出要导出的资料，请再试一次。')).toBeTruthy();
    expect(within(sheet).queryByText('没能保存文件，换个位置再试。')).toBeNull();
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('with no way to save files on this device, export says so', async () => {
    await renderSettings({ saveDocument: undefined });
    const sheet = openExport();
    fireEvent.click(within(sheet).getByRole('button', { name: '导出文件' }));
    expect(await within(sheet).findByText('这台设备上没法保存文件。')).toBeTruthy();
  });

  it('with a profile that cannot be read, delete all says the unreadable data goes too, not 「简历：没有」', async () => {
    await renderSettings({ profile: null, loadError: '解不开' });
    fireEvent.click(screen.getByRole('button', { name: /^删除这台手机上的全部数据/ }));
    const sheet = screen.getByRole('dialog', { name: '删除全部数据？' });
    expect(within(sheet).getByText('简历：读不出来的资料也会一起删掉')).toBeTruthy();
    expect(within(sheet).queryByText('简历：没有')).toBeNull();
  });

  it('in English, one resume reads "1 resume", not "1 resumes"', async () => {
    setLanguage('en');
    await renderSettings({ profile: profileOf([{ id: 'r1', title: 'My resume', locale: 'en-AU' }]), title: 'Settings' });
    fireEvent.click(screen.getByRole('button', { name: /^Export all data/ }));
    const sheet = screen.getByRole('dialog', { name: 'Export all data' });
    expect(within(sheet).getByText('Includes 1 resume and your settings.')).toBeTruthy();
    fireEvent.click(within(sheet).getAllByRole('button', { name: 'Close' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Delete all data on this phone/ }));
    expect(within(screen.getByRole('dialog', { name: 'Delete all data?' })).getByText('1 resume: My resume')).toBeTruthy();
  });
});
