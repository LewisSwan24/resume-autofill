// Files handed over by another app ("open with", "share"), through the whole App with a fake IncomingFileSource and
// a fake reader: the overlay opens on progress or review, explains errors, asks before replacing an edited review,
// waits for the profile, and closes any open sheet first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../../mobile/app/src/App';
import { mt } from '../../../../mobile/app/src/i18n';
import type { IncomingEvent, IncomingFileSource } from '../../../../mobile/app/src/resumeImport/incoming';
import { buildImport } from '../../../../mobile/app/src/resumeImport/merge';
import type { ImportFile, ReadOptions, ReadOutcome, ReadSuccess, ResumeReader } from '../../../../mobile/app/src/resumeImport/types';
import { createMemoryAppStateStore } from '../../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore, type FileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../../mobile/app/src/store/wipe';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

vi.mock('../../../../mobile/app/src/resumeImport/merge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../mobile/app/src/resumeImport/merge')>();
  return { ...actual, buildImport: vi.fn(actual.buildImport) };
});

const WAIT = { timeout: 4000 };

function success(): ReadSuccess {
  const texts = ['张三', '邮箱：zhangsan@example.com'];
  return {
    ok: true,
    kind: 'pdf',
    lines: texts.map((text) => ({ text, cells: [text], page: 1, fontSize: 10 })),
    draft: {
      locale: 'zh-CN',
      fields: [
        { path: 'basics.familyName', value: '张', line: 0, certainty: 'high' },
        { path: 'basics.givenName', value: '三', line: 0, certainty: 'high' },
        { path: 'contact.email', value: 'zhangsan@example.com', line: 1, certainty: 'check' },
      ],
    },
    pages: 1,
    language: { locale: 'zh-CN', mixed: false },
  };
}

const fileOf = (name: string): ImportFile => ({ name, mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]), source: 'view' });

function fakeIncoming(pending?: IncomingEvent) {
  let handler: ((event: IncomingEvent) => void) | null = null;
  let waiting = pending;
  const source: IncomingFileSource = {
    subscribe(h) {
      handler = h;
      if (waiting) {
        const event = waiting;
        waiting = undefined;
        h(event);
      }
      return () => {
        handler = null;
      };
    },
  };
  return {
    source,
    emit: (event: IncomingEvent) => act(() => handler!(event)),
    subscribed: () => handler !== null,
  };
}

interface Call {
  file: ImportFile;
  options?: ReadOptions;
  resolve: (outcome: ReadOutcome) => void;
}

let calls: Call[];
let incoming: ReturnType<typeof fakeIncoming>;

function profileOf(): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: '旧简历', locale: 'zh-CN', basics: { familyName: '李' } })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });
}

async function renderApp({ pending, profileStore, fileStore }: { pending?: IncomingEvent; profileStore?: ProfileStore; fileStore?: FileStore } = {}) {
  calls = [];
  const reader: ResumeReader = (file, options) => new Promise((resolve) => calls.push({ file, options, resolve }));
  incoming = fakeIncoming(pending);
  const platform: Platform = { onBack: () => () => {}, onPause: () => () => {}, incoming: incoming.source };
  const store = profileStore ?? createMemoryStore(profileOf());
  const files = fileStore ?? createMemoryFileStore();
  const appState = createMemoryAppStateStore({ version: 1, onboardingDone: true });
  render(
    <App store={store} files={files} appState={appState} wiper={createStoreWiper({ profile: store, files, appState })} platform={platform} autosaveDelayMs={10} resumeReader={reader} />,
  );
}

