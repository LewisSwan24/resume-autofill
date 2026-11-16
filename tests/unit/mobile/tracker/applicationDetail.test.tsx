// One application's detail screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createFakeReminders, type RemindersPlugin } from '../../../../mobile/app/src/native/reminders';
import { ApplicationRecordSchema, defaultAppState, type AppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { ApplicationDetail } from '../../../../mobile/app/src/tracker/ApplicationDetail';
import { BackStackContext, Toast, createBackStack, type ToastMessage } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-15T04:00:00Z'); // 12:00 in Shanghai

const rec = (o: Partial<ApplicationRecord> = {}): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    id: 'a',
    url: 'https://jobs.example.com/apply',
    host: 'jobs.example.com',
    company: '示例科技',
    companyGuessed: true,
    statusAt: 1,
    createdAt: NOW - 5 * 86_400_000,
    openedAt: 1,
    updatedAt: 1,
    ...o,
  });

const profile: Profile = ProfileSchema.parse({
  schemaVersion: 1,
  resumes: [ResumeSchema.parse({ id: 'r1', title: '我的中文简历', locale: 'zh-CN', createdAt: 1, updatedAt: 1 })],
  activeResumeId: 'r1',
});

let latest: AppState;
let updates: number;
/** Every save fails (the vault write throws): the hook resolves false and the state stays as stored. */
let failing = false;
/** A change made elsewhere in the app while the detail is mounted (e.g. the page title landing on the record). */
let external: ((change: (s: AppState) => AppState) => void) | null = null;
const onBack = vi.fn<() => void>();
const onOpenPage = vi.fn<(r: ApplicationRecord) => void>();
const onMissing = vi.fn<() => void>();

function Harness({ initial, reminders, onPin, id = 'a' }: { initial: AppState; reminders: RemindersPlugin | null; onPin?: (r: ApplicationRecord) => void; id?: string }) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [shown, setShown] = useState(true);
  latest = state;
  external = (change) => {
    ref.current = change(ref.current);
    setState(ref.current);
  };
  return (
    <BackStackContext.Provider value={createBackStack()}>
      {shown ? (
        <ApplicationDetail
          id={id}
          appState={state}
          updateAppState={async (change) => {
            updates += 1;
            if (failing) return false;
            ref.current = change(ref.current);
            setState(ref.current);
            return true;
          }}
          profile={profile}
          reminders={reminders}
          onBack={() => {
            onBack();
            setShown(false);
          }}
          onOpenPage={onOpenPage}
          onMissing={onMissing}
          onPin={onPin}
          showToast={(t) => setToast({ ...t, id: Math.random() })}
          now={() => NOW}
          timeZone={SH}
        />
      ) : null}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </BackStackContext.Provider>
  );
}

const show = (record: ApplicationRecord, reminders: RemindersPlugin | null = null, extra: Partial<AppState> = {}, onPin?: (r: ApplicationRecord) => void) =>
  render(<Harness initial={defaultAppState({ applications: [record], ...extra })} reminders={reminders} onPin={onPin} />);

const stored = () => latest.applications[0]!;
const reminderSwitch = () => screen.getByRole('switch', { name: '截止前提醒我' }) as HTMLInputElement;

