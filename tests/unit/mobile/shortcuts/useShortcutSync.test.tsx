// The launcher's dynamic shortcut and the pinned ones follow the records.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Language } from '../../../../src/i18n';
import { createFakeShortcuts, type FakeShortcuts } from '../../../../mobile/app/src/native/appShortcuts';
import { useShortcutSync } from '../../../../mobile/app/src/shortcuts/useShortcutSync';
import { ApplicationRecordSchema, defaultAppState, type AppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';

const rec = (id: string, openedAt: number, company: string): ApplicationRecord =>
  ApplicationRecordSchema.parse({ id, url: `https://jobs.example.com/${id}`, host: 'jobs.example.com', company, statusAt: 1, createdAt: 1, openedAt, updatedAt: 1 });

function Harness({ native, appState, language }: { native: FakeShortcuts; appState: AppState | null; language: Language }) {
  useShortcutSync({ native, appState, language, debounceMs: 1000 });
  return null;
}

const syncs = (native: FakeShortcuts) => native.calls.filter((c) => c.method === 'sync').map((c) => c.args as { dynamic: { recordId: string; longLabel: string }[]; liveRecordIds: string[]; disabledMessage: string });

function rig(initial: AppState | null, language: Language = 'zh') {
  vi.useFakeTimers();
  const native = createFakeShortcuts();
  const view = render(<Harness native={native} appState={initial} language={language} />);
  const set = (appState: AppState | null, lang: Language = language) => view.rerender(<Harness native={native} appState={appState} language={lang} />);
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return { native, set, tick };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useShortcutSync', () => {
  const two = defaultAppState({ applications: [rec('b', 20, '示例科技'), rec('a', 10, '示例银行')] });

  it('syncs after load', async () => {
    const r = rig(null);
    await r.tick(2000);
    expect(syncs(r.native)).toHaveLength(0);
    r.set(two);
    await r.tick(999);
    expect(syncs(r.native)).toHaveLength(0);
    await r.tick(1);
    expect(syncs(r.native)).toEqual([
      { dynamic: [{ id: 'last-application', recordId: 'b', shortLabel: '示例科技', longLabel: '继续：示例科技' }], liveRecordIds: ['b', 'a'], disabledMessage: '这条网申记录已删除' },
    ]);
  });

  it('opening another record updates it', async () => {
    const r = rig(two);
    await r.tick(1000);
    r.set(defaultAppState({ applications: [rec('a', 30, '示例银行'), rec('b', 20, '示例科技')] }));
    await r.tick(1000);
    expect(syncs(r.native).at(-1)!.dynamic[0]!.recordId).toBe('a');
  });

  it('deleting a record removes it from the payload', async () => {
    const r = rig(two);
    await r.tick(1000);
    r.set(defaultAppState({ applications: [rec('b', 20, '示例科技')] }));
    await r.tick(1000);
    expect(syncs(r.native).at(-1)!.liveRecordIds).toEqual(['b']);
  });

  it('a language change relabels', async () => {
    const r = rig(two);
    await r.tick(1000);
    r.set(two, 'en');
    await r.tick(1000);
    expect(syncs(r.native).at(-1)).toMatchObject({ dynamic: [{ longLabel: 'Continue: 示例科技' }], disabledMessage: 'This application was deleted' });
  });

  it('unchanged state sends nothing', async () => {
    const r = rig(two);
    await r.tick(1000);
    r.set(defaultAppState({ applications: [rec('b', 20, '示例科技'), rec('a', 10, '示例银行')], fillLanguage: 'en' }));
    await r.tick(5000);
    expect(syncs(r.native)).toHaveLength(1);
  });

  it('changes within the wait are sent once, after the last one', async () => {
    const r = rig(two);
    await r.tick(500);
    r.set(defaultAppState({ applications: [rec('a', 30, '示例银行'), rec('b', 20, '示例科技')] }));
    await r.tick(500);
    expect(syncs(r.native)).toHaveLength(0);
    await r.tick(500);
    expect(syncs(r.native)).toHaveLength(1);
    expect(syncs(r.native)[0]!.dynamic[0]!.recordId).toBe('a');
  });

  it('a failed sync is tried again on the next change', async () => {
    const r = rig(two);
    let fail = true;
    const sync = r.native.sync.bind(r.native);
    r.native.sync = async (o) => {
      await sync(o);
      if (fail) throw new Error('launcher busy');
    };
    await r.tick(1000);
    fail = false;
    r.set(defaultAppState({ applications: [rec('b', 20, '示例科技')] }));
    await r.tick(1000);
    r.set(two);
    await r.tick(1000);
    // The first value failed, so going back to it sends it again.
    expect(syncs(r.native).map((s) => s.liveRecordIds)).toEqual([['b', 'a'], ['b'], ['b', 'a']]);
  });
});