const last = () => calls[calls.length - 1]!;
const resolveWith = (outcome: ReadOutcome) => act(async () => last().resolve(outcome));

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('incoming files', () => {
  it('a file event opens the review', async () => {
    await renderApp();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'file', file: fileOf('张三简历.pdf') });
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    expect(last().file.source).toBe('view');
    await resolveWith(success());
    expect(await screen.findByRole('dialog', { name: '核对导入的内容' })).toBeTruthy();
    expect(screen.getByText('来自「张三简历.pdf」')).toBeTruthy();
  });

  it('a reading event shows the progress screen until the file arrives', async () => {
    await renderApp();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'reading', name: '张三简历.pdf' });
    const overlay = await screen.findByRole('dialog', { name: '正在读取简历' });
    expect(within(overlay).getByText('张三简历.pdf')).toBeTruthy();
    expect(calls).toHaveLength(0);
    incoming.emit({ kind: 'file', file: fileOf('张三简历.pdf') });
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    await resolveWith(success());
    expect(await screen.findByRole('dialog', { name: '核对导入的内容' })).toBeTruthy();
  });

  it('each error event shows its explanation', async () => {
    await renderApp();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    for (const reason of ['too_large', 'wrong_type', 'unreadable', 'empty'] as const) {
      incoming.emit({ kind: 'error', reason });
      const dialog = await screen.findByRole('dialog', { name: mt('zh', `m.ri.fail.title.${reason}`) });
      expect(within(dialog).getByText(mt('zh', `m.ri.fail.body.${reason}`))).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('a file arriving during a review with edits asks before replacing it; without edits it replaces at once', async () => {
    await renderApp();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'file', file: fileOf('第一份.pdf') });
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    await resolveWith(success());
    await screen.findByRole('dialog', { name: '核对导入的内容' });

    // No edits: the new file is read at once.
    incoming.emit({ kind: 'file', file: fileOf('第二份.pdf') });
    await waitFor(() => expect(calls).toHaveLength(2), WAIT);
    expect(last().file.name).toBe('第二份.pdf');
    await resolveWith(success());
    await screen.findByText('来自「第二份.pdf」');

    // With edits: asked first; 继续核对 keeps the review, 改读新文件 reads the new one.
    fireEvent.change(screen.getByLabelText('名'), { target: { value: '三丰' } });
    incoming.emit({ kind: 'file', file: fileOf('第三份.pdf') });
    let ask = await screen.findByRole('dialog', { name: '改读新收到的文件？' });
    expect(within(ask).getByText('「第二份.pdf」还没导入，改读「第三份.pdf」的话，这里的修改不会保存。')).toBeTruthy();
    expect(calls).toHaveLength(2);
    fireEvent.click(within(ask).getByRole('button', { name: '继续核对' }));
    expect((screen.getByLabelText('名') as HTMLInputElement).value).toBe('三丰');
    expect(calls).toHaveLength(2);

    incoming.emit({ kind: 'file', file: fileOf('第四份.pdf') });
    ask = await screen.findByRole('dialog', { name: '改读新收到的文件？' });
    fireEvent.click(within(ask).getByRole('button', { name: '改读新文件' }));
    await waitFor(() => expect(calls).toHaveLength(3), WAIT);
    expect(last().file.name).toBe('第四份.pdf');
    await resolveWith(success());
    await screen.findByText('来自「第四份.pdf」');
    expect((screen.getByLabelText('名') as HTMLInputElement).value).toBe('三');
  });

  it('an event before the profile has loaded is handled once it has', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = createMemoryStore(profileOf());
    const slow: ProfileStore = { load: async () => (await gate, inner.load()), save: (p) => inner.save(p) };
    await renderApp({ profileStore: slow, pending: { kind: 'file', file: fileOf('张三简历.pdf') } });
    await new Promise((r) => setTimeout(r, 30));
    expect(incoming.subscribed()).toBe(false);
    expect(calls).toHaveLength(0);
    await act(async () => release());
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    await resolveWith(success());
    expect(await screen.findByRole('dialog', { name: '核对导入的内容' })).toBeTruthy();
  });

  it('取消 while the phone is still reading the file: the file, or its error, is not opened when it arrives', async () => {
    await renderApp();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'reading', name: '张三简历.pdf' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: '正在读取简历' })).getByRole('button', { name: '取消' }));
    expect(await screen.findByText('已取消导入')).toBeTruthy();
    incoming.emit({ kind: 'file', file: fileOf('张三简历.pdf') });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    incoming.emit({ kind: 'reading', name: '第二份.pdf' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: '正在读取简历' })).getByRole('button', { name: '取消' }));
    incoming.emit({ kind: 'error', reason: 'unreadable' });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();

    // The next file is opened as usual.
    incoming.emit({ kind: 'file', file: fileOf('第三份.pdf') });
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    await resolveWith(success());
    expect(await screen.findByText('来自「第三份.pdf」')).toBeTruthy();
  });

  it('a file arriving while an import is being saved opens once the save is done', async () => {
    const inner = createMemoryFileStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowFiles: FileStore = { ...inner, put: async (input) => (await gate, inner.put(input)) };
    await renderApp({ fileStore: slowFiles });
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'file', file: fileOf('第一份.pdf') });
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    await resolveWith(success());
    await screen.findByRole('dialog', { name: '核对导入的内容' });
    fireEvent.click(screen.getByRole('radio', { name: '新建一份简历' }));
    fireEvent.click(screen.getByRole('button', { name: /^导入 \d+ 项$/ }));
    incoming.emit({ kind: 'reading', name: '第二份.pdf' });
    incoming.emit({ kind: 'file', file: fileOf('第二份.pdf') });
    expect(calls).toHaveLength(1);
    await act(async () => release());
    expect(await screen.findByText(/^已导入为「/, {}, WAIT)).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(2), WAIT);
    expect(last().file.name).toBe('第二份.pdf');
    await resolveWith(success());
    expect(await screen.findByText('来自「第二份.pdf」')).toBeTruthy();
  });

  it('an import the profile refuses says so and keeps the review', async () => {
    vi.mocked(buildImport).mockReturnValueOnce({ ok: false, refused: [], problem: 'invalid' });
    await renderApp();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'file', file: fileOf('张三简历.pdf') });
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    await resolveWith(success());
    await screen.findByRole('dialog', { name: '核对导入的内容' });
    fireEvent.click(screen.getByRole('radio', { name: '新建一份简历' }));
    fireEvent.click(screen.getByRole('button', { name: /^导入 \d+ 项$/ }));
    expect(await screen.findByText('没能导入，请再试一次。')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '核对导入的内容' })).toBeTruthy();
  });

  it('an incoming file closes an open sheet before the overlay shows', async () => {
    await renderApp();
    fireEvent.click(await screen.findByRole('button', { name: '简历' }, WAIT));
    fireEvent.click(await screen.findByRole('button', { name: /^正在编辑/ }, WAIT));
    expect(await screen.findByRole('dialog', { name: '我的简历' })).toBeTruthy();
    await waitFor(() => expect(incoming.subscribed()).toBe(true), WAIT);
    incoming.emit({ kind: 'file', file: fileOf('张三简历.pdf') });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '我的简历' })).toBeNull(), WAIT);
    expect(await screen.findByRole('dialog', { name: '正在读取简历' })).toBeTruthy();
  });
});
