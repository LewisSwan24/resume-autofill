// The fill browser screen with the real session model and the fake native plugin: address bar,
// toolbar, page-area insets, error views, the empty-profile sheet, the report (tabs, locate, undo), the file chooser,
// external links and downloads, the keyboard, and the host text at a large font.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserScreen, type BrowserScreenProps } from '../../../../mobile/app/src/browser/BrowserScreen';
import { createBrowserSession, type BrowserSession } from '../../../../mobile/app/src/browser/model/session';
import { createFakeFillBrowser, type FakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { mt } from '../../../../mobile/app/src/i18n';
import type { FileInfo } from '../../../../mobile/app/src/store/fileStore';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { decodeAppCommand, type AppCommand } from '../../../../mobile/bridge/protocol';
import type { FieldReport } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const WAIT = { timeout: 3000 };
const HTTPS = 'https://jobs.example.com/apply';
const ORIGIN = 'https://jobs.example.com';

const FILES: Record<string, { info: FileInfo; bytes: Uint8Array }> = {
  'f-cv': { info: { id: 'f-cv', name: '简历.pdf', type: 'application/pdf', size: 3, createdAt: 0 }, bytes: new Uint8Array([1, 2, 3]) },
  'f-photo': { info: { id: 'f-photo', name: '证件照.jpg', type: 'image/jpeg', size: 2, createdAt: 0 }, bytes: new Uint8Array([9, 9]) },
};

const fullProfile = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [
      ResumeSchema.parse({
        id: 'r1',
        title: '我的中文简历',
        locale: 'zh-CN',
        basics: { familyName: '张', givenName: '三' },
        contact: { email: 'zhangsan@example.com', phone: '13800000000' },
        attachments: { resumeFileId: 'f-cv', photoFileId: 'f-photo' },
      }),
    ],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });
const emptyProfile = (): Profile => ProfileSchema.parse({ schemaVersion: 1, resumes: [], activeResumeId: null, settings: { uiLanguage: 'zh' } });

const row = (fieldId: string, label: string, outcome: FieldReport['outcome'], value?: string): FieldReport => ({
  fieldId,
  label,
  fieldKey: null,
  section: null,
  outcome,
  confidence: 1,
  ...(value ? { value } : {}),
});
const REPORT_ROWS: FieldReport[] = [
  row('f1', '姓名', 'filled', '张三'),
  row('f4', '邮箱', 'filled', 'zhangsan@example.com'),
  row('f2', '性别', 'needs_review', '男'),
  row('section:education', '教育经历', 'action_failed'),
  row('f3', '期望薪资', 'no_data'),
];

interface Rig {
  native: FakeFillBrowser;
  session: BrowserSession;
  commands: { frame: number; cmd: AppCommand }[];
  onGoToResume: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  /** Unmount the screen (the page hidden behind the return pill) or mount it again. */
  setShown(shown: boolean): void;
}

type Extra = Partial<Pick<BrowserScreenProps, 'advanceSites' | 'onAdvanceSite' | 'sensitiveFields' | 'onSensitiveFields'>>;

function Harness({ session, native, profile, onClose, onGoToResume, shown = true, extra = {} }: { session: BrowserSession; native: FakeFillBrowser; profile: Profile; onClose: () => void; onGoToResume: () => void; shown?: boolean; extra?: Extra }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const backStack = useMemo(() => createBackStack(), []);
  const files = useMemo(() => ({ info: async (id: string) => FILES[id]?.info ?? null }), []);
  return (
    <BackStackContext.Provider value={backStack}>
      {shown ? (
        <BrowserScreen open={{ session, state, native }} profile={profile} files={files} onClose={onClose} onGoToResume={onGoToResume} showToast={() => undefined} {...extra} />
      ) : null}
    </BackStackContext.Provider>
  );
}

async function renderBrowser(
  opts: { url?: string; profile?: Profile; demo?: boolean; silentFill?: boolean; rows?: FieldReport[]; step?: 'next' | 'final'; press?: 'final_step' | 'needs_you'; extra?: Extra } = {},
): Promise<Rig> {
  const rows = opts.rows ?? REPORT_ROWS;
  const native = createFakeFillBrowser();
  const commands: Rig['commands'] = [];
  const url = opts.url ?? HTTPS;
  const profile = opts.profile ?? fullProfile();
  // A page that answers: needs → name and email; fill → REPORT_ROWS; focus → ok; undo → one restored, one manual.
  native.deliver = (o) => {
    const cmd = decodeAppCommand(o.data);
    if (!cmd) return true;
    commands.push({ frame: o.frame, cmd });
    if (opts.silentFill && cmd.kind === 'fill') return true;
    const reply =
      cmd.kind === 'needs'
        ? { v: 1, kind: 'needs', reqId: cmd.reqId, needs: { fieldKeys: ['contact.email', 'contact.phone'], repeatSections: [], attachmentKeys: [] } }
        : cmd.kind === 'fill'
          ? {
              v: 1,
              kind: 'report',
              reqId: cmd.reqId,
              runId: cmd.runId,
              report: cmd.only
                ? { url, startedAt: 1, finishedAt: 2, fields: rows.filter((f) => cmd.only!.includes(f.fieldId)).map((f) => ({ ...f, outcome: 'filled', note: 'sensitive_filled' })), counts: countOutcomes([]) }
                : { url, startedAt: 1, finishedAt: 2, fields: rows, counts: countOutcomes(rows) },
            }
          : cmd.kind === 'step'
            ? opts.step
              ? { v: 1, kind: 'step', reqId: cmd.reqId, state: { url, fingerprint: 'f1', action: opts.step, blocker: null, userInputAt: 0, title: '基本信息' } }
              : null
          : cmd.kind === 'press'
            ? { v: 1, kind: 'pressed', reqId: cmd.reqId, pressed: false, reason: opts.press ?? 'final_step' }
          : cmd.kind === 'focus'
            ? { v: 1, kind: 'focused', reqId: cmd.reqId, ok: true }
            : cmd.kind === 'undo'
              ? { v: 1, kind: 'undone', reqId: cmd.reqId, runId: cmd.runId, restored: ['f1', 'f4'], manual: ['f2'], addedCards: 1 }
              : null;
    if (reply) void Promise.resolve().then(() => act(() => native.emit('message', { frame: o.frame, generation: 1, origin: new URL(url).origin, main: true, data: JSON.stringify(reply) })));
    return true;
  };
  const session = createBrowserSession({
    target: { url, demo: opts.demo ?? false },
    native,
    getFillContext: () => ({ profile, fillLanguage: 'active' }),
    readFile: async (id) => FILES[id] ?? null,
    onTitle: () => undefined,
    translate: (key, params) => mt('zh', key, params),
    timeouts: { fill: 50 },
  });
  const onGoToResume = vi.fn();
  const onClose = vi.fn();
  const view = render(<Harness session={session} native={native} profile={profile} onClose={onClose} onGoToResume={onGoToResume} extra={opts.extra} />);
  await waitFor(() => expect(native.callsOf('open')).toHaveLength(1), WAIT);
  const setShown = (shown: boolean) =>
    view.rerender(<Harness session={session} native={native} profile={profile} onClose={onClose} onGoToResume={onGoToResume} shown={shown} extra={opts.extra} />);
  return { native, session, commands, onGoToResume, onClose, setShown };
}

