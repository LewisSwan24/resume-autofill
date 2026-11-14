// Mobile app attachments page (附件): resume PDF, photo and transcript chosen from the phone, checked, stored, replaced
// and deleted with undo; files no resume points at any more are cleared from the phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../../mobile/app/src/App';
import { createMemoryFileStore, type FileStore } from '../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../mobile/app/src/store/profileStore';
import { setLanguage, translate } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../src/schema';

const WAIT = { timeout: 4000 };
const SWEEP = 30;
const zh = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
const RESUME = zh('options.attach.resume');
const PHOTO = zh('options.attach.photo');
const TRANSCRIPT = zh('options.attach.transcript');

function makeProfile(resumes: { id: string; title: string; attachments?: Resume['attachments'] }[] = [{ id: 'r1', title: '我的简历' }]): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes.map((r) => ResumeSchema.parse({ locale: 'zh-CN', ...r })),
    activeResumeId: resumes[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}

let store: ProfileStore;
let files: FileStore;

async function renderApp(profile: Profile = makeProfile(), fileStore: FileStore = createMemoryFileStore()) {
  store = createMemoryStore(profile);
  files = fileStore;
  render(<App store={store} files={files} autosaveDelayMs={20} sweepDelayMs={SWEEP} />);
  await screen.findByRole('heading', { level: 1, name: '简历资料' });
}

const saved = async (): Promise<Resume> => {
  const p = await store.load();
  return p.resumes.find((r) => r.id === p.activeResumeId)!;
};
const until = (check: (r: Resume) => void) => waitFor(async () => check(await saved()), WAIT);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pdf = (name = 'cv.pdf', size = 2048) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });
const png = (name = 'face.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

function openAttachments() {
  fireEvent.click(screen.getByRole('button', { name: /^附件/ }));
  expect(screen.getByRole('heading', { level: 1, name: '附件' })).toBeTruthy();
}
const choose = (input: HTMLElement, file: File) => fireEvent.change(input, { target: { files: [file] } });
const slot = (label: string) => screen.getByRole('group', { name: label });
const chooseFor = (label: string, file: File) => choose(within(slot(label)).getByLabelText(`${label} – 选择文件`), file);
const openMenu = (label: string) => fireEvent.click(screen.getByRole('button', { name: `更多操作：${label}` }));

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLanguage('en');
});

