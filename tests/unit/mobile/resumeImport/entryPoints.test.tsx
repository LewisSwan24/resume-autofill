// Where the resume import starts: onboarding, Home's no-resume card, the resume switcher sheet, the 简历 tab's empty
// state, and a resume PDF already stored in 附件 (read from the file store, no picker).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../../../mobile/app/src/App';
import { AttachmentsBody } from '../../../../mobile/app/src/AttachmentsScreen';
import { ResumeSummaryCard } from '../../../../mobile/app/src/home/ResumeSummaryCard';
import { Onboarding, type OnboardingProps } from '../../../../mobile/app/src/onboarding/Onboarding';
import { ResumeSwitcher } from '../../../../mobile/app/src/ResumeSwitcher';
import type { ImportFile, ReadOptions, ReadOutcome, ReadSuccess, ResumeReader } from '../../../../mobile/app/src/resumeImport/types';
import { createMemoryAppStateStore } from '../../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore, type FileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore } from '../../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../../mobile/app/src/store/wipe';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../../src/schema';

const WAIT = { timeout: 4000 };
const PICK = '选择简历文件（PDF 或 Word）';

function resumeOf(over: Record<string, unknown> = {}): Resume {
  return ResumeSchema.parse({ id: 'r1', title: '我的简历', locale: 'zh-CN', createdAt: 1, updatedAt: 1, ...over });
}
function profileOf(resumes: Resume[]): Profile {
  return ProfileSchema.parse({ schemaVersion: 1, resumes, activeResumeId: resumes[0]?.id ?? null, settings: { uiLanguage: 'zh' } });
}

interface Call {
  file: ImportFile;
  options?: ReadOptions;
  resolve: (outcome: ReadOutcome) => void;
}