function load(r: Rig, over: { url?: string; canGoBack?: boolean; canGoForward?: boolean; finished?: boolean } = {}) {
  const url = over.url ?? HTTPS;
  const nav = { url, generation: 1, canGoBack: over.canGoBack ?? false, canGoForward: over.canGoForward ?? false };
  act(() => {
    r.native.emit('navigation', { phase: 'started', ...nav });
    if (over.finished !== false) r.native.emit('navigation', { phase: 'finished', ...nav });
  });
}

function checkIn(r: Rig, origin = ORIGIN) {
  act(() => {
    r.native.emit('message', { frame: 1, generation: 1, origin, main: true, data: JSON.stringify({ v: 1, kind: 'hello', iframes: 0 }) });
    r.native.emit('message', { frame: 1, generation: 1, origin, main: true, data: JSON.stringify({ v: 1, kind: 'scan', count: 4, iframes: 0 }) });
  });
}

/** Load, check in and run a fill through a FAB tap; the report sheet opens. */
async function runFill(r: Rig) {
  load(r);
  checkIn(r);
  act(() => r.native.emit('fabTap', {}));
  return screen.findByRole('dialog', { name: '填写报告' }, WAIT);
}

const sheetButtons = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
    .filter((name) => name !== '关闭');

let innerHeight = 800;
beforeEach(() => {
  setLanguage('zh');
  innerHeight = 800;
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerHeight });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.style.fontSize = '';
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('BrowserScreen: address bar and toolbar', () => {
  it('shows the host with a lock for https; an http page shows the warning instead', async () => {
    await renderBrowser();
    const host = screen.getByRole('button', { name: '网页信息：jobs.example.com' });
    expect(within(host).getByRole('img', { name: '加密连接' })).toBeTruthy();
    cleanup();
    await renderBrowser({ url: 'http://jobs.example.com/a' });
    const insecure = screen.getByRole('button', { name: '网页信息：jobs.example.com' });
    expect(within(insecure).getByRole('img', { name: '连接没有加密' })).toBeTruthy();
    expect(within(insecure).queryByRole('img', { name: '加密连接' })).toBeNull();
  });

  it('a certificate error shows no lock: the host carries the certificate-problem icon instead', async () => {
    const r = await renderBrowser();
    act(() => r.native.emit('loadError', { kind: 'ssl', url: 'https://jobs.example.com/', code: -11 }));
    const host = screen.getByRole('button', { name: '网页信息：jobs.example.com' });
    expect(within(host).queryByRole('img', { name: '加密连接' })).toBeNull();
    expect(within(host).getByRole('img', { name: '证书有问题' })).toBeTruthy();
    expect(host.querySelector('[data-icon="shield-exclamation"]')).not.toBeNull();
  });

  it('back and forward follow the page history; reload turns into 停止加载 while loading', async () => {
    const r = await renderBrowser();
    load(r, { finished: false });
    expect((screen.getByRole('button', { name: '后退' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '前进' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '停止加载' }));
    expect(r.native.callsOf('navigate')).toContainEqual({ action: 'stop' });
    load(r, { canGoBack: true, canGoForward: true });
    expect((screen.getByRole('button', { name: '后退' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(r.native.callsOf('navigate')).toEqual([{ action: 'stop' }, { action: 'forward' }, { action: 'reload' }]);
    expect(screen.queryByRole('button', { name: '停止加载' })).toBeNull();
  });

  it('the progress line is a progressbar named after the host, gone when loaded', async () => {
    const r = await renderBrowser();
    load(r, { finished: false });
    act(() => r.native.emit('progress', { value: 40 }));
    const bar = screen.getByRole('progressbar', { name: '正在加载 jobs.example.com' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    load(r);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('the page-area placeholder’s insets go to the native view, and only real changes are sent', async () => {
    let top = 57;
    let bottom = 740;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isViewport = this.classList.contains('m-br__viewport');
      return {
        top: isViewport ? top : 0,
        bottom: isViewport ? bottom : 0,
        left: 0,
        right: 360,
        width: 360,
        height: isViewport ? bottom - top : 0,
        x: 0,
        y: isViewport ? top : 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const r = await renderBrowser();
    expect(r.native.callsOf('open')[0]!.insets).toEqual({ top: 57, bottom: 60 });
    top = 57.4;
    act(() => void window.dispatchEvent(new Event('resize')));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(r.native.callsOf('setInsets')).toEqual([]);
    bottom = 500;
    act(() => void window.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(r.native.callsOf('setInsets').at(-1)).toEqual({ top: 57, bottom: 300 }), WAIT);
  });

  it('the keyboard hides the toolbar', async () => {
    const r = await renderBrowser();
    load(r);
    expect(screen.getByRole('button', { name: '后退' })).toBeTruthy();
    act(() => r.native.emit('keyboard', { visible: true, height: 300 }));
    expect(screen.queryByRole('button', { name: '后退' })).toBeNull();
    act(() => r.native.emit('keyboard', { visible: false, height: 0 }));
    expect(screen.getByRole('button', { name: '后退' })).toBeTruthy();
  });

  it('at 200% font the host wraps (two lines at most), never an ellipsis', async () => {
    document.documentElement.style.fontSize = '200%';
    await renderBrowser({ url: 'https://a-very-long-subdomain-for-careers.jobs.example.com/apply' });
    const text = document.querySelector('.m-br-host__text') as HTMLElement;
    expect(text.textContent).toBe('a-very-long-subdomain-for-careers.jobs.example.com');
    expect(text.className).not.toMatch(/ellipsis|truncate|nowrap/);
    expect(text.style.textOverflow).toBe('');
  });
});

describe('BrowserScreen: errors', () => {
  const KINDS = [
    ['offline', '没有网络'],
    ['dns', '找不到这个网站'],
    ['timeout', '网站没有回应'],
    ['ssl', '这个网站的安全证书有问题'],
    ['generic', '网页打不开'],
  ] as const;

  it('each load error shows its title in the page area and hides the native page view', async () => {
    const r = await renderBrowser();
    for (const [kind, title] of KINDS) {
      load(r);
      act(() => r.native.emit('loadError', { kind, url: HTTPS, code: -2 }));
      expect(within(screen.getByRole('alert')).getByRole('heading', { name: title })).toBeTruthy();
      expect(r.native.callsOf('setVisible').at(-1)).toEqual({ visible: false });
    }
  });

  it('an SSL error offers exactly 重试 and 关闭; 重试 loads the URL again', async () => {
    const r = await renderBrowser();
    load(r);
    act(() => r.native.emit('loadError', { kind: 'ssl', url: HTTPS, code: -11 }));
    const view = screen.getByRole('alert');
    expect(within(view).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['重试', '关闭']);
    fireEvent.click(within(view).getByRole('button', { name: '重试' }));
    expect(r.native.callsOf('loadUrl')).toEqual([{ url: HTTPS }]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('DNS adds 复制链接; a crashed page offers 重新打开; 关闭 closes', async () => {
    const r = await renderBrowser();
    load(r);
    act(() => r.native.emit('loadError', { kind: 'dns', url: HTTPS, code: -2 }));
    expect(within(screen.getByRole('alert')).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['重试', '复制链接', '关闭']);
    act(() => r.native.emit('crashed', {}));
    expect(within(screen.getByRole('alert')).getByRole('heading', { name: '网页意外关闭了' })).toBeTruthy();
    expect(within(screen.getByRole('alert')).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['重新打开', '关闭']);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '关闭' }));
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BrowserScreen: filling', () => {
  it('a FAB tap with an empty profile opens 「还没有能用的简历」; 去填简历 goes to the 简历 tab', async () => {
    const r = await renderBrowser({ profile: emptyProfile() });
    load(r);
    checkIn(r);
    act(() => r.native.emit('fabTap', {}));
    const sheet = await screen.findByRole('dialog', { name: '还没有能用的简历' }, WAIT);
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheetButtons(sheet)).toEqual(['去填简历']);
    // The native cover follows in an effect after the sheet renders.
    await waitFor(() => expect(r.native.callsOf('setPageCover').at(-1)).toEqual({ block: true, scrim: true }), WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: '去填简历' }));
    expect(r.onGoToResume).toHaveBeenCalledTimes(1);
    expect(r.commands.filter((c) => c.cmd.kind === 'fill')).toHaveLength(0);
  });

  it('after a run the report opens on 待你看; a row locates its field; a section row is not a button', async () => {
    const r = await renderBrowser();
    const sheet = await runFill(r);
    expect(sheet.getAttribute('aria-modal')).toBeNull();
    const tabs = within(sheet).getByRole('tablist', { name: '按结果筛选' });
    expect(within(tabs).getAllByRole('tab').map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([
      ['已填 2', 'false'],
      ['待你看 2', 'true'],
      ['跳过 1', 'false'],
    ]);
    expect(within(sheet).getByText('App 不会替你提交，也不会点提交按钮。检查一遍，再自己点网页上的提交。')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: '在网页上找到「教育经历」' })).toBeNull();
    expect(within(sheet).getByText('教育经历')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '在网页上找到「性别」' }));
    await waitFor(() => expect(r.commands.filter((c) => c.cmd.kind === 'focus').map((c) => [c.frame, (c.cmd as { fieldId: string }).fieldId])).toEqual([[1, 'f2']]), WAIT);
    // Locating folds the sheet into a bar; 列表 brings the tabs back.
    fireEvent.click(within(sheet).getByRole('button', { name: '列表' }));
    fireEvent.click(within(sheet).getByRole('tab', { name: '已填 2' }));
    expect(within(sheet).getByText('填入：张三')).toBeTruthy();
    // The toolbar now has the report, with the rows waiting for the person.
    expect(screen.getByRole('button', { name: '填写报告，待你看 2 项' })).toBeTruthy();
  });

  it('「撤销这次填写」 sends undo to the filled frame and the undone view lists what must be changed back by hand', async () => {
    const r = await renderBrowser();
    const sheet = await runFill(r);
    const runId = (r.commands.find((c) => c.cmd.kind === 'fill')!.cmd as { runId: string }).runId;
    fireEvent.click(within(sheet).getByRole('button', { name: '撤销这次填写' }));
    await waitFor(() => expect(within(sheet).getByText('已恢复 2 项')).toBeTruthy(), WAIT);
    const undo = r.commands.filter((c) => c.cmd.kind === 'undo');
    expect(undo.map((c) => [c.frame, (c.cmd as { runId: string }).runId])).toEqual([[1, runId]]);
    expect(within(sheet).getByText('有 1 项没法自动恢复，请在网页上自己改回去：')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: '在网页上找到「性别」' })).toBeTruthy();
    expect(within(sheet).getByText('填写时新加了 1 段经历，撤销不会删掉，需要的话自己删除。')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: '撤销这次填写' })).toBeNull();
  });

  it('closing after a fill asks first', async () => {
    const r = await renderBrowser();
    await runFill(r);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭网申页面' }));
    const confirm = screen.getByRole('dialog', { name: '关闭这个网申页面？' });
    expect(r.onClose).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: '关闭' }));
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BrowserScreen: file chooser, external links, downloads', () => {
  it('the file chooser lists only stored attachments that match accept; choosing hands over base64; closing answers cancel', async () => {
    const r = await renderBrowser();
    load(r);
    act(() => r.native.emit('fileChooser', { id: 7, accept: ['.pdf', 'application/pdf'], multiple: false, capture: false }));
    const sheet = await screen.findByRole('dialog', { name: '选择要上传的文件' }, WAIT);
    await waitFor(() => expect(within(sheet).getByText('简历.pdf')).toBeTruthy(), WAIT);
    expect(within(sheet).queryByText('证件照.jpg')).toBeNull();
    expect(within(sheet).getByText('这个网页要：PDF')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: /^简历\.pdf/ }));
    await waitFor(() =>
      expect(r.native.callsOf('answerFileChooser')).toEqual([{ id: 7, kind: 'files', files: [{ name: '简历.pdf', mimeType: 'application/pdf', data: 'AQID' }] }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择要上传的文件' })).toBeNull());
    act(() => r.native.emit('fileChooser', { id: 8, accept: [], multiple: false, capture: false }));
    const again = await screen.findByRole('dialog', { name: '选择要上传的文件' }, WAIT);
    fireEvent.click(within(again).getByRole('button', { name: '取消' }));
    expect(r.native.callsOf('answerFileChooser').at(-1)).toEqual({ id: 8, kind: 'cancel' });
  });

  it('a tel: link asks first and shows the number; 取消 opens nothing', async () => {
    const r = await renderBrowser();
    load(r);
    act(() => r.native.emit('external', { url: 'tel:10086', gesture: true, main: true }));
    const sheet = screen.getByRole('dialog', { name: '打开拨号？' });
    expect(within(sheet).getByText('10086')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(r.native.callsOf('openExternal')).toEqual([]);
  });

  it('a weixin: link only offers to copy it; nothing without a tap shows anything', async () => {
    const r = await renderBrowser();
    load(r);
    act(() => r.native.emit('external', { url: 'weixin://dl/business/?t=demo', gesture: false, main: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => r.native.emit('external', { url: 'weixin://dl/business/?t=demo', gesture: true, main: true }));
    const sheet = screen.getByRole('dialog', { name: '这个链接要打开别的 App' });
    expect(within(sheet).getByText(/微信/)).toBeTruthy();
    expect(sheetButtons(sheet)).toEqual(['复制链接']);
    expect(r.native.callsOf('openExternal')).toEqual([]);
  });

  it('a download names the file and size; a blob: file has no link to copy', async () => {
    const r = await renderBrowser();
    load(r);
    act(() => r.native.emit('download', { url: 'https://jobs.example.com/form.pdf', mimeType: 'application/pdf', fileName: '报名表.pdf', size: 2048 }));
    let sheet = screen.getByRole('dialog', { name: '这个网页要下载文件' });
    expect(within(sheet).getByText(/「报名表\.pdf」，2(\.0)? KB/)).toBeTruthy();
    expect(sheetButtons(sheet)).toEqual(['复制链接']);
    fireEvent.click(within(sheet).getByRole('button', { name: '关闭' }));
    act(() => r.native.emit('download', { url: 'blob:https://jobs.example.com/1', mimeType: 'application/pdf', fileName: '导出.pdf', size: -1 }));
    sheet = screen.getByRole('dialog', { name: '这个网页要下载文件' });
    expect(within(sheet).getByText(/大小未知/)).toBeTruthy();
    expect(sheetButtons(sheet)).toEqual([]);
    expect(within(sheet).getByText('这个文件是网页临时生成的，没有链接可以复制，请在电脑上下载。')).toBeTruthy();
  });
});

describe('BrowserScreen – edge cases', () => {
  /** The FAB finds no room: an obstacle covers the whole page area. */
  function dockFab(r: Rig) {
    act(() => {
      r.native.emit('pageArea', { width: 360, height: 600 });
      r.native.emit('message', {
        frame: 1,
        generation: 1,
        origin: ORIGIN,
        main: true,
        data: JSON.stringify({ v: 1, kind: 'obstacles', boxes: [{ left: 0, top: 0, right: 360, bottom: 600 }], viewport: { width: 360, height: 600, offsetLeft: 0, offsetTop: 0, scale: 1 } }),
      });
    });
  }
  const toolbar = () => screen.getByRole('navigation', { name: mt('zh', 'm.br.toolbar') });

  it('docked FAB: the toolbar fills before a run, then keeps the report reachable and does not start a new run', async () => {
    const r = await renderBrowser();
    load(r);
    checkIn(r);
    dockFab(r);
    await waitFor(() => expect(r.session.getState().fabDocked).toBe(true), WAIT);
    fireEvent.click(within(toolbar()).getByRole('button', { name: '一键填写' }));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(r.session.getState().fabDocked).toBe(true), WAIT);
    expect(within(toolbar()).queryByRole('button', { name: '一键填写' })).toBeNull();
    fireEvent.click(within(toolbar()).getByRole('button', { name: '填写报告，待你看 2 项' }));
    expect(await screen.findByRole('dialog', { name: '填写报告' }, WAIT)).toBeTruthy();
    expect(r.commands.filter((c) => c.cmd.kind === 'fill')).toHaveLength(1);
  });

  it('docked FAB after undo: fill again and the report are both on the toolbar', async () => {
    const r = await renderBrowser();
    load(r);
    checkIn(r);
    dockFab(r);
    await waitFor(() => expect(r.session.getState().fabDocked).toBe(true), WAIT);
    fireEvent.click(within(toolbar()).getByRole('button', { name: '一键填写' }));
    const sheet = await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: '撤销这次填写' }));
    await waitFor(() => expect(within(sheet).getByText('已恢复 2 项')).toBeTruthy(), WAIT);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: '一键填写' })).toBeTruthy(), WAIT);
    expect(within(toolbar()).getByRole('button', { name: /^填写报告/ })).toBeTruthy();
  });

  it('page info says 证书有问题, never 加密连接, for a page refused for its certificate', async () => {
    const r = await renderBrowser();
    act(() => r.native.emit('loadError', { kind: 'ssl', url: 'https://jobs.example.com/', code: -11 }));
    fireEvent.click(screen.getByRole('button', { name: '网页信息：jobs.example.com' }));
    const info = await screen.findByRole('dialog', { name: '网页信息' }, WAIT);
    expect(within(info).queryByText('加密连接')).toBeNull();
    expect(within(info).getByText('证书有问题')).toBeTruthy();
  });

  it('the host button tells a screen reader whether the connection is safe', async () => {
    const r = await renderBrowser({ url: 'http://jobs.example.com/a' });
    expect(screen.getByRole('button', { name: '网页信息：jobs.example.com', description: '连接没有加密' })).toBeTruthy();
    act(() => r.native.emit('loadError', { kind: 'ssl', url: 'http://jobs.example.com/a', code: -11 }));
    expect(screen.getByRole('button', { name: '网页信息：jobs.example.com', description: '证书有问题' })).toBeTruthy();
    cleanup();
    await renderBrowser();
    expect(screen.getByRole('button', { name: '网页信息：jobs.example.com', description: '加密连接' })).toBeTruthy();
  });

  it('in English the handed-over list uses English punctuation', async () => {
    setLanguage('en');
    const r = await renderBrowser();
    await runFill(r).catch(() => undefined);
    const sheet = await screen.findByRole('dialog', { name: 'Fill report' }, WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: /^What was handed to the page/ }));
    const lines = within(sheet)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
      .filter((x) => /^Contact/.test(x));
    // One line: the module, then the two fields handed over (email and phone).
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[：、]/);
    expect(lines[0]).toMatch(/^Contact[^:]*: [^,]+, [^,]+$/);
  });

  it('a fill whose report never comes back still opens the report, says so, and offers undo', async () => {
    const r = await renderBrowser({ silentFill: true });
    load(r);
    checkIn(r);
    act(() => r.native.emit('fabTap', {}));
    const sheet = await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    expect(within(sheet).getByText(mt('zh', 'm.br.report.unanswered'))).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: '撤销这次填写' })).toBeTruthy();
    expect(screen.queryByText(mt('zh', 'm.br.run.failed'))).toBeNull();
  });

  it('coming back from the return pill does not replay the last toast, the report or the announcement', async () => {
    const r = await renderBrowser();
    act(() => r.native.emit('permission', { kind: 'camera' }));
    expect(await screen.findByText('这个网页想用相机，App 内的浏览器不提供。', undefined, WAIT)).toBeTruthy();
    await runFill(r);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '填写报告' })).toBeNull(), WAIT);
    r.setShown(false);
    r.setShown(true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.queryByRole('dialog', { name: '填写报告' })).toBeNull();
    expect(screen.queryByText('这个网页想用相机，App 内的浏览器不提供。')).toBeNull();
    expect(document.querySelector('.m-br-live')?.textContent ?? '').toBe('');
  });

  it('the resume chip lists the person’s resumes; choosing one is what the fill uses', async () => {
    const profile = ProfileSchema.parse({
      schemaVersion: 1,
      resumes: [
        ResumeSchema.parse({ id: 'r1', title: '我的中文简历', locale: 'zh-CN', contact: { email: 'zhangsan@example.com' } }),
        ResumeSchema.parse({ id: 'r2', title: 'English resume', locale: 'en-AU', contact: { email: 'san.zhang@example.com' } }),
      ],
      activeResumeId: 'r1',
      settings: { uiLanguage: 'zh' },
    });
    const r = await renderBrowser({ profile });
    load(r);
    checkIn(r);
    fireEvent.click(screen.getByRole('button', { name: '填写用简历：我的中文简历，点一下更换' }));
    const sheet = await screen.findByRole('dialog', { name: '用哪份简历填写' }, WAIT);
    expect(within(sheet).getAllByRole('radio').map((x) => x.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(within(sheet).queryByText('示例简历（虚构的张三）')).toBeNull();
    fireEvent.click(within(sheet).getByRole('radio', { name: /English resume/ }));
    expect(screen.getByRole('button', { name: '填写用简历：English resume，点一下更换' })).toBeTruthy();
    act(() => r.native.emit('fabTap', {}));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    const fill = r.commands.find((c) => c.cmd.kind === 'fill')!.cmd as { resume: { contact: { email: string } } };
    expect(fill.resume.contact.email).toBe('san.zhang@example.com');
  });

  it('with no resume, 用示例简历试试 on the demo form fills with the made-up sample; a real site never offers it', async () => {
    const DEMO = 'https://appassets.androidplatform.net/demo/form.html';
    const r = await renderBrowser({ url: DEMO, demo: true, profile: emptyProfile() });
    load(r, { url: DEMO });
    checkIn(r, 'https://appassets.androidplatform.net');
    fireEvent.click(screen.getByRole('button', { name: /^填写用简历：示例简历（虚构的张三）/ }));
    const chooser = await screen.findByRole('dialog', { name: '用哪份简历填写' }, WAIT);
    expect(within(chooser).getByRole('radio', { name: /示例简历（虚构的张三）/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(chooser).getByRole('radio', { name: /示例简历（虚构的张三）/ }));
    act(() => r.native.emit('fabTap', {}));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    // The profile is empty: what reached the page can only be the made-up sample.
    const fill = r.commands.find((c) => c.cmd.kind === 'fill')!.cmd as { resume: { contact: { email: string } } };
    expect(fill.resume.contact.email).toBe('zhangsan@example.com');
    cleanup();
    const real = await renderBrowser({ profile: emptyProfile() });
    load(real);
    checkIn(real);
    act(() => real.native.emit('fabTap', {}));
    const sheet = await screen.findByRole('dialog', { name: '还没有能用的简历' }, WAIT);
    expect(within(sheet).queryByRole('button', { name: '用示例简历试试' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '去填简历' }));
    fireEvent.click(screen.getByRole('button', { name: /^填写用简历/ }));
    const realChooser = await screen.findByRole('dialog', { name: '用哪份简历填写' }, WAIT);
    expect(within(realChooser).queryByText('示例简历（虚构的张三）')).toBeNull();
  });

  it('用示例简历试试 from the empty-profile sheet on the demo fills with the sample', async () => {
    const DEMO = 'https://appassets.androidplatform.net/demo/form.html';
    const r = await renderBrowser({ url: DEMO, demo: true, profile: emptyProfile() });
    load(r, { url: DEMO });
    checkIn(r, 'https://appassets.androidplatform.net');
    // An empty choice first (none of the person's resumes), as after picking a resume that was then deleted.
    act(() => r.session.choose({ kind: 'profile', resumeId: 'gone' }));
    act(() => r.native.emit('fabTap', {}));
    const sheet = await screen.findByRole('dialog', { name: '还没有能用的简历' }, WAIT);
    fireEvent.click(within(sheet).getByRole('button', { name: '用示例简历试试' }));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    expect(r.session.getState().choice).toEqual({ kind: 'sample' });
    // The profile is empty: what reached the page can only be the made-up sample.
    const fill = r.commands.find((c) => c.cmd.kind === 'fill')!.cmd as { resume: { contact: { email: string } } };
    expect(fill.resume.contact.email).toBe('zhangsan@example.com');
  });

  describe('a frame of another site asks for data', () => {
    const VENDOR = 'https://forms.vendor-example.net';
    const twoSites = (r: Rig) => {
      const frames: Record<number, { origin: string; main: boolean }> = { 1: { origin: ORIGIN, main: true }, 2: { origin: VENDOR, main: false } };
      r.native.deliver = (o) => {
        const cmd = decodeAppCommand(o.data);
        if (!cmd) return true;
        r.commands.push({ frame: o.frame, cmd });
        const reply =
          cmd.kind === 'needs'
            ? { v: 1, kind: 'needs', reqId: cmd.reqId, needs: { fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] } }
            : cmd.kind === 'fill'
              ? { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url: HTTPS, startedAt: 1, finishedAt: 2, fields: REPORT_ROWS, counts: countOutcomes(REPORT_ROWS) } }
              : null;
        const f = frames[o.frame]!;
        if (reply) void Promise.resolve().then(() => act(() => r.native.emit('message', { frame: o.frame, generation: 1, origin: f.origin, main: f.main, data: JSON.stringify(reply) })));
        return true;
      };
      load(r);
      checkIn(r);
      act(() => {
        r.native.emit('message', { frame: 2, generation: 1, origin: VENDOR, main: false, data: JSON.stringify({ v: 1, kind: 'hello', iframes: 0 }) });
        r.native.emit('message', { frame: 2, generation: 1, origin: VENDOR, main: false, data: JSON.stringify({ v: 1, kind: 'scan', count: 2, iframes: 0 }) });
      });
      act(() => r.native.emit('fabTap', {}));
    };
    const filledFrames = (r: Rig) => r.commands.filter((c) => c.cmd.kind === 'fill').map((c) => c.frame);

    it('names the other host before anything is sent; 只填本站 fills only this page', async () => {
      const r = await renderBrowser();
      twoSites(r);
      const ask = await screen.findByRole('dialog', { name: '资料也要交给其他网站吗？' }, WAIT);
      expect(ask.textContent).toContain('forms.vendor-example.net');
      expect(filledFrames(r)).toEqual([]);
      expect(sheetButtons(ask)).toEqual(['也填这些', '只填本站']);
      fireEvent.click(within(ask).getByRole('button', { name: '只填本站' }));
      const report = await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
      expect(filledFrames(r)).toEqual([1]);
      expect(report.textContent).not.toContain('vendor-example');
    });

    it('也填这些 fills the other site too, and the report says it received data', async () => {
      const r = await renderBrowser();
      twoSites(r);
      const ask = await screen.findByRole('dialog', { name: '资料也要交给其他网站吗？' }, WAIT);
      fireEvent.click(within(ask).getByRole('button', { name: '也填这些' }));
      const report = await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
      expect(filledFrames(r)).toEqual([1, 2]);
      expect(report.textContent).toContain('也交给了这些网站：forms.vendor-example.net');
    });

    it('closing the question any other way fills only this page', async () => {
      const r = await renderBrowser();
      twoSites(r);
      const ask = await screen.findByRole('dialog', { name: '资料也要交给其他网站吗？' }, WAIT);
      fireEvent.keyDown(ask, { key: 'Escape' });
      await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
      expect(filledFrames(r)).toEqual([1]);
    });
  });

  it('a very large hand-over asks first: 不填了 ends the run with nothing filled, 继续填写 fills', async () => {
    const big = ProfileSchema.parse({
      schemaVersion: 1,
      resumes: [ResumeSchema.parse({ id: 'r1', title: '我的中文简历', locale: 'zh-CN', education: Array.from({ length: 12 }, (_, i) => ({ school: `示例大学 ${i}` })) })],
      activeResumeId: 'r1',
      settings: { uiLanguage: 'zh' },
    });
    const r = await renderBrowser({ profile: big });
    r.native.deliver = (o) => {
      const cmd = decodeAppCommand(o.data);
      if (!cmd) return true;
      r.commands.push({ frame: o.frame, cmd });
      const reply =
        cmd.kind === 'needs'
          ? { v: 1, kind: 'needs', reqId: cmd.reqId, needs: { fieldKeys: [], repeatSections: ['education'], attachmentKeys: [] } }
          : cmd.kind === 'fill'
            ? { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url: HTTPS, startedAt: 1, finishedAt: 2, fields: REPORT_ROWS, counts: countOutcomes(REPORT_ROWS) } }
            : null;
      if (reply) void Promise.resolve().then(() => act(() => r.native.emit('message', { frame: o.frame, generation: 1, origin: ORIGIN, main: true, data: JSON.stringify(reply) })));
      return true;
    };
    load(r);
    checkIn(r);
    act(() => r.native.emit('fabTap', {}));
    let ask = await screen.findByRole('dialog', { name: '这个页面要的内容特别多' }, WAIT);
    fireEvent.click(within(ask).getByRole('button', { name: '不填了' }));
    await waitFor(() => expect(r.session.getState().run.phase).toBe('idle'), WAIT);
    expect(screen.queryByRole('dialog', { name: '这个页面要的内容特别多' })).toBeNull();
    expect(r.commands.filter((c) => c.cmd.kind === 'fill')).toHaveLength(0);
    act(() => r.native.emit('fabTap', {}));
    ask = await screen.findByRole('dialog', { name: '这个页面要的内容特别多' }, WAIT);
    fireEvent.click(within(ask).getByRole('button', { name: '继续填写' }));
    await screen.findByRole('dialog', { name: '填写报告' }, WAIT);
    expect(r.commands.filter((c) => c.cmd.kind === 'fill')).toHaveLength(1);
  });
});