beforeEach(() => {
  setLanguage('zh');
  updates = 0;
  failing = false;
  external = null;
  onBack.mockReset();
  onOpenPage.mockReset();
  onMissing.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ApplicationDetail', () => {
  it('company edit saves after 500 ms and on back, and drops the guess hint', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(rec());
    expect(screen.getByRole('heading', { level: 1, name: '示例科技' })).toBeTruthy();
    expect(screen.getByText('根据网页猜的，可以改')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('公司'), { target: { value: '示例科技集团' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(stored().company).toBe('示例科技');
    await act(async () => vi.advanceTimersByTime(150));
    expect(stored()).toMatchObject({ company: '示例科技集团', companyGuessed: false });
    expect(screen.queryByText('根据网页猜的，可以改')).toBeNull();
    fireEvent.change(screen.getByLabelText('岗位'), { target: { value: '产品经理' } });
    fireEvent.click(screen.getByRole('button', { name: '返回网申记录' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stored().position).toBe('产品经理'));
  });

  it('notes save on blur', async () => {
    show(rec());
    const notes = screen.getByLabelText('备注');
    fireEvent.change(notes, { target: { value: '要准备作品集' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(stored().notes).toBe('要准备作品集'));
  });

  it('status radios save and announce', async () => {
    show(rec());
    const group = screen.getByRole('radiogroup', { name: '状态' });
    expect(within(group).getByRole('radio', { name: '想投' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: '已提交' }));
    await waitFor(() => expect(stored().status).toBe('submitted'));
    expect(screen.getByText('已改为「已提交」')).toBeTruthy();
  });

  it('deadline sheet: quick chips, optional time, past-date line, remove', async () => {
    show(rec());
    fireEvent.click(screen.getByRole('button', { name: /截止日期/ }));
    let sheet = await screen.findByRole('dialog', { name: '设置截止日期' });
    expect(within(sheet).queryByRole('button', { name: '去掉截止日期' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }));
    expect(within(sheet).getByText('请选一个日期。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '明天' }));
    expect((within(sheet).getByLabelText('日期') as HTMLInputElement).value).toBe('2026-11-16');
    fireEvent.click(within(sheet).getByRole('button', { name: '一周后' }));
    expect((within(sheet).getByLabelText('日期') as HTMLInputElement).value).toBe('2026-11-22');
    fireEvent.click(within(sheet).getByRole('button', { name: '18:00' }));
    expect((within(sheet).getByLabelText('时间（可不填）') as HTMLInputElement).value).toBe('18:00');
    fireEvent.change(within(sheet).getByLabelText('日期'), { target: { value: '2026-11-01' } });
    expect(within(sheet).getByText('这一天已经过去了，不会再提醒。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '今天' }));
    expect(within(sheet).queryByText('这一天已经过去了，不会再提醒。')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored().deadline).toEqual({ date: '2026-11-15', time: '18:00' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /截止日期.*11月15日 18:00/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /截止日期/ }));
    sheet = await screen.findByRole('dialog', { name: '设置截止日期' });
    fireEvent.change(within(sheet).getByLabelText('时间（可不填）'), { target: { value: '' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(stored().deadline).toEqual({ date: '2026-11-15' }));
    fireEvent.click(screen.getByRole('button', { name: /截止日期/ }));
    sheet = await screen.findByRole('dialog', { name: '设置截止日期' });
    fireEvent.click(within(sheet).getByRole('button', { name: '去掉截止日期' }));
    await waitFor(() => expect(stored().deadline).toBeUndefined());
  });

  it('no reminder toggle without a deadline', () => {
    show(rec());
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('先设截止日期，才能提醒。')).toBeTruthy();
  });

  it('first reminder: our sheet, then the system prompt; granted turns it on and sets defaultOn', async () => {
    const native = createFakeReminders({ permission: 'prompt', answer: 'granted' });
    show(rec({ deadline: { date: '2026-11-20' } }), native);
    expect(reminderSwitch().checked).toBe(false);
    expect(screen.getByText('前一天和当天 09:00')).toBeTruthy();
    fireEvent.click(reminderSwitch());
    const sheet = await screen.findByRole('dialog', { name: '允许发通知？' });
    expect(native.calls.map((c) => c.method)).not.toContain('requestPermission');
    fireEvent.click(within(sheet).getByRole('button', { name: '继续' }));
    await waitFor(() => expect(stored().remind).toBe(true));
    expect(native.calls.map((c) => c.method)).toContain('requestPermission');
    expect(latest.reminders.defaultOn).toBe(true);
    expect(reminderSwitch().checked).toBe(true);
    fireEvent.click(reminderSwitch());
    await waitFor(() => expect(stored().remind).toBe(false));
  });

  it('先不用 keeps it off without asking the system', async () => {
    const native = createFakeReminders({ permission: 'prompt' });
    show(rec({ deadline: { date: '2026-11-20' } }), native);
    fireEvent.click(reminderSwitch());
    const sheet = await screen.findByRole('dialog', { name: '允许发通知？' });
    fireEvent.click(within(sheet).getByRole('button', { name: '先不用' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored().remind).toBe(false);
    expect(native.calls.map((c) => c.method)).not.toContain('requestPermission');
  });

  it('already granted turns on at once', async () => {
    const native = createFakeReminders({ permission: 'granted' });
    show(rec({ deadline: { date: '2026-11-20' } }), native);
    fireEvent.click(reminderSwitch());
    await waitFor(() => expect(stored().remind).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('denied keeps it off with a toast', async () => {
    const native = createFakeReminders({ permission: 'prompt', answer: 'denied' });
    show(rec({ deadline: { date: '2026-11-20' } }), native);
    fireEvent.click(reminderSwitch());
    fireEvent.click(within(await screen.findByRole('dialog', { name: '允许发通知？' })).getByRole('button', { name: '继续' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('没有通知权限，提醒先关上了。'));
    expect(stored().remind).toBe(false);
    expect(reminderSwitch().checked).toBe(false);
  });

  it('notifications off shows the line and 去系统设置', async () => {
    const native = createFakeReminders({ permission: 'granted', enabled: false });
    show(rec({ deadline: { date: '2026-11-20' } }), native);
    fireEvent.click(reminderSwitch());
    expect(await screen.findByText('通知没有打开，提醒发不出来。')).toBeTruthy();
    expect(stored().remind).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '去系统设置打开' }));
    await waitFor(() => expect(native.calls.map((c) => c.method)).toContain('openSettings'));
  });

  it('已提交 disables the reminder toggle', () => {
    show(rec({ status: 'submitted', deadline: { date: '2026-11-20' }, remind: true }), createFakeReminders({ permission: 'granted' }));
    expect(reminderSwitch().disabled).toBe(true);
    expect(screen.getByText('已提交或结束的网申不再提醒')).toBeTruthy();
  });

  it('history rows: counts, resume title with language, deleted resume, 已撤销', () => {
    const history = [
      { at: Date.parse('2026-11-14T12:31:00Z'), resumeId: 'r1', locale: 'zh-CN', filled: 12, attention: 3, skipped: 5, undone: false },
      { at: Date.parse('2026-11-13T02:05:00Z'), resumeId: 'gone', locale: 'en', filled: 4, attention: 0, skipped: 1, undone: true },
    ];
    show(rec({ history }));
    const list = screen.getByRole('list', { name: '填写记录' });
    const items = within(list).getAllByRole('listitem');
    expect(within(items[0]!).getByText('11月14日 20:31')).toBeTruthy();
    expect(within(items[0]!).getByText('用「我的中文简历」')).toBeTruthy();
    expect(within(items[0]!).getByText('中')).toBeTruthy();
    expect(within(items[0]!).getByText('已填 12 · 待你看 3 · 跳过 5')).toBeTruthy();
    expect(within(items[0]!).queryByText('已撤销')).toBeNull();
    expect(within(items[1]!).getByText('用的简历已删除')).toBeTruthy();
    expect(within(items[1]!).getByText('已撤销')).toBeTruthy();
    expect(screen.getByText('记录于 11月10日')).toBeTruthy();
  });

  it('empty history says so', () => {
    show(rec());
    expect(screen.getByText('还没在这个页面填写过。')).toBeTruthy();
  });

  it('delete goes back with an undo toast; undo restores', async () => {
    show(rec());
    fireEvent.click(screen.getByRole('button', { name: '删除这条记录' }));
    await waitFor(() => expect(latest.applications).toEqual([]));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onMissing).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('已删除「示例科技」的网申记录');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(latest.applications.map((r) => r.id)).toEqual(['a']));
  });

  it('pin only when supported', () => {
    show(rec());
    expect(screen.queryByRole('button', { name: '添加到桌面' })).toBeNull();
    cleanup();
    const onPin = vi.fn();
    show(rec(), null, {}, onPin);
    fireEvent.click(screen.getByRole('button', { name: '添加到桌面' }));
    expect(onPin).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('http record shows the insecure line; the page button opens the page; the link sheet copies', async () => {
    show(rec({ url: 'http://jobs.example.com/apply' }));
    expect(screen.getByText('这个页面没有加密（http），填写时多留意。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开网申页面' }));
    expect(onOpenPage).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: '链接操作：jobs.example.com' }));
    const sheet = await screen.findByRole('dialog', { name: '网申链接' });
    expect(within(sheet).getByText('http://jobs.example.com/apply')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '复制链接' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://jobs.example.com/apply'));
  });

  it('a missing record calls onMissing', async () => {
    render(<Harness initial={defaultAppState()} reminders={null} id="nope" />);
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('ApplicationDetail – edge cases', () => {
  it('a change to the record while the detail is mounted shows in an untouched field and is not written back', async () => {
    show(rec({ company: 'example', companyGuessed: true }));
    expect((screen.getByLabelText('公司') as HTMLInputElement).value).toBe('example');
    // The page opened from here got its title: the record's guess improves underneath the detail.
    act(() => external!((s) => ({ ...s, applications: s.applications.map((r) => ({ ...r, company: '示例科技', title: '示例科技校园招聘' })) })));
    expect((screen.getByLabelText('公司') as HTMLInputElement).value).toBe('示例科技');
    const before = updates;
    fireEvent.click(screen.getByRole('button', { name: '返回网申记录' }));
    await act(async () => undefined);
    expect(updates).toBe(before);
    expect(stored()).toMatchObject({ company: '示例科技', companyGuessed: true });
  });

  it('a field being typed in keeps what the person typed when the record changes underneath', async () => {
    show(rec({ company: 'example', notes: '' }));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '要准备作品集' } });
    act(() => external!((s) => ({ ...s, applications: s.applications.map((r) => ({ ...r, company: '示例科技' })) })));
    expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe('要准备作品集');
    fireEvent.click(screen.getByRole('button', { name: '返回网申记录' }));
    await waitFor(() => expect(stored().notes).toBe('要准备作品集'));
    expect(stored()).toMatchObject({ company: '示例科技', companyGuessed: true });
  });

  it('a failed status save says so, and the live region does not claim the change', async () => {
    show(rec());
    failing = true;
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '状态' })).getByRole('radio', { name: '已提交' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('没能保存，请再试一次。'));
    expect(screen.queryByText('已改为「已提交」')).toBeNull();
    expect(stored().status).toBe('wish');
  });

  it('a failed text save says so and the field goes back to the stored value', async () => {
    show(rec({ company: '示例科技', companyGuessed: false }));
    failing = true;
    const box = screen.getByLabelText('公司') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '示例银行' } });
    fireEvent.blur(box);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('没能保存，请再试一次。'));
    expect(box.value).toBe('示例科技');
  });

  it('a failed deadline or reminder save says so', async () => {
    show(rec({ deadline: { date: '2026-11-20' } }), createFakeReminders({ permission: 'granted', enabled: true }));
    failing = true;
    fireEvent.click(reminderSwitch());
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('没能保存，请再试一次。'));
    expect(stored().remind).toBe(false);
  });

  it('a failed delete says so instead of 已删除', async () => {
    show(rec());
    failing = true;
    fireEvent.click(screen.getByRole('button', { name: '删除这条记录' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('没能保存，请再试一次。'));
    expect(screen.getByRole('status').textContent).not.toContain('已删除');
    expect(latest.applications.map((r) => r.id)).toEqual(['a']);
  });

  it('the notifications-off line goes away once they are switched on in system settings and the app comes back', async () => {
    const native = createFakeReminders({ permission: 'denied', enabled: false });
    show(rec({ deadline: { date: '2026-11-20' }, remind: true }), native);
    expect(await screen.findByText('通知没有打开，提醒发不出来。', undefined, { timeout: 4000 })).toBeTruthy();
    native.permission = 'granted';
    native.enabled = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.queryByText('通知没有打开，提醒发不出来。')).toBeNull(), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: '去系统设置打开' })).toBeNull();
  });

  it('with both reminder days unticked in Settings, the detail says reminders are off there', () => {
    show(rec({ deadline: { date: '2026-11-20' }, remind: true }), createFakeReminders({ permission: 'granted' }), {
      reminders: { time: '09:00', dayBefore: false, dayOf: false, defaultOn: true },
    });
    expect(screen.getByText('设置里的两天都没选，不会提醒')).toBeTruthy();
    expect(screen.queryByText('不提醒')).toBeNull();
  });
});
