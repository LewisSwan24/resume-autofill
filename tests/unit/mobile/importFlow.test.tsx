// Import from a file (Settings, Home's empty card, onboarding): read, unlock when protected, preview, then merge or
// replace through the profile editor, with undo. Errors explain themselves and change nothing.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useMemo, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useImportFlow } from '../../../mobile/app/src/settings/useImportFlow';
import { decryptExport, encryptExport } from '../../../mobile/app/src/data/exportCrypto';
import { createMemoryFileStore, type FileStore } from '../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../mobile/app/src/store/profileStore';
import { BackStackContext, Toast, createBackStack, type ToastMessage } from '../../../mobile/app/src/ui';
import { useProfileEditor } from '../../../mobile/app/src/useProfileEditor';
import { exportProfile } from '../../../src/editor';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';

const FIXED = 1_700_000_000_000;
function profileOf(resumes: { id: string; title: string; locale?: 'zh-CN' | 'en-AU'; attachments?: Record<string, string>; contact?: Record<string, string> }[]): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes.map((r) => ResumeSchema.parse({ locale: 'zh-CN', createdAt: FIXED, updatedAt: FIXED, ...r })),
    activeResumeId: resumes[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}

function Harness({ store, files, onImported }: { store: ProfileStore; files: FileStore; onImported: () => void }) {
  const editor = useProfileEditor(store, 10);
  const backStack = useMemo(() => createBackStack(), []);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const flow = useImportFlow({
    profile: editor.profile,
    edit: editor.edit,
    loadError: editor.loadError,
    files,
    showToast: (t) => setToast({ ...t, id: Math.random() }),
    onImported,
  });
  return (
    <BackStackContext.Provider value={backStack}>
      <button type="button" onClick={flow.start}>
        开始导入
      </button>
      <p data-testid="titles">{editor.profile ? editor.profile.resumes.map((r) => r.title).join('|') : 'loading'}</p>
      {flow.element}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </BackStackContext.Provider>
  );
}

let store: ProfileStore;
let files: FileStore;
let onImported: Mock<() => void>;

async function renderFlow(onPhone: Profile) {
  store = createMemoryStore(onPhone);
  files = createMemoryFileStore();
  onImported = vi.fn<() => void>();
  render(<Harness store={store} files={files} onImported={onImported} />);
  await waitFor(() => expect(titles()).not.toBe('loading'));
}