describe('BrowserScreen: report by reason, locate bar, sensitive fields, auto-advance', () => {
  const ROWS: FieldReport[] = [
    { ...row('n1', '姓名', 'filled', '张三'), section: 'basics' },
    { ...row('s1', '学校', 'needs_review', '星河理工'), section: 'education', entry: 0, note: 'picked_other_name', observed: '星河理工' },
    { ...row('id', '证件号码', 'needs_review'), section: 'basics', fieldKey: 'basics.idNumber', note: 'sensitive_held' },
    { ...row('o1', '期望城市', 'no_option'), section: 'jobIntention' },
    { ...row('d1', 'QQ', 'no_data'), section: 'basics' },
    { ...row('d2', '专业排名', 'no_data'), section: 'education', entry: 0 },
    { ...row('d3', 'GPA', 'no_data'), section: 'education', entry: 1 },
  ];

  it('待你看 is split by reason; a row says its entry and why; a picked name is shown', async () => {
    const r = await renderBrowser({ rows: ROWS });
    const sheet = await runFill(r);
    const heads = within(sheet).getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.trim());
    expect(heads).toEqual(['待确认2', '没有匹配的选项1']);
    expect(within(sheet).getByText('教育经历 · 第 1 条')).toBeTruthy();
    expect(within(sheet).getByText('选了「星河理工」，和简历写法不同')).toBeTruthy();
  });

  it('a located row folds the report into a bar that walks the tab: previous, next, where it is, back to the list', async () => {
    const r = await renderBrowser({ rows: ROWS });
    const sheet = await runFill(r);
    fireEvent.click(within(sheet).getByRole('tab', { name: '跳过 3' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '在网页上找到「专业排名」' }));
    const bar = await screen.findByTestId('m-locate-bar');
    expect(within(bar).getByText('第 2 个，共 3 个跳过的格子')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: '下一个' }));
    await waitFor(() => expect(within(bar).getByText('第 3 个，共 3 个跳过的格子')).toBeTruthy(), WAIT);
    expect((within(bar).getByRole('button', { name: '下一个' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(r.commands.filter((c) => c.cmd.kind === 'focus').map((c) => (c.cmd as { fieldId: string }).fieldId)).toEqual(['d2', 'd3']), WAIT);
    fireEvent.click(within(bar).getByRole('button', { name: '列表' }));
    expect(within(sheet).getByRole('tab', { name: '跳过 3' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: '去简历里补上' }));
    expect(r.onGoToResume).toHaveBeenCalledTimes(1);
  });

  it('a held-back id number offers 「这次填上」, which fills only that field, and 「改设置」', async () => {
    const onSensitiveFields = vi.fn();
    const r = await renderBrowser({ rows: ROWS, extra: { onSensitiveFields, sensitiveFields: 'remind' } });
    const sheet = await runFill(r);
    expect(within(sheet).getByText('只提醒，没有写入')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '这次填上' }));
    await waitFor(() => expect(r.commands.filter((c) => c.cmd.kind === 'fill')).toHaveLength(2), WAIT);
    const one = r.commands.filter((c) => c.cmd.kind === 'fill')[1]!.cmd as { only?: string[]; sensitiveFields?: string };
    expect([one.only, one.sensitiveFields]).toEqual([['id'], 'fill']);
    await waitFor(() => expect(within(sheet).getByRole('tab', { name: '已填 2' })).toBeTruthy(), WAIT);

    fireEvent.click(within(sheet).getByRole('tab', { name: '待你看 2' }));
    expect(within(sheet).queryByRole('button', { name: '这次填上' })).toBeNull();
  });

  it('「改设置」 opens the choice over the page; choosing calls back with the mode', async () => {
    const onSensitiveFields = vi.fn();
    const r = await renderBrowser({ rows: ROWS, extra: { onSensitiveFields, sensitiveFields: 'remind' } });
    const sheet = await runFill(r);
    fireEvent.click(within(sheet).getByRole('button', { name: '改设置' }));
    const choice = await screen.findByRole('dialog', { name: '敏感字段怎么填' });
    fireEvent.click(within(choice).getByRole('radio', { name: /直接填/ }));
    expect(onSensitiveFields).toHaveBeenCalledWith('fill');
  });

  it('a page with a Next button is offered auto-advance; a new site asks first, and 开始 remembers the site', async () => {
    const onAdvanceSite = vi.fn();
    const r = await renderBrowser({ step: 'next', extra: { advanceSites: [], onAdvanceSite } });
    const sheet = await runFill(r);
    const offer = await within(sheet).findByTestId('m-advance-offer', {}, WAIT);
    expect(offer.textContent).toContain('这是多页表单，现在是第 1 步：基本信息。');
    fireEvent.click(within(offer).getByRole('button', { name: '自动前进到最后一页' }));
    const confirm = await screen.findByRole('dialog', { name: '自动前进到最后一页？' });
    expect(confirm.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(within(confirm).getByRole('button', { name: '开始' }));
    expect(onAdvanceSite).toHaveBeenCalledWith(ORIGIN);
    await waitFor(() => expect(r.commands.some((c) => c.cmd.kind === 'press')).toBe(true), WAIT);
  });

  it('on a site agreed before it starts at once, and the report comes back with why it stopped', async () => {
    const r = await renderBrowser({ step: 'next', extra: { advanceSites: [ORIGIN] } });
    const sheet = await runFill(r);
    fireEvent.click(await within(sheet).findByRole('button', { name: '自动前进到最后一页' }, WAIT));
    expect(screen.queryByRole('dialog', { name: '自动前进到最后一页？' })).toBeNull();
    const stopped = await screen.findByTestId('m-advance-stop', {}, WAIT);
    expect(stopped.textContent).toContain('已到最后一页。请逐页核对，确认无误后自己提交。');
  });

  it('a stop that needs the person shows only what to do; 看这一页的结果 opens the full report and stays open', async () => {
    const r = await renderBrowser({ step: 'next', press: 'needs_you', extra: { advanceSites: [ORIGIN] } });
    const sheet = await runFill(r);
    fireEvent.click(await within(sheet).findByRole('button', { name: '自动前进到最后一页' }, WAIT));
    const stopped = await screen.findByTestId('m-advance-stopped', {}, WAIT);
    expect(stopped.textContent).toContain('第 1 步 · 已前进 0 步');
    expect(screen.getByRole('dialog', { name: '已停下' })).toBeTruthy();
    fireEvent.click(within(stopped).getByRole('button', { name: '看这一页的结果' }));
    // The page rescans (the screen renders again): the full report stays open.
    act(() => r.native.emit('message', { frame: 1, generation: 1, origin: ORIGIN, main: true, data: JSON.stringify({ v: 1, kind: 'scan', count: 9, iframes: 0 }) }));
    const full = await screen.findByRole('dialog', { name: '填写报告' });
    expect(within(full).getByRole('tablist')).toBeTruthy();
    expect(within(full).getByRole('button', { name: '处理好了，继续' })).toBeTruthy();
  });

  it('the last page offers nothing', async () => {
    const r = await renderBrowser({ step: 'final' });
    const sheet = await runFill(r);
    await waitFor(() => expect(r.commands.some((c) => c.cmd.kind === 'step')).toBe(true), WAIT);
    expect(within(sheet).queryByTestId('m-advance-offer')).toBeNull();
  });
});
