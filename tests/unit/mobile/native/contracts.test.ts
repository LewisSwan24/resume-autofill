// @vitest-environment node
// The fakes of the native contracts (mobile/app/src/native/*) behave like the plugins they stand in for.
import { describe, expect, it } from 'vitest';
import { createFakeIncomingIntent } from '../../../../mobile/app/src/native/incomingIntent';
import { createFakeClipboard } from '../../../../mobile/app/src/native/clipboardPeek';
import { createFakeReminders, type ReminderSyncPayload } from '../../../../mobile/app/src/native/reminders';
import { createFakeShortcuts } from '../../../../mobile/app/src/native/appShortcuts';
import { createFakeBrowserRole } from '../../../../mobile/app/src/native/browserRole';

describe('native contract fakes', () => {
  it('fake incoming intent gives a delivered payload once, then none', async () => {
    const fake = createFakeIncomingIntent();
    let fired = 0;
    const handle = await fake.addListener('incomingIntent', () => {
      fired += 1;
    });
    expect(await fake.take()).toEqual({ state: 'none' });
    fake.deliver({ state: 'ready', kind: 'view', url: 'https://example.com/a' });
    fake.deliver({ state: 'ready', kind: 'view', url: 'https://example.com/b' });
    expect(fired).toBe(2);
    expect(await fake.take()).toEqual({ state: 'ready', kind: 'view', url: 'https://example.com/b' });
    expect(await fake.take()).toEqual({ state: 'none' });
    expect(fake.takes).toBe(3);
    await handle.remove();
    fake.deliver({ state: 'ready', kind: 'paste' });
    expect(fired).toBe(2);
  });

  it('fake clipboard counts hints and reads and follows set()', async () => {
    const fake = createFakeClipboard({ text: 'https://example.com/job', stamp: 10, likelyUrl: 'yes' });
    let focused = 0;
    await fake.addListener('focus', () => {
      focused += 1;
    });
    expect(await fake.hint()).toEqual({ focused: true, hasText: true, stamp: 10, likelyUrl: 'yes', sensitive: false });
    expect(await fake.readText()).toEqual({ text: 'https://example.com/job' });
    fake.set({ sensitive: true });
    expect(await fake.readText()).toEqual({ text: null });
    fake.set({ sensitive: false, focused: false });
    expect(await fake.readText()).toEqual({ text: null });
    fake.set({ focused: true, text: 'x'.repeat(5000), stamp: 11 });
    expect((await fake.readText()).text).toHaveLength(4096);
    fake.set({ text: null });
    expect((await fake.hint()).hasText).toBe(false);
    fake.focus();
    expect(focused).toBe(1);
    expect(fake.hints).toBe(2);
    expect(fake.reads).toBe(4);
  });

  it('fake reminders records sync payloads and answers permission as configured', async () => {
    const fake = createFakeReminders({ answer: 'denied' });
    expect(await fake.status()).toEqual({ permission: 'prompt', enabled: false, channelBlocked: false });
    expect(await fake.requestPermission()).toEqual({ permission: 'denied' });
    expect((await fake.status()).permission).toBe('denied');
    const payload: ReminderSyncPayload = {
      channel: { name: '网申截止提醒', description: '示例' },
      publicText: '有一条网申快截止了',
      openPageLabel: '打开网页',
      entries: [{ id: 'r1:d0', recordId: 'r1', at: '2026-11-20T09:00', end: '2026-11-20T23:59', title: '今天截止：示例科技', text: '示例' }],
    };
    expect(await fake.sync(payload)).toEqual({ scheduled: 1 });
    expect(fake.synced).toEqual([payload]);
    await fake.clear();
    expect(fake.calls.map((c) => c.method)).toEqual(['status', 'requestPermission', 'status', 'sync', 'clear']);

    const granted = createFakeReminders({ permission: 'granted' });
    expect(await granted.status()).toEqual({ permission: 'granted', enabled: true, channelBlocked: false });
    const failing = createFakeReminders({ failSync: true });
    await expect(failing.sync({ ...payload, entries: [] })).rejects.toThrow();
    expect(failing.synced).toEqual([]);
  });

  it('fake shortcuts records calls', async () => {
    const fake = createFakeShortcuts({ canPin: false });
    const item = { id: 'app-r1', recordId: 'r1', shortLabel: '示例科技', longLabel: '继续填写：示例科技' };
    await fake.sync({ dynamic: [], liveRecordIds: ['r1'], disabledMessage: '这条网申记录已删除' });
    expect(await fake.canPin()).toEqual({ supported: false });
    expect(await fake.requestPin(item)).toEqual({ requested: false });
    await fake.clearAll();
    expect(fake.calls).toEqual([
      { method: 'sync', args: { dynamic: [], liveRecordIds: ['r1'], disabledMessage: '这条网申记录已删除' } },
      { method: 'canPin', args: undefined },
      { method: 'requestPin', args: item },
      { method: 'clearAll', args: undefined },
    ]);
    expect(await createFakeShortcuts().canPin()).toEqual({ supported: true });
  });

  it('fake browser role answers none when no other browser', async () => {
    const fake = createFakeBrowserRole();
    expect(await fake.state()).toEqual({ available: true, held: false });
    expect(await fake.openInOtherBrowser({ url: 'https://example.com/', title: '示例' })).toEqual({ opened: false, reason: 'none' });
    expect(await fake.openInOtherBrowser({ url: 'javascript:alert(1)', title: '' })).toEqual({ opened: false, reason: 'bad_url' });
    const two = createFakeBrowserRole({ others: 2 });
    expect(await two.openInOtherBrowser({ url: 'https://example.com/', title: '示例' })).toEqual({ opened: true });
    expect(await fake.request()).toEqual({ held: true });
    expect(fake.calls.map((c) => c.method)).toEqual(['state', 'openInOtherBrowser', 'openInOtherBrowser', 'request']);
  });
});