const titles = () => screen.getByTestId('titles').textContent;
const toastText = () => screen.getByRole('status').textContent ?? '';
const choose = (content: BlobPart, name = 'profile.json') => {
  fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
  fireEvent.change(screen.getByLabelText('从文件导入'), { target: { files: [new File([content], name, { type: 'application/json' })] } });
};
const dialog = (name: string) => screen.findByRole('dialog', { name });
const storedTitles = async () => (await store.load()).resumes.map((r) => r.title).join('|');

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('import flow', () => {
  it('a plain file previews its resumes, and replace swaps them in; undo puts the old ones back', async () => {
    await renderFlow(profileOf([{ id: 'r1', title: '旧简历' }]));
    const input = screen.getByLabelText('从文件导入') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('application/json');
    choose(exportProfile(profileOf([{ id: 'r9', title: '新简历', contact: { email: 'zhangsan@example.com' } }])));
    const sheet = await dialog('文件里有什么');
    expect(within(sheet).getByText('1 份简历')).toBeTruthy();
    expect(within(sheet).getByText('新简历')).toBeTruthy();
    expect(within(sheet).getByText('已填 1 个模块')).toBeTruthy();
    expect(within(sheet).getByText('替换会删掉手机上现有的 1 份简历和设置。')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: '合并：加到现有简历里' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '替换：用文件里的简历换掉现有的' }));
    await waitFor(() => expect(titles()).toBe('新简历'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toastText()).toContain('已导入 1 份简历');
    await waitFor(async () => expect(await storedTitles()).toBe('新简历'));
    expect(onImported).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(titles()).toBe('旧简历'));
    await waitFor(async () => expect(await storedTitles()).toBe('旧简历'));
  });

  it('merge adds the file\'s resumes and reports added and skipped', async () => {
    const phone = profileOf([{ id: 'r1', title: '简历一' }, { id: 'r2', title: '简历二' }]);
    await renderFlow(phone);
    const file = profileOf([
      { id: 'r1', title: '简历一' },
      { id: 'r2', title: '简历二', contact: { phone: '13800000000' } },
      { id: 'r3', title: 'English', locale: 'en-AU' },
    ]);
    choose(exportProfile(file));
    const sheet = await dialog('文件里有什么');
    expect(within(sheet).getByText('3 份简历')).toBeTruthy();
    expect(within(sheet).getByText('有 1 份和手机上的同一份简历内容不同，合并时会另存为副本。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '合并：加到现有简历里' }));
    await waitFor(() => expect(titles()).toBe('简历一|简历二|简历二（导入）|English'));
    expect(toastText()).toContain('已加入 2 份简历，1 份已有');
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('with no resumes on the phone there is a single 导入 button', async () => {
    await renderFlow(profileOf([]));
    choose(exportProfile(profileOf([{ id: 'r1', title: '张三的简历' }])));
    const sheet = await dialog('文件里有什么');
    expect(within(sheet).queryByRole('button', { name: /合并/ })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /替换/ })).toBeNull();
    expect(within(sheet).queryByText(/替换会删掉/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '导入' }));
    await waitFor(() => expect(titles()).toBe('张三的简历'));
    expect(toastText()).toContain('已导入 1 份简历');
  });

  it('a password-protected file asks for the password; a wrong one says so and lets you retry; the right one shows the preview', async () => {
    await renderFlow(profileOf([]));
    const envelope = await encryptExport(exportProfile(profileOf([{ id: 'r1', title: '加密的简历' }])), 'example-pass-123', { iterations: 100_000 });
    choose(envelope);
    const sheet = await dialog('这个文件有密码');
    expect(within(sheet).getByText('输入导出时设的密码。')).toBeTruthy();
    const pw = within(sheet).getByLabelText('密码') as HTMLInputElement;
    expect(pw.autocomplete).toBe('current-password');
    fireEvent.change(pw, { target: { value: 'wrong-password' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '解锁' }));
    expect(await within(sheet).findByText('密码不对，或者文件已损坏。', {}, { timeout: 10_000 })).toBeTruthy();
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('密码'), { target: { value: 'example-pass-123' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '解锁' }));
    const preview = await screen.findByRole('dialog', { name: '文件里有什么' }, { timeout: 10_000 });
    expect(within(preview).getByText('加密的简历')).toBeTruthy();
  }, 30_000);

  it('not JSON / not a profile / over 5 MB / unreadable: each says why and changes nothing', async () => {
    await renderFlow(profileOf([{ id: 'r1', title: '原来的简历' }]));
    const cases: [BlobPart, string][] = [
      ['这不是 JSON', '这不是本 App 或扩展导出的文件。'],
      ['{"resumes": 3}', '文件里的简历格式不对，可能来自更新的版本，或者已经损坏。'],
      [new Uint8Array(5 * 1024 * 1024 + 1), '文件太大了（超过 5 MB），不像是导出的简历文件。'],
      [new Uint8Array([0xff, 0xfe, 0xfd, 0x80]), '读不了这个文件。'],
    ];
    for (const [content, message] of cases) {
      choose(content);
      const sheet = await dialog('没能导入');
      expect(within(sheet).getByText(message)).toBeTruthy();
      fireEvent.click(within(sheet).getAllByRole('button', { name: '关闭' }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(titles()).toBe('原来的简历');
    expect(await storedTitles()).toBe('原来的简历');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('a file without resumes offers nothing to import', async () => {
    await renderFlow(profileOf([{ id: 'r1', title: '原来的简历' }]));
    choose(exportProfile(profileOf([])));
    const sheet = await dialog('文件里有什么');
    expect(within(sheet).getByText('文件里没有简历，没有可以导入的内容。')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /导入|合并|替换/ })).toBeNull();
  });

  it('always says attachments are not in the file, and counts attachments to re-upload', async () => {
    await renderFlow(profileOf([]));
    choose(exportProfile(profileOf([{ id: 'r1', title: '带附件的简历', attachments: { resumeFileId: 'f1', photoFileId: 'f2' } }])));
    const sheet = await dialog('文件里有什么');
    expect(within(sheet).getByText('文件里不含附件文件。')).toBeTruthy();
    expect(within(sheet).getByText('有 2 个附件要在导入后重新上传。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '导入' }));
    await waitFor(() => expect(titles()).toBe('带附件的简历'));
    // Ids of files that are not on this phone are dropped.
    await waitFor(async () => expect((await store.load()).resumes[0]!.attachments).toEqual({}));
  });

  it('onImported is not called after cancel', async () => {
    await renderFlow(profileOf([]));
    choose(exportProfile(profileOf([{ id: 'r1', title: '张三的简历' }])));
    const sheet = await dialog('文件里有什么');
    fireEvent.click(within(sheet).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onImported).not.toHaveBeenCalled();
    expect(titles()).toBe('');
  });

  it('closing the password sheet while decrypting discards the result', async () => {
    await renderFlow(profileOf([]));
    const plain = exportProfile(profileOf([{ id: 'r1', title: '加密的简历' }]));
    const envelope = await encryptExport(plain, 'example-pass-123', { iterations: 300_000 });
    choose(envelope);
    const sheet = await dialog('这个文件有密码');
    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'example-pass-123' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '解锁' }));
    expect(await within(sheet).findByRole('button', { name: '正在解密…' })).toBeTruthy();
    fireEvent.click(within(sheet).getAllByRole('button', { name: '关闭' })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // A decryption started after the flow's has finished: the flow's has too.
    await decryptExport(envelope, 'example-pass-123');
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(titles()).toBe('');
    expect(onImported).not.toHaveBeenCalled();
  }, 30_000);

  it('a wrong password is announced and the cursor goes back into the password box', async () => {
    await renderFlow(profileOf([]));
    const envelope = await encryptExport(exportProfile(profileOf([{ id: 'r1', title: '加密的简历' }])), 'example-pass-123', { iterations: 100_000 });
    choose(envelope);
    const sheet = await dialog('这个文件有密码');
    fireEvent.change(within(sheet).getByLabelText('密码'), { target: { value: 'wrong-password' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '解锁' }));
    const alert = await within(sheet).findByRole('alert', {}, { timeout: 10_000 });
    expect(alert.textContent).toContain('密码不对，或者文件已损坏。');
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByLabelText('密码')));
  }, 30_000);
});

