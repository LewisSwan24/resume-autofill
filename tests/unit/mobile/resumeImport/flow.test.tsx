// The resume import from an in-app entry point, through the whole App with memory stores and a fake reader:
// picker, progress, explanation or review, then a new resume or a merge, with undo. Nothing is stored before 导入.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../../mobile/app/src/App';
import { mt } from '../../../../mobile/app/src/i18n';
import type { IncomingEvent, IncomingFileSource } from '../../../../mobile/app/src/resumeImport/incoming';
import type { ImportFailure, ImportFile, ReadOptions, ReadOutcome, ReadSuccess, ResumeReader } from '../../../../mobile/app/src/resumeImport/types';
import { createMemoryAppStateStore, type AppStateStore } from '../../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore, type FileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../../mobile/app/src/store/wipe';
import { setLanguage } from '../../../../src/i18n';
import type { DraftField } from '../../../../src/import/parse';
import { ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../../src/schema';

const WAIT = { timeout: 4000 };
const PICK = '选择简历文件（PDF 或 Word）';

const TEXTS = ['张三', '电话：13800138000', '邮箱：zhangsan@example.com', '教育经历', '示例大学 2016.09 - 2020.06'];
const field = (path: string, value: string, line: number, certainty: DraftField['certainty'] = 'high'): DraftField => ({ path, value, line, certainty });
function success(): ReadSuccess {
  return {
    ok: true,
    kind: 'pdf',
    lines: TEXTS.map((text) => ({ text, cells: [text], page: 1, fontSize: 10 })),
    draft: {
      locale: 'zh-CN',
      fields: [
        field('basics.familyName', '张', 0),
        field('basics.givenName', '三', 0),
        field('contact.phone', '13800138000', 1),
        field('contact.email', 'zhangsan@example.com', 2, 'check'),
        field('education.0.school', '示例大学', 4),
      ],
    },
    pages: 1,
    language: { locale: 'zh-CN', mixed: false },
  };
}

interface Call {
  file: ImportFile;
  options?: ReadOptions;
  resolve: (outcome: ReadOutcome) => void;
}
function fakeReader() {
  const calls: Call[] = [];
  const reader: ResumeReader = (file, options) => new Promise((resolve) => calls.push({ file, options, resolve }));
  return { reader, calls, last: () => calls[calls.length - 1]! };
}

function fakePlatform(incoming?: IncomingFileSource) {
  let back: (() => boolean) | null = null;
  const platform: Platform = {
    onBack(handler) {
      back = handler;
      return () => {
        back = null;
      };
    },
    onPause: () => () => {},
    incoming,
  };
  return { platform, pressBack: () => act(() => void back!()) };
}

function profileOf(resumes: Array<Partial<Resume> & { id: string; title: string }>): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes.map((r) => ResumeSchema.parse({ locale: 'zh-CN', createdAt: 1, updatedAt: 1, ...r })),
    activeResumeId: resumes[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}
const OLD = { id: 'r1', title: '旧简历', basics: { familyName: '李' } } as unknown as Resume;

let store: ProfileStore;
let files: FileStore;
let appState: AppStateStore;
let read: ReturnType<typeof fakeReader>;
let device: ReturnType<typeof fakePlatform>;

async function renderApp({ profile = profileOf([]), onboardingDone = true, profileStore }: { profile?: Profile; onboardingDone?: boolean; profileStore?: ProfileStore } = {}) {
  store = profileStore ?? createMemoryStore(profile);
  files = createMemoryFileStore();
  appState = createMemoryAppStateStore({ version: 1, onboardingDone });
  read = fakeReader();
  device = fakePlatform();
  const wiper = createStoreWiper({ profile: store, files, appState });
  render(<App store={store} files={files} appState={appState} wiper={wiper} platform={device.platform} autosaveDelayMs={10} sweepDelayMs={30} resumeReader={read.reader} />);
}

/** Home's no-resume card (the default screen with an empty profile). */
async function pickFromHome(name = '张三简历.pdf') {
  fireEvent.click(await screen.findByRole('button', { name: '从 PDF / Word 导入' }, WAIT));
  choose(name);
}
/** The resume switcher's sheet on the 简历 tab. */
async function pickFromSwitcher(name = '张三简历.pdf') {
  fireEvent.click(await screen.findByRole('button', { name: '简历' }, WAIT));
  fireEvent.click(await screen.findByRole('button', { name: /^正在编辑/ }, WAIT));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '我的简历' })).getByRole('button', { name: '从 PDF / Word 导入' }));
  choose(name);
}
function choose(name: string) {
  const type = name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  fireEvent.change(screen.getByLabelText(PICK), { target: { files: [new File([new Uint8Array([37, 80, 68, 70, 45])], name, { type })] } });
}

