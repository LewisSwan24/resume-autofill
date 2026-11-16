// The setup screen 「简历输入法」: status read back, the explanation before Android's
// warning, the two steps, the practice field that keeps nothing, the data switch and the modules row.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMemo, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KeyboardSetupScreen } from '../../../../mobile/app/src/keyboard/KeyboardSetupScreen';
import { useKeyboardStatus } from '../../../../mobile/app/src/keyboard/useKeyboardStatus';
import { createFakeResumeKeyboard, type FakeResumeKeyboard } from '../../../../mobile/app/src/native/resumeKeyboard';
import { defaultAppState, type AppState } from '../../../../mobile/app/src/store/appStateStore';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const WAIT = { timeout: 3000 };

const filled = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: '中文简历', locale: 'zh-CN', basics: { familyName: '张', givenName: '三' } })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });
const empty = (): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: '中文简历', locale: 'zh-CN' })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });

let latest: AppState;
let failing = false;
let toasts: string[] = [];
let backs = 0;

function Harness({ kb, initial, profile, syncFailed, plugin = true }: { kb: FakeResumeKeyboard; initial: AppState; profile: Profile | null; syncFailed?: boolean; plugin?: boolean }) {
  const native = plugin ? kb : null;
  const kbStatus = useKeyboardStatus(native);
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const backStack = useMemo(() => createBackStack(), []);
  latest = state;
  return (
    <BackStackContext.Provider value={backStack}>
      <KeyboardSetupScreen
        onBack={() => (backs += 1)}
        keyboard={native ? { native, status: kbStatus.status, error: kbStatus.error, refresh: kbStatus.refresh, syncFailed: Boolean(syncFailed) } : null}
        profile={profile}
        appState={state}
        updateAppState={async (change) => {
          const before = ref.current;
          ref.current = change(before);
          setState(ref.current);
          await Promise.resolve();
          if (failing) {
            ref.current = before;
            setState(before);
            return false;
          }
          return true;
        }}
        showToast={(m) => toasts.push(m.text)}
      />
    </BackStackContext.Provider>
  );
}

function setup(o: { kb?: FakeResumeKeyboard; state?: AppState; profile?: Profile | null; syncFailed?: boolean; plugin?: boolean } = {}) {
  const kb = o.kb ?? createFakeResumeKeyboard();
  const initial = o.state ?? defaultAppState({ onboardingDone: true });
  const view = render(<Harness kb={kb} initial={initial} profile={o.profile === undefined ? filled() : o.profile} syncFailed={o.syncFailed} plugin={o.plugin} />);
  return { kb, initial, view };
}

const statusCard = () => screen.getByRole('status', { name: '当前状态' });
const step1Button = () => screen.getByRole('button', { name: '去系统设置启用' });
const step2Button = () => screen.getByRole('button', { name: '选择输入法' });

beforeEach(() => {
  setLanguage('zh');
  failing = false;
  toasts = [];
  backs = 0;
});
afterEach(cleanup);