describe('import flow when the profile on the phone cannot be read', () => {
  async function renderUnreadable() {
    const inner = createMemoryStore(profileOf([]));
    store = { load: () => Promise.reject(new Error('解不开')), save: (p) => inner.save(p) };
    files = createMemoryFileStore();
    onImported = vi.fn<() => void>();
    render(<Harness store={store} files={files} onImported={onImported} />);
    await act(() => new Promise((r) => setTimeout(r, 30)));
  }

  it('starting an import says it cannot be stored and to delete all data first; no file picker', async () => {
    await renderUnreadable();
    const input = screen.getByLabelText('从文件导入') as HTMLInputElement;
    const picker = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
    const sheet = await dialog('现在不能导入');
    expect(within(sheet).getByText('手机上的资料读不出来，导入的简历没法存进去。先在「设置」里删除这台手机上的全部数据，再导入。')).toBeTruthy();
    expect(picker).not.toHaveBeenCalled();
  });

  it('a file that still reaches the preview is not reported as imported', async () => {
    await renderUnreadable();
    fireEvent.change(screen.getByLabelText('从文件导入'), {
      target: { files: [new File([exportProfile(profileOf([{ id: 'r1', title: '张三的简历' }]))], 'p.json', { type: 'application/json' })] },
    });
    const sheet = await dialog('文件里有什么');
    fireEvent.click(within(sheet).getByRole('button', { name: '导入' }));
    expect(await dialog('现在不能导入')).toBeTruthy();
    expect(screen.queryByText(/已导入/)).toBeNull();
    expect(onImported).not.toHaveBeenCalled();
  });
});