describe('Attachments page', () => {
  it('has a slot each for the resume PDF, the photo and the transcript, with their limits', async () => {
    await renderApp();
    openAttachments();
    for (const label of [RESUME, PHOTO, TRANSCRIPT]) expect(slot(label)).toBeTruthy();
    expect(within(slot(RESUME)).getByText(zh('options.attach.help', { types: 'PDF', max: 10 }))).toBeTruthy();
    expect(within(slot(PHOTO)).getByText(zh('options.attach.help', { types: '图片', max: 10 }))).toBeTruthy();
    expect(within(slot(TRANSCRIPT)).getByText(zh('options.attach.help', { types: 'PDF 或图片', max: 10 }))).toBeTruthy();
  });

  it('stores a chosen PDF, saves its id with the resume, and shows its name and size', async () => {
    await renderApp();
    openAttachments();
    chooseFor(RESUME, pdf());
    await until((r) => expect(r.attachments.resumeFileId).toBeTruthy());
    const id = (await saved()).attachments.resumeFileId!;
    expect(await files.info(id)).toMatchObject({ name: 'cv.pdf', type: 'application/pdf', size: 2048 });
    const shown = await within(slot(RESUME)).findByText('cv.pdf');
    expect(shown).toBeTruthy();
    expect(slot(RESUME).textContent).toContain('2 KB');
  });

  it('refuses a file of the wrong type and stores nothing', async () => {
    await renderApp();
    openAttachments();
    chooseFor(RESUME, png());
    expect(await within(slot(RESUME)).findByText(zh('options.attach.wrongType', { types: 'PDF', max: 10 }))).toBeTruthy();
    await pause(80);
    expect(await files.list()).toEqual([]);
    expect((await saved()).attachments.resumeFileId).toBeUndefined();
  });

  it('refuses a file over 10 MB and stores nothing', async () => {
    await renderApp();
    openAttachments();
    chooseFor(TRANSCRIPT, pdf('big.pdf', 10 * 1024 * 1024 + 1));
    expect(await within(slot(TRANSCRIPT)).findByText(zh('options.attach.tooLarge', { max: 10 }))).toBeTruthy();
    await pause(80);
    expect(await files.list()).toEqual([]);
  });

  it('shows a thumbnail of the photo', async () => {
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => 'blob:thumb', revokeObjectURL: () => undefined }));
    await renderApp();
    openAttachments();
    chooseFor(PHOTO, png());
    const img = await within(slot(PHOTO)).findByRole('img', { name: 'face.png' });
    expect(img.getAttribute('src')).toBe('blob:thumb');
  });

  it('replaces a file from the ⋯ menu, and the old one is cleared from the phone', async () => {
    await renderApp();
    openAttachments();
    chooseFor(RESUME, pdf('old.pdf'));
    await until((r) => expect(r.attachments.resumeFileId).toBeTruthy());
    const oldId = (await saved()).attachments.resumeFileId!;
    await within(slot(RESUME)).findByText('old.pdf');
    openMenu(RESUME);
    choose(within(screen.getByRole('dialog', { name: RESUME })).getByLabelText('换一个文件'), pdf('new.pdf'));
    await until((r) => expect(r.attachments.resumeFileId).not.toBe(oldId));
    const newId = (await saved()).attachments.resumeFileId!;
    expect(await within(slot(RESUME)).findByText('new.pdf')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(async () => expect(await files.list()).toEqual([newId]), WAIT);
  });

  it('deletes a file with undo; undo brings it back and keeps it on the phone', async () => {
    await renderApp();
    openAttachments();
    chooseFor(RESUME, pdf('cv.pdf'));
    await until((r) => expect(r.attachments.resumeFileId).toBeTruthy());
    const id = (await saved()).attachments.resumeFileId!;
    await within(slot(RESUME)).findByText('cv.pdf');
    openMenu(RESUME);
    fireEvent.click(within(screen.getByRole('dialog', { name: RESUME })).getByRole('button', { name: '删除' }));
    await until((r) => expect(r.attachments.resumeFileId).toBeUndefined());
    expect(within(slot(RESUME)).getByLabelText(`${RESUME} – 选择文件`)).toBeTruthy();
    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain('已删除「cv.pdf」');
    fireEvent.click(within(toast).getByRole('button', { name: '撤销' }));
    await until((r) => expect(r.attachments.resumeFileId).toBe(id));
    await pause(SWEEP * 4);
    expect(await files.list()).toEqual([id]);
    expect(within(slot(RESUME)).getByText('cv.pdf')).toBeTruthy();
  });

  it('a deleted file without undo is cleared from the phone', async () => {
    await renderApp();
    openAttachments();
    chooseFor(PHOTO, png());
    await until((r) => expect(r.attachments.photoFileId).toBeTruthy());
    await within(slot(PHOTO)).findByText('face.png');
    openMenu(PHOTO);
    fireEvent.click(within(screen.getByRole('dialog', { name: PHOTO })).getByRole('button', { name: '删除' }));
    await waitFor(async () => expect(await files.list()).toEqual([]), WAIT);
  });

  it('says so when a saved id has no file, and lets the person clear it', async () => {
    await renderApp(makeProfile([{ id: 'r1', title: '我的简历', attachments: { transcriptFileId: 'gone' } }]));
    openAttachments();
    expect(await within(slot(TRANSCRIPT)).findByText(zh('options.attach.missing', { id: 'gone' }))).toBeTruthy();
    openMenu(TRANSCRIPT);
    fireEvent.click(within(screen.getByRole('dialog', { name: TRANSCRIPT })).getByRole('button', { name: '删除' }));
    await until((r) => expect(r.attachments.transcriptFileId).toBeUndefined());
  });

  it('says where the files are kept', async () => {
    await renderApp();
    openAttachments();
    expect(screen.getByText('文件加密保存在这台手机上，只在你填写表单时使用。')).toBeTruthy();
  });
});

