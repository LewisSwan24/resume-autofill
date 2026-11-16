// Settings › 截止提醒.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createFakeReminders, type RemindersPlugin } from '../../../../mobile/app/src/native/reminders';
import { ApplicationRecordSchema, defaultAppState, type AppState } from '../../../../mobile/app/src/store/appStateStore';
import { ReminderSettingsSheet } from '../../../../mobile/app/src/tracker/ReminderSettingsSheet';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';

let latest: AppState;
let failing = false;
let toasts: string[] = [];

function Harness({ initial, reminders, syncFailed }: { initial: AppState; reminders: RemindersPlugin | null; syncFailed?: boolean }) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  latest = state;
  return (
    <BackStackContext.Provider value={createBackStack()}>
      <ReminderSettingsSheet
        open
        onClose={() => undefined}
        appState={state}
        updateAppState={async (change) => {
          if (failing) return false;
          ref.current = change(ref.current);
          setState(ref.current);
          return true;
        }}
        reminders={reminders}
        showToast={(m) => toasts.push(m.text)}
        syncFailed={syncFailed}
      />
    </BackStackContext.Provider>
  );
}

const withReminders = defaultAppState({
  applications: [
    ApplicationRecordSchema.parse({
      id: 'a',
      url: 'https://jobs.example.com/a',
      host: 'jobs.example.com',
      statusAt: 1,
      createdAt: 1,
      openedAt: 1,
      updatedAt: 1,
      deadline: { date: '2026-11-20' },
      remind: true,
    }),
  ],
});

beforeEach(() => {
  setLanguage('zh');
  failing = false;
  toasts = [];
});
afterEach(cleanup);

describe('ReminderSettingsSheet', () => {
  it('time and day options save', async () => {
    render(<Harness initial={defaultAppState()} reminders={createFakeReminders({ permission: 'granted' })} />);
    const sheet = screen.getByRole('dialog', { name: '截止提醒' });
    const time = within(sheet).getByLabelText('提醒时间') as HTMLInputElement;
    expect(time.value).toBe('09:00');
    fireEvent.click(within(sheet).getByRole('button', { name: '20:00' }));
    await waitFor(() => expect(latest.reminders.time).toBe('20:00'));
    fireEvent.change(time, { target: { value: '07:30' } });
    await waitFor(() => expect(latest.reminders.time).toBe('07:30'));
    fireEvent.change(time, { target: { value: '' } });
    expect(latest.reminders.time).toBe('07:30');
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '截止前一天' }));
    await waitFor(() => expect(latest.reminders.dayBefore).toBe(false));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '截止当天' }));
    await waitFor(() => expect(latest.reminders.dayOf).toBe(false));
    expect(within(sheet).getByText('截止时间早于提醒时间时，当天的提醒提前到截止前 2 小时。')).toBeTruthy();
    expect(within(sheet).getByText('系统可能会晚几分钟提醒。')).toBeTruthy();
    // Both days unticked: no count, the sheet says nothing will be reminded.
    expect(within(sheet).getByText('两天都没选，所有网申都不会提醒。')).toBeTruthy();
  });

  it('permission line and 去系统设置', async () => {
    const off = createFakeReminders({ permission: 'denied' });
    render(<Harness initial={withReminders} reminders={off} syncFailed />);
    expect(await screen.findByText('通知：没有打开')).toBeTruthy();
    expect(screen.getByText('已为 1 个网申设了提醒')).toBeTruthy();
    expect(screen.getByText('提醒没能设好，下次改动时会再试。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '去系统设置打开' }));
    await waitFor(() => expect(off.calls.map((c) => c.method)).toContain('openSettings'));
    cleanup();
    render(<Harness initial={withReminders} reminders={createFakeReminders({ permission: 'granted' })} />);
    expect(await screen.findByText('通知：已允许')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '去系统设置打开' })).toBeNull();
  });

  it('browser preview shows the phone-only line', () => {
    render(<Harness initial={defaultAppState()} reminders={null} />);
    expect(screen.getByText('提醒要在手机上才能用。')).toBeTruthy();
    expect(screen.queryByLabelText('提醒时间')).toBeNull();
  });
});

describe('ReminderSettingsSheet – edge cases', () => {
  it('with both days unticked it says nothing will be reminded, not a count', async () => {
    render(<Harness initial={withReminders} reminders={createFakeReminders({ permission: 'granted' })} />);
    const sheet = screen.getByRole('dialog', { name: '截止提醒' });
    expect(within(sheet).getByText('已为 1 个网申设了提醒')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '截止前一天' }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '截止当天' }));
    await waitFor(() => expect(within(sheet).getByText('两天都没选，所有网申都不会提醒。')).toBeTruthy());
    expect(within(sheet).queryByText('已为 1 个网申设了提醒')).toBeNull();
  });

  it('the permission line follows status() when the app comes back from system settings', async () => {
    const native = createFakeReminders({ permission: 'denied', enabled: false });
    render(<Harness initial={withReminders} reminders={native} />);
    const sheet = screen.getByRole('dialog', { name: '截止提醒' });
    expect(await within(sheet).findByText('通知：没有打开', undefined, { timeout: 4000 })).toBeTruthy();
    native.permission = 'granted';
    native.enabled = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await within(sheet).findByText('通知：已允许', undefined, { timeout: 4000 })).toBeTruthy();
  });

  it('a failed save says so', async () => {
    render(<Harness initial={withReminders} reminders={createFakeReminders({ permission: 'granted' })} />);
    failing = true;
    fireEvent.click(within(screen.getByRole('dialog', { name: '截止提醒' })).getByRole('button', { name: '20:00' }));
    await waitFor(() => expect(toasts).toContain('没能保存，请再试一次。'));
  });
});