describe('KeyboardSetupScreen: status', () => {
  it('while the first read is pending it says so and every button is disabled', async () => {
    const kb = createFakeResumeKeyboard();
    kb.status = () => new Promise(() => undefined);
    setup({ kb });
    expect(screen.getByRole('heading', { level: 1, name: '简历输入法' })).toBeTruthy();
    expect(within(statusCard()).getByText('正在查看状态…')).toBeTruthy();
    expect((step1Button() as HTMLButtonElement).disabled).toBe(true);
    expect((step2Button() as HTMLButtonElement).disabled).toBe(true);
  });

  it('not enabled: 还没启用', async () => {
    setup();
    await waitFor(() => expect(within(statusCard()).getByText('还没启用')).toBeTruthy(), WAIT);
    expect((step1Button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('enabled: 已启用，还没切换过去; current: 正在使用简历输入法', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true });
    setup({ kb });
    await waitFor(() => expect(within(statusCard()).getByText('已启用，还没切换过去')).toBeTruthy(), WAIT);
    act(() => kb.setState({ current: true }));
    await waitFor(() => expect(within(statusCard()).getByText('正在使用简历输入法')).toBeTruthy(), WAIT);
    expect(screen.getByText('已经在用了')).toBeTruthy();
    expect(step2Button()).toBeTruthy(); // still there, to switch back from here too
  });

  it('a failed read says so and leaves the buttons usable', async () => {
    const kb = createFakeResumeKeyboard();
    kb.status = async () => {
      throw new Error('boom');
    };
    setup({ kb });
    await waitFor(() => expect(within(statusCard()).getByText('读不出输入法的状态，稍后再试。')).toBeTruthy(), WAIT);
    expect((step1Button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('without the plugin it says the feature needs the phone and shows no buttons', async () => {
    setup({ plugin: false });
    expect(within(statusCard()).getByText('这个功能要在安卓手机上用')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '去系统设置启用' })).toBeNull();
    expect(screen.queryByRole('button', { name: '选择输入法' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(backs).toBe(1);
  });

  it('follows a state change without a remount', async () => {
    const { kb } = setup();
    await waitFor(() => expect(within(statusCard()).getByText('还没启用')).toBeTruthy(), WAIT);
    const heading = screen.getByRole('heading', { level: 1 });
    act(() => kb.setState({ enabled: true }));
    await waitFor(() => expect(within(statusCard()).getByText('已启用，还没切换过去')).toBeTruthy(), WAIT);
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
  });
});

describe('KeyboardSetupScreen: step 1', () => {
  it('explains what the keyboard does before the button that leads to Android’s warning', async () => {
    setup();
    await waitFor(() => expect((step1Button() as HTMLButtonElement).disabled).toBe(false), WAIT);
    const button = step1Button();
    const before = screen.getByText((text) => text.startsWith('启用时，安卓会提醒这个输入法'));
    const promises = screen.getByRole('list', { name: '简历输入法的做法' });
    const items = within(promises).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.trim())).toEqual([ // the svg markup carries whitespace
      '只读这台手机上专门为输入法准备的一份简历，用来显示能点的条目。这份简历同样加密保存，不含附件。',
      '不联网。你打的字、点进去的内容都不会离开这台手机。',
      '不记录、不学习你打的字，也没有联想词。',
      '在密码框里和锁屏时，只显示字母键盘，不显示简历。',
    ]);
    for (const node of [before, ...items]) {
      expect(node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('opens the system settings, and says where to look when it cannot', async () => {
    const { kb } = setup();
    await waitFor(() => expect((step1Button() as HTMLButtonElement).disabled).toBe(false), WAIT);
    fireEvent.click(step1Button());
    await waitFor(() => expect(kb.calls.some((c) => c.method === 'openInputMethodSettings')).toBe(true), WAIT);
    expect(toasts).toEqual([]);
    kb.openInputMethodSettings = async () => ({ opened: false });
    fireEvent.click(step1Button());
    await waitFor(() => expect(toasts).toEqual(['没能打开系统设置。请在系统设置里找「语言和输入法」或「屏幕键盘」。']), WAIT);
  });

  it('once enabled shows 已启用 and a quieter way back to the settings', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true });
    setup({ kb });
    await waitFor(() => expect(screen.getByRole('button', { name: '在系统设置里查看' })).toBeTruthy(), WAIT);
    expect(screen.queryByRole('button', { name: '去系统设置启用' })).toBeNull();
    expect(screen.getByText('已启用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '在系统设置里查看' }));
    await waitFor(() => expect(kb.calls.some((c) => c.method === 'openInputMethodSettings')).toBe(true), WAIT);
  });
});

describe('KeyboardSetupScreen: step 2', () => {
  it('is disabled with the reason until enabled, then opens the picker', async () => {
    const { kb } = setup();
    await waitFor(() => expect(within(statusCard()).getByText('还没启用')).toBeTruthy(), WAIT);
    const button = step2Button() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('先完成第 1 步');
    act(() => kb.setState({ enabled: true }));
    await waitFor(() => expect((step2Button() as HTMLButtonElement).disabled).toBe(false), WAIT);
    expect(screen.queryByText('先完成第 1 步')).toBeNull();
    fireEvent.click(step2Button());
    await waitFor(() => expect(kb.calls.some((c) => c.method === 'showPicker')).toBe(true), WAIT);
  });
});

describe('KeyboardSetupScreen: try it', () => {
  it('the practice field is labelled and what is typed is kept nowhere', async () => {
    const { kb, initial, view } = setup();
    const field = screen.getByRole('textbox', { name: '试用输入框' }) as HTMLInputElement;
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.placeholder).toBe('点这里，再点键盘上的「姓名」');
    fireEvent.change(field, { target: { value: '张三' } });
    expect(field.value).toBe('张三');
    expect(latest).toEqual(initial);
    expect(toasts).toEqual([]);
    expect(kb.calls.filter((c) => c.method !== 'status')).toEqual([]);
    view.unmount();
    setup({ kb });
    expect((screen.getByRole('textbox', { name: '试用输入框' }) as HTMLInputElement).value).toBe('');
  });

  it('says when the resume is empty', async () => {
    setup({ profile: empty() });
    expect(screen.getByText('简历还空着，键盘上暂时没有条目。先去「简历」页填几项。')).toBeTruthy();
  });

  it('says the keyboard has letters only while the data is off', async () => {
    setup({ state: defaultAppState({ onboardingDone: true, keyboard: { show: false, hidden: [] } }) });
    expect(screen.getByText('「在输入法里显示简历」关着，键盘上只有字母。')).toBeTruthy();
    expect(screen.queryByText('简历还空着，键盘上暂时没有条目。先去「简历」页填几项。')).toBeNull();
  });

  it('notes that Chinese needs the usual keyboard', async () => {
    setup();
    expect(screen.getByText('简历输入法只能打英文、数字和符号。要打中文，点切换键回到你常用的输入法。')).toBeTruthy();
  });
});

describe('KeyboardSetupScreen: settings', () => {
  it('the switch writes keyboard.show', async () => {
    setup();
    const sw = screen.getByRole('switch', { name: '在输入法里显示简历' }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    await waitFor(() => expect(latest.keyboard.show).toBe(false), WAIT);
    expect((screen.getByRole('switch', { name: '在输入法里显示简历' }) as HTMLInputElement).checked).toBe(false);
  });

  it('a failed save toasts and the switch goes back', async () => {
    setup();
    failing = true;
    fireEvent.click(screen.getByRole('switch', { name: '在输入法里显示简历' }));
    await waitFor(() => expect(toasts).toEqual(['没能保存，请再试一次。']), WAIT);
    expect((screen.getByRole('switch', { name: '在输入法里显示简历' }) as HTMLInputElement).checked).toBe(true);
    expect(latest.keyboard.show).toBe(true);
  });

  it('the modules row shows what is hidden, opens the sheet, and is disabled while the data is off', async () => {
    setup({ state: defaultAppState({ onboardingDone: true, keyboard: { show: true, hidden: ['education', 'links'] } }) });
    const row = screen.getByRole('button', { name: /^输入法里显示哪些内容/ }) as HTMLButtonElement;
    expect(within(row).getByText('藏起了 2 类')).toBeTruthy();
    expect(row.disabled).toBe(false);
    fireEvent.click(row);
    expect(screen.getByRole('dialog', { name: '输入法里显示的内容' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('switch', { name: '在输入法里显示简历' }));
    await waitFor(() => expect((screen.getByRole('button', { name: /^输入法里显示哪些内容/ }) as HTMLButtonElement).disabled).toBe(true), WAIT);
  });

  it('shows 全部 when nothing is hidden', async () => {
    setup();
    expect(within(screen.getByRole('button', { name: /^输入法里显示哪些内容/ })).getByText('全部')).toBeTruthy();
  });

  it('the sync-failed notice appears only with syncFailed', async () => {
    setup();
    expect(screen.queryByText('输入法里的简历没能更新，下次修改时会再试。')).toBeNull();
    cleanup();
    setup({ syncFailed: true });
    expect(screen.getByText('输入法里的简历没能更新，下次修改时会再试。')).toBeTruthy();
  });
});