describe('Attachment files on the phone', () => {
  it('on start, clears files that no resume points at', async () => {
    const fileStore = createMemoryFileStore();
    const kept = await fileStore.put({ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });
    await fileStore.put({ name: 'orphan.pdf', type: 'application/pdf', bytes: new Uint8Array([2]) });
    await renderApp(makeProfile([{ id: 'r1', title: '我的简历', attachments: { resumeFileId: kept.id } }]), fileStore);
    await waitFor(async () => expect(await fileStore.list()).toEqual([kept.id]), WAIT);
  });

  it('a sweep started by one delete keeps a file deleted later whose undo is still on screen', async () => {
    const fileStore = createMemoryFileStore();
    const photo = await fileStore.put({ name: 'face.png', type: 'image/png', bytes: new Uint8Array([1]) });
    const transcript = await fileStore.put({ name: 'grades.pdf', type: 'application/pdf', bytes: new Uint8Array([2]) });
    await renderApp(makeProfile([{ id: 'r1', title: '我的简历', attachments: { photoFileId: photo.id, transcriptFileId: transcript.id } }]), fileStore);
    openAttachments();
    await within(slot(TRANSCRIPT)).findByText('grades.pdf');
    openMenu(PHOTO);
    fireEvent.click(within(screen.getByRole('dialog', { name: PHOTO })).getByRole('button', { name: '删除' }));
    await pause(SWEEP * 0.6);
    openMenu(TRANSCRIPT);
    fireEvent.click(within(screen.getByRole('dialog', { name: TRANSCRIPT })).getByRole('button', { name: '删除' }));
    await pause(SWEEP * 0.8); // the photo's sweep has run; the transcript's undo window is still open
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '撤销' }));
    await until((r) => expect(r.attachments.transcriptFileId).toBe(transcript.id));
    await pause(SWEEP * 4);
    expect(await fileStore.list()).toEqual([transcript.id]);
  });

  it('a file stored while a sweep is listing files is not swept', async () => {
    const inner = createMemoryFileStore();
    let release: () => void = () => undefined;
    let stalled = false;
    // A store whose list() waits until the test lets it go, so an upload can finish in between.
    const fileStore: FileStore = {
      ...inner,
      list: async () => {
        if (!stalled) {
          stalled = true;
          await new Promise<void>((r) => (release = r));
        }
        return inner.list();
      },
    };
    await renderApp(makeProfile(), fileStore); // the start-up sweep is now waiting in list()
    openAttachments();
    chooseFor(RESUME, pdf('late.pdf'));
    await waitFor(async () => expect(await inner.list()).toHaveLength(1), WAIT);
    release();
    await until((r) => expect(r.attachments.resumeFileId).toBeTruthy());
    await pause(SWEEP * 2);
    expect(await inner.list()).toEqual([(await saved()).attachments.resumeFileId]);
  });

  it('deleting a resume clears its files, but not one another resume also uses', async () => {
    const fileStore = createMemoryFileStore();
    const own = await fileStore.put({ name: 'cv.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });
    const shared = await fileStore.put({ name: 'face.png', type: 'image/png', bytes: new Uint8Array([2]) });
    await renderApp(
      makeProfile([
        { id: 'r1', title: '第一份', attachments: { resumeFileId: own.id, photoFileId: shared.id } },
        { id: 'r2', title: '第二份', attachments: { photoFileId: shared.id } },
      ]),
      fileStore,
    );
    fireEvent.click(screen.getByRole('button', { name: /^正在编辑/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除这份简历' }));
    await waitFor(async () => expect((await store.load()).resumes.map((r) => r.id)).toEqual(['r2']), WAIT);
    await waitFor(async () => expect(await fileStore.list()).toEqual([shared.id]), WAIT);
  });
});