async function renderApp(profile: Profile, files: FileStore = createMemoryFileStore()) {
  const calls: Call[] = [];
  const reader: ResumeReader = (file, options) => new Promise((resolve) => calls.push({ file, options, resolve }));
  const store = createMemoryStore(profile);
  const appState = createMemoryAppStateStore({ version: 1, onboardingDone: true });
  render(
    <App
      store={store}
      files={files}
      appState={appState}
      wiper={createStoreWiper({ profile: store, files, appState })}
      platform={{ onBack: () => () => {}, onPause: () => () => {} }}
      autosaveDelayMs={10}
      resumeReader={reader}
    />,
  );
  await screen.findByRole('heading', { level: 1, name: '首页' }, WAIT);
  return { calls, files };
}

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('entry points of the resume import', () => {
  it('onboarding: 导入 PDF / Word 简历 is an ordinary button and opens the picker', () => {
    const props: OnboardingProps = {
      step: 2,
      onStep: vi.fn(),
      language: 'zh',
      onLanguage: vi.fn(),
      onSkip: vi.fn(),
      onStartBlank: vi.fn(),
      onImport: vi.fn(),
      onImportResume: vi.fn(),
      showToast: vi.fn(),
    };
    render(<Onboarding {...props} />);
    const pdf = screen.getByRole('button', { name: /^导入 PDF \/ Word 简历/ });
    expect(pdf.hasAttribute('aria-disabled')).toBe(false);
    expect(within(pdf).getByText('读出简历里的内容，你核对后再保存。')).toBeTruthy();
    expect(within(pdf).queryByText('即将推出')).toBeNull();
    fireEvent.click(pdf);
    expect(props.onImportResume).toHaveBeenCalledTimes(1);
    expect(props.showToast).not.toHaveBeenCalled();
  });

  it('Home with no resume offers 从 PDF / Word 导入 first', () => {
    const onImportResume = vi.fn();
    render(
      <ResumeSummaryCard
        profile={profileOf([])}
        loadError={null}
        fillLanguage="active"
        onJump={vi.fn()}
        onStartResume={vi.fn()}
        onImport={vi.fn()}
        onImportResume={onImportResume}
        onOpenSettings={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['从 PDF / Word 导入', '新建中文简历', '新建英文简历', '从文件导入']);
    expect(buttons[0]!.className).toContain('m-button--primary');
    expect(buttons[1]!.className).not.toContain('m-button--primary');
    fireEvent.click(buttons[0]!);
    expect(onImportResume).toHaveBeenCalledTimes(1);
  });

  it('the resume switcher sheet offers 从 PDF / Word 导入', () => {
    const onImportResume = vi.fn();
    render(<ResumeSwitcher profile={profileOf([resumeOf()])} edit={vi.fn()} showToast={vi.fn()} onImportResume={onImportResume} />);
    fireEvent.click(screen.getByRole('button', { name: /^正在编辑/ }));
    const sheet = screen.getByRole('dialog', { name: '我的简历' });
    const actions = within(sheet).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(actions.indexOf('从 PDF / Word 导入')).toBe(actions.indexOf('新建英文简历') + 1);
    fireEvent.click(within(sheet).getByRole('button', { name: '从 PDF / Word 导入' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onImportResume).toHaveBeenCalledTimes(1);
  });

  it("the 简历 tab's empty state offers 从 PDF / Word 导入", async () => {
    await renderApp(profileOf([]));
    fireEvent.click(screen.getByRole('button', { name: '简历' }));
    await screen.findByRole('heading', { level: 1, name: '简历资料' });
    const click = vi.spyOn(screen.getByLabelText(PICK) as HTMLInputElement, 'click');
    const button = screen.getByRole('button', { name: '从 PDF / Word 导入' });
    expect(button.className).toContain('m-button--primary');
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('a stored resume PDF offers 从这份 PDF 读取简历内容, which reads it from the file store and targets that resume', async () => {
    const files = createMemoryFileStore();
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
    const info = await files.put({ name: '示例简历.pdf', type: 'application/pdf', bytes });
    const { calls } = await renderApp(profileOf([resumeOf({ attachments: { resumeFileId: info.id } })]), files);
    fireEvent.click(screen.getByRole('button', { name: '简历' }));
    fireEvent.click(await screen.findByRole('button', { name: /^附件/ }, WAIT));
    fireEvent.click(await screen.findByRole('button', { name: '从这份 PDF 读取简历内容' }, WAIT));
    await waitFor(() => expect(calls).toHaveLength(1), WAIT);
    expect(calls[0]!.file).toMatchObject({ name: '示例简历.pdf', source: 'attachment', stored: { fileId: info.id, resumeId: 'r1' } });
    expect([...calls[0]!.file.bytes]).toEqual([...bytes]);
    const read: ReadSuccess = {
      ok: true,
      kind: 'pdf',
      lines: [{ text: '张三', cells: ['张三'], page: 1, fontSize: 10 }],
      draft: { locale: 'zh-CN', fields: [{ path: 'basics.familyName', value: '张', line: 0, certainty: 'high' }] },
      pages: 1,
      language: { locale: 'zh-CN', mixed: false },
    };
    calls[0]!.resolve(read);
    await screen.findByRole('dialog', { name: '核对导入的内容' }, WAIT);
    expect(screen.getByRole('radio', { name: /合并到「我的简历」/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('checkbox', { name: /PDF/ })).toBeNull();
  });

  it('no such button for an empty or missing slot, or for the photo and transcript slots', async () => {
    const files = createMemoryFileStore();
    const photo = await files.put({ name: 'photo.png', type: 'image/png', bytes: new Uint8Array([1]) });
    const transcript = await files.put({ name: 'transcript.pdf', type: 'application/pdf', bytes: new Uint8Array([2]) });
    const onReadStored = vi.fn();
    const props = { files, edit: vi.fn(), showToast: vi.fn(), onStored: vi.fn(), onReadStored };
    const { unmount } = render(
      <AttachmentsBody {...props} resume={resumeOf({ attachments: { photoFileId: photo.id, transcriptFileId: transcript.id } })} />,
    );
    await screen.findByText('transcript.pdf');
    expect(screen.queryByRole('button', { name: '从这份 PDF 读取简历内容' })).toBeNull();
    unmount();
    render(<AttachmentsBody {...props} resume={resumeOf({ attachments: { resumeFileId: 'gone' } })} />);
    await screen.findByText(/gone/);
    expect(screen.queryByRole('button', { name: '从这份 PDF 读取简历内容' })).toBeNull();
    expect(onReadStored).not.toHaveBeenCalled();
  });
});
