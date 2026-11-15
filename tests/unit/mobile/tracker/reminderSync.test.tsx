// Keeping the native reminder list in step with app state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createFakeReminders } from '../../../../mobile/app/src/native/reminders';
import { ApplicationRecordSchema, defaultAppState, type AppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { deleteRecord, setRemind } from '../../../../mobile/app/src/tracker/model/records';
import { useReminderSync } from '../../../../mobile/app/src/tracker/useReminderSync';
import type { Language } from '../../../../src/i18n';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-15T04:00:00Z');

const rec = (id: string, o: Partial<ApplicationRecord> = {}): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    id,
    url: `https://jobs.example.com/${id}`,
    host: 'jobs.example.com',
    company: '示例科技',
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    deadline: { date: '2026-11-20' },
    remind: true,
    ...o,
  });

const base = defaultAppState({ applications: [rec('a'), rec('b', { deadline: { date: '2026-11-22' } })] });

type Props = { appState: AppState | null; language: Language };

function setup(native = createFakeReminders({ permission: 'granted' }), initial: Props = { appState: base, language: 'zh' }) {
  const hook = renderHook((p: Props) => useReminderSync({ native, appState: p.appState, language: p.language, now: () => NOW, timeZone: SH }), {
    initialProps: initial,
  });
  return { native, hook };
}

const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useReminderSync', () => {
  it('syncs the plan with translated texts after load', async () => {
    const { native, hook } = setup(undefined, { appState: null, language: 'zh' });
    await tick(2000);
    expect(native.synced).toHaveLength(0);
    hook.rerender({ appState: base, language: 'zh' });
    await tick(999);
    expect(native.synced).toHaveLength(0);
    await tick(1);
    expect(native.synced).toHaveLength(1);
    const payload = native.synced[0]!;
    expect(payload.entries.map((e) => e.id)).toEqual(['a:d1', 'a:d0', 'b:d1', 'b:d0']);
    expect(payload.entries[0]).toMatchObject({ title: '明天截止：示例科技', at: '2026-11-19T09:00', end: '2026-11-20T23:59' });
    expect(payload.publicText).toBe('有一个网申快截止了');
  });

  it('debounces changes', async () => {
    const { native, hook } = setup();
    await tick(1000);
    let s = base;
    for (let i = 0; i < 5; i += 1) {
      s = { ...s, reminders: { ...s.reminders, time: `1${i}:00` } };
      hook.rerender({ appState: s, language: 'zh' });
      await tick(300);
    }
    expect(native.synced).toHaveLength(1);
    await tick(1000);
    expect(native.synced).toHaveLength(2);
    expect(native.synced[1]!.entries[0]!.at).toBe('2026-11-19T14:00');
  });

  it('resyncs on a language change', async () => {
    const { native, hook } = setup();
    await tick(1000);
    hook.rerender({ appState: base, language: 'en' });
    await tick(1000);
    expect(native.synced).toHaveLength(2);
    expect(native.synced[1]!.entries[0]!.title).toBe('Due tomorrow: 示例科技');
    expect(native.synced[1]!.channel.name).toBe('Application deadlines');
  });

  it('does not sync an unchanged plan', async () => {
    const { native, hook } = setup();
    await tick(1000);
    hook.rerender({ appState: { ...base, onboardingDone: !base.onboardingDone }, language: 'zh' });
    await tick(1000);
    hook.rerender({ appState: { ...base, applications: base.applications.map((r) => ({ ...r, notes: '变了' })) }, language: 'zh' });
    await tick(1000);
    expect(native.synced).toHaveLength(1);
  });

  it('deleting a record syncs without its entries', async () => {
    const { native, hook } = setup();
    await tick(1000);
    hook.rerender({ appState: deleteRecord(base, 'a').state, language: 'zh' });
    await tick(1000);
    expect(native.synced.at(-1)!.entries.map((e) => e.recordId)).toEqual(['b', 'b']);
    hook.rerender({ appState: setRemind(deleteRecord(base, 'a').state, 'b', false, NOW), language: 'zh' });
    await tick(1000);
    expect(native.synced.at(-1)!.entries).toEqual([]);
  });

  it('a failed sync sets lastError and retries on the next change', async () => {
    const native = createFakeReminders({ permission: 'granted', failSync: true });
    const { hook } = setup(native);
    await tick(1000);
    expect(hook.result.current.lastError).toBe(true);
    expect(native.calls.filter((c) => c.method === 'sync')).toHaveLength(1);
    hook.rerender({ appState: { ...base, onboardingDone: !base.onboardingDone }, language: 'zh' });
    await tick(1000);
    expect(native.calls.filter((c) => c.method === 'sync')).toHaveLength(2);
  });

  it('no native (browser preview) does nothing', async () => {
    const hook = renderHook(() => useReminderSync({ native: null, appState: base, language: 'zh', now: () => NOW, timeZone: SH }));
    await tick(2000);
    expect(hook.result.current.lastError).toBe(false);
  });
});