const readerCalled = (n = 1) => waitFor(() => expect(read.calls).toHaveLength(n), WAIT);
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name }, WAIT);
const resolveWith = async (outcome: ReadOutcome) => {
  await act(async () => read.last().resolve(outcome));
};
async function toReview() {
  await readerCalled();
  await resolveWith(success());
  return h1('核对导入的内容');
}
const stored = () => store.load();

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('resume import flow', () => {
  it('picking a file shows reading, then recognising, then the review', async () => {
    await renderApp();
    await pickFromHome();
    await readerCalled();
    expect(read.last().file).toMatchObject({ name: '张三简历.pdf', mimeType: 'application/pdf', source: 'picker' });
    expect([...read.last().file.bytes]).toEqual([37, 80, 68, 70, 45]);
    const overlay = await screen.findByRole('dialog', { name: '正在读取简历' });
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(within(overlay).getByRole('status').textContent).toContain('读取文件里的文字');
    expect(within(overlay).getByText('全程在这台手机上完成，文件不会上传。')).toBeTruthy();
    expect(document.querySelector('main')!.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('navigation')).toBeNull();
    act(() => read.last().options!.onPhase!('recognising'));
    expect(within(overlay).getByRole('status').textContent).toContain('识别各项内容');
    await resolveWith(success());
    expect(await screen.findByRole('dialog', { name: '核对导入的内容' })).toBeTruthy();
  });

  it('导入 creates the resume, lands on 简历 with it active, and offers 撤销', async () => {
    await renderApp();
    await pickFromHome();
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: '导入 5 项' }));
    await h1('简历资料');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('main')!.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: /^正在编辑/ }).textContent).toContain('张三简历');
    expect(screen.getByText('已导入为「张三简历」')).toBeTruthy();
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    await waitFor(async () => {
      const p = await stored();
      const r = p.resumes.find((x) => x.id === p.activeResumeId)!;
      expect(r.title).toBe('张三简历');
      expect(r.basics.familyName).toBe('张');
      expect(r.contact.email).toBe('zhangsan@example.com');
    }, WAIT);
  });

  it('撤销 removes the imported resume and makes the old one active', async () => {
    await renderApp({ profile: profileOf([OLD]) });
    await pickFromSwitcher();
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: '导入 5 项' }));
    await waitFor(async () => expect((await stored()).resumes).toHaveLength(2), WAIT);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(async () => {
      const p = await stored();
      expect(p.resumes.map((r) => r.id)).toEqual(['r1']);
      expect(p.activeResumeId).toBe('r1');
    }, WAIT);
    expect(await screen.findByText('已撤销导入')).toBeTruthy();
  });

  it('取消 on the progress screen aborts the read and stores nothing', async () => {
    await renderApp();
    const save = vi.spyOn(store, 'save');
    const put = vi.spyOn(files, 'put');
    await pickFromHome();
    await readerCalled();
    const signal = read.last().options!.signal!;
    expect(signal.aborted).toBe(false);
    fireEvent.click(within(await screen.findByRole('dialog', { name: '正在读取简历' })).getByRole('button', { name: '取消' }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('已取消导入')).toBeTruthy();
    await resolveWith(success()); // too late: ignored
    expect(screen.queryByRole('heading', { name: '核对导入的内容' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('each failure shows its title and body; 换一个文件 opens the picker; 关闭 goes back', async () => {
    await renderApp();
    const reasons: ImportFailure[] = ['too_large', 'wrong_type', 'old_word', 'empty', 'encrypted', 'no_text', 'nothing_found', 'unreadable', 'failed'];
    let n = 0;
    for (const reason of reasons) {
      await pickFromHome();
      await readerCalled(++n);
      await resolveWith({ ok: false, reason });
      const title = mt('zh', `m.ri.fail.title.${reason}`);
      const dialog = await screen.findByRole('dialog', { name: title });
      expect(within(dialog).getByText(mt('zh', `m.ri.fail.body.${reason}`))).toBeTruthy();
      expect(within(dialog).getByText('张三简历.pdf')).toBeTruthy();
      const blank = within(dialog).queryByRole('button', { name: '新建空白简历' });
      expect([reason, blank !== null]).toEqual([reason, ['no_text', 'encrypted', 'nothing_found'].includes(reason)]);
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    await pickFromHome();
    await readerCalled(++n);
    await resolveWith({ ok: false, reason: 'no_text' });
    const dialog = await screen.findByRole('dialog', { name: '这份 PDF 是扫描件' });
    expect(within(dialog).getByText(/App 暂时不能从图片里识别文字（OCR）/)).toBeTruthy();
    const click = vi.spyOn(screen.getByLabelText(PICK) as HTMLInputElement, 'click');
    fireEvent.click(within(dialog).getByRole('button', { name: '换一个文件' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('新建空白简历 on a scan starts a blank resume in the detected language', async () => {
    await renderApp();
    await pickFromHome();
    await readerCalled();
    await resolveWith({ ok: false, reason: 'no_text' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: '这份 PDF 是扫描件' })).getByRole('button', { name: '新建空白简历' }));
    await h1('简历资料');
    await waitFor(async () => {
      const p = await stored();
      expect(p.resumes).toHaveLength(1);
      expect(p.resumes[0]!.locale).toBe('zh-CN');
      expect(p.resumes[0]!.title).toBe('我的中文简历');
    }, WAIT);
  });

  it('新建空白简历 after nothing_found starts the blank resume in the language the file was written in', async () => {
    await renderApp();
    await pickFromHome();
    await readerCalled();
    await resolveWith({ ok: false, reason: 'nothing_found', locale: 'en-AU' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: '没认出简历内容' })).getByRole('button', { name: '新建空白简历' }));
    await h1('简历资料');
    await waitFor(async () => {
      const p = await stored();
      expect(p.resumes).toHaveLength(1);
      expect(p.resumes[0]!.locale).toBe('en-AU');
      expect(p.resumes[0]!.title).toBe(mt('zh', 'm.defaultTitle.en'));
    }, WAIT);
  });

  it('a PDF with no name is kept as an attachment named in the interface language', async () => {
    const base = profileOf([]);
    await renderApp({ profile: { ...base, settings: { ...base.settings, uiLanguage: 'en' } } });
    fireEvent.click(await screen.findByRole('button', { name: mt('en', 'm.ri.entry') }, WAIT));
    fireEvent.change(screen.getByLabelText(mt('en', 'm.ri.pickLabel')), {
      target: { files: [new File([new Uint8Array([37, 80, 68, 70, 45])], '', { type: 'application/pdf' })] },
    });
    await readerCalled();
    await resolveWith(success());
    fireEvent.click(await screen.findByRole('button', { name: mt('en', 'm.ri.import', { n: 5 }) }, WAIT));
    let fileId = '';
    await waitFor(async () => {
      fileId = (await stored()).resumes[0]?.attachments.resumeFileId ?? '';
      expect(fileId).not.toBe('');
    }, WAIT);
    expect((await files.info(fileId))?.name).toBe('Resume.pdf');
  });

  it('back key: progress cancels, clean review closes, dirty review asks first', async () => {
    await renderApp();
    await pickFromHome();
    await readerCalled(1);
    const signal = read.last().options!.signal!;
    device.pressBack();
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    await pickFromHome();
    await readerCalled(2);
    await resolveWith(success());
    await h1('核对导入的内容');
    device.pressBack();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await h1('首页')).toBeTruthy();

    await pickFromHome();
    await readerCalled(3);
    await resolveWith(success());
    await h1('核对导入的内容');
    fireEvent.change(screen.getByLabelText('名'), { target: { value: '三丰' } });
    device.pressBack();
    const ask = await screen.findByRole('dialog', { name: '不导入了吗？' });
    expect(within(ask).getByText('你在这里做的修改不会保存。')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: '继续核对' }));
    expect(screen.queryByRole('dialog', { name: '不导入了吗？' })).toBeNull();
    expect((screen.getByLabelText('名') as HTMLInputElement).value).toBe('三丰');
    device.pressBack();
    fireEvent.click(within(await screen.findByRole('dialog', { name: '不导入了吗？' })).getByRole('button', { name: '不导入' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await stored()).resumes).toHaveLength(0);
  });

  it('nothing reaches the profile store or the file store before 导入', async () => {
    await renderApp();
    const save = vi.spyOn(store, 'save');
    const put = vi.spyOn(files, 'put');
    await pickFromHome();
    await toReview();
    fireEvent.change(screen.getByLabelText('名'), { target: { value: '三丰' } });
    fireEvent.click(screen.getByRole('switch', { name: '导入：邮箱' }));
    await new Promise((r) => setTimeout(r, 60));
    expect(save).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导入 4 项' }));
    await waitFor(() => expect(save).toHaveBeenCalled(), WAIT);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('a PDF imported as a new resume is stored as its attachment and held from the sweep', async () => {
    await renderApp();
    await pickFromHome();
    await toReview();
    const attach = screen.getByRole('checkbox', { name: '同时把这份 PDF 存为简历附件' }) as HTMLInputElement;
    expect(attach.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '导入 5 项' }));
    let fileId = '';
    await waitFor(async () => {
      const p = await stored();
      fileId = p.resumes[0]?.attachments.resumeFileId ?? '';
      expect(fileId).not.toBe('');
    }, WAIT);
    const info = await files.info(fileId);
    expect(info).toMatchObject({ name: '张三简历.pdf', type: 'application/pdf' });
    await new Promise((r) => setTimeout(r, 120)); // past a sweep
    expect(await files.info(fileId)).not.toBeNull();
  });

  it('merge shows 合并前看一下 with the counts; 确认合并 applies, 返回修改 goes back', async () => {
    // A blank active resume: the review defaults to merging into it.
    await renderApp({ profile: profileOf([{ id: 'r1', title: '我的简历' }]) });
    await pickFromSwitcher();
    await toReview();
    expect(screen.getByRole('radio', { name: /合并到「我的简历」/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^合并 \d+ 项$/ }));
    let sheet = await screen.findByRole('dialog', { name: '合并前看一下' });
    expect(within(sheet).getByText(/^填入空着的 \d+ 项$/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '返回修改' }));
    expect(screen.queryByRole('dialog', { name: '合并前看一下' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '核对导入的内容' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^合并 \d+ 项$/ }));
    sheet = await screen.findByRole('dialog', { name: '合并前看一下' });
    fireEvent.click(within(sheet).getByRole('button', { name: '确认合并' }));
    await h1('简历资料');
    expect(screen.getByText('已合并到「我的简历」')).toBeTruthy();
    await waitFor(async () => {
      const p = await stored();
      expect(p.resumes).toHaveLength(1);
      expect(p.resumes[0]!.basics.familyName).toBe('张');
    }, WAIT);
  });

  it('a profile that cannot be read shows the blocked sheet', async () => {
    const broken: ProfileStore = { load: () => Promise.reject(new Error('bad data')), save: (p) => Promise.resolve(p) };
    let handler: ((event: IncomingEvent) => void) | null = null;
    const incoming: IncomingFileSource = {
      subscribe(h) {
        handler = h;
        return () => {
          handler = null;
        };
      },
    };
    store = broken;
    files = createMemoryFileStore();
    appState = createMemoryAppStateStore({ version: 1, onboardingDone: true });
    read = fakeReader();
    device = fakePlatform(incoming);
    render(<App store={store} files={files} appState={appState} wiper={createStoreWiper({ profile: store, files, appState })} platform={device.platform} resumeReader={read.reader} />);
    await waitFor(() => expect(handler).not.toBeNull(), WAIT);
    const file: ImportFile = { name: '张三简历.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]), source: 'view' };
    act(() => handler!({ kind: 'file', file }));
    expect(await screen.findByRole('dialog', { name: '现在不能导入' })).toBeTruthy();
    expect(read.calls).toHaveLength(0);
  });

  it('the heading of each step gets the focus', async () => {
    await renderApp();
    await pickFromHome();
    await readerCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: '正在读取简历' })));
    await resolveWith({ ok: false, reason: 'encrypted' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: '这份 PDF 设了密码' })));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await pickFromHome();
    await readerCalled(2);
    await resolveWith(success());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: '核对导入的内容' })));
  });

  it('importing during onboarding finishes onboarding and opens the new resume', async () => {
    await renderApp({ onboardingDone: false });
    fireEvent.click(await screen.findByRole('button', { name: '继续' }, WAIT));
    fireEvent.click(screen.getByRole('button', { name: /^导入 PDF \/ Word 简历/ }));
    choose('张三简历.pdf');
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: '导入 5 项' }));
    await h1('简历资料');
    expect(screen.getByRole('navigation')).toBeTruthy();
    await waitFor(async () => expect((await appState.load())?.onboardingDone).toBe(true), WAIT);
    await waitFor(async () => expect((await stored()).resumes[0]?.title).toBe('张三简历'), WAIT);
  });
});
