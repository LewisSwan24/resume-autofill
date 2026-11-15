// Keeping files/keyboard.enc in step with the profile: written one second after
// the last change while the keyboard is enabled and 「在输入法里显示简历」 is on; cleared otherwise; nothing sent while a
// delete-all runs or while anything is still unknown.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RESUME_EN, SAMPLE_RESUME_ZH } from '../../../../mobile/app/src/browser/model/sampleResume';
import { KeyboardDataSchema } from '../../../../mobile/app/src/keyboard/keyboardData';
import { buildKeyboardData } from '../../../../mobile/app/src/keyboard/projection';
import { KEYBOARD_SYNC_DEBOUNCE_MS, useKeyboardSync } from '../../../../mobile/app/src/keyboard/useKeyboardSync';
import { createFakeResumeKeyboard, type FakeResumeKeyboard } from '../../../../mobile/app/src/native/resumeKeyboard';
import { defaultAppState, type AppState } from '../../../../mobile/app/src/store/appStateStore';
import { emptyProfile } from '../../../../mobile/app/src/store/profileStore';
import type { Language } from '../../../../src/i18n';
import type { Profile } from '../../../../src/schema';

const profile: Profile = { ...emptyProfile(), resumes: [{ ...SAMPLE_RESUME_ZH, linkedResumeId: 'sample-en' }, SAMPLE_RESUME_EN], activeResumeId: 'sample-zh' };
const edited: Profile = { ...profile, resumes: [{ ...profile.resumes[0]!, contact: { ...profile.resumes[0]!.contact, wechat: 'zhangsan_example' } }, SAMPLE_RESUME_EN] };
const empty: Profile = emptyProfile();
const state = defaultAppState({ onboardingDone: true });
const withKeyboard = (k: Partial<AppState['keyboard']>): AppState => ({ ...state, keyboard: { ...state.keyboard, ...k } });

type Props = {
  profile: Profile | null;
  appState: AppState | null;
  language: Language;
  enabled: boolean | null;
  suspended?: boolean;
};
const ready: Props = { profile, appState: state, language: 'zh', enabled: true };

function setup(initial: Props, native: FakeResumeKeyboard = createFakeResumeKeyboard({ enabled: true })) {
  const hook = renderHook((p: Props) => useKeyboardSync({ native, ...p }), { initialProps: initial });
  return { native, hook };
}
const methods = (n: FakeResumeKeyboard) => n.calls.map((c) => c.method);
const writes = (n: FakeResumeKeyboard) => n.calls.filter((c) => c.method === 'writeData');
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useKeyboardSync', () => {
  it('waits one second, then writes the projection; the same inputs again write nothing; an edit writes again', async () => {
    expect(KEYBOARD_SYNC_DEBOUNCE_MS).toBe(1000);
    const { native, hook } = setup(ready);
    await tick(999);
    expect(writes(native)).toHaveLength(0);
    await tick(1);
    expect(writes(native)).toHaveLength(1);
    const expected = buildKeyboardData(profile, { language: 'zh', fillLanguage: 'active', hidden: [] });
    expect(native.stored).toBe(JSON.stringify(expected));
    expect(KeyboardDataSchema.safeParse(JSON.parse(native.stored!)).success).toBe(true);
    expect(methods(native)).not.toContain('clearData');

    hook.rerender({ ...ready, appState: { ...state } }); // a new object, the same content
    await tick(2000);
    expect(writes(native)).toHaveLength(1);

    hook.rerender({ ...ready, profile: edited });
    await tick(1000);
    expect(writes(native)).toHaveLength(2);
    expect(native.stored).toContain('zhangsan_example');
    expect(hook.result.current.lastError).toBe(false);
  });

  it('show off → clearData and no write', async () => {
    const { native } = setup({ ...ready, appState: withKeyboard({ show: false }) }, createFakeResumeKeyboard({ enabled: true, stored: '{}' }));
    await tick(3000);
    expect(methods(native)).toEqual(['clearData']);
    expect(native.stored).toBeNull();
  });

  it('enabled false → clearData once, not on every render', async () => {
    const { native, hook } = setup({ ...ready, enabled: false });
    await tick(1500);
    hook.rerender({ ...ready, enabled: false, appState: { ...state } });
    hook.rerender({ ...ready, enabled: false, profile: edited });
    await tick(3000);
    expect(methods(native)).toEqual(['clearData']);
  });

  it('turning the keyboard off after a write clears once; turning it on again writes again', async () => {
    const { native, hook } = setup(ready);
    await tick(1000);
    hook.rerender({ ...ready, enabled: false });
    await tick(1000);
    hook.rerender({ ...ready, enabled: false, appState: { ...state } });
    await tick(1000);
    hook.rerender(ready);
    await tick(1000);
    expect(methods(native)).toEqual(['writeData', 'clearData', 'writeData']);
    expect(native.stored).not.toBeNull();
  });

  it.each([
    ['enabled unknown', { ...ready, enabled: null }],
    ['profile loading', { ...ready, profile: null }],
    ['app state loading', { ...ready, appState: null }],
  ] as [string, Props][])('%s → no call at all', async (_name, props) => {
    const { native } = setup(props);
    await tick(5000);
    expect(native.calls).toEqual([]);
  });

  it('with no plugin (browser preview) nothing happens', async () => {
    const hook = renderHook(() => useKeyboardSync({ native: null, ...ready }));
    await tick(5000);
    expect(hook.result.current.lastError).toBe(false);
  });

  it('an empty profile → clearData', async () => {
    const { native } = setup({ ...ready, profile: empty });
    await tick(3000);
    expect(methods(native)).toEqual(['clearData']);
  });

  it('a rejected write sets lastError; the next change retries and clears it', async () => {
    const native = createFakeResumeKeyboard({ enabled: true });
    native.failWrites = true;
    const { hook } = setup(ready, native);
    await tick(1000);
    await flush();
    expect(hook.result.current.lastError).toBe(true);
    expect(native.stored).toBeNull();
    native.failWrites = false;
    hook.rerender({ ...ready, appState: { ...state } }); // any input change, even with the same payload
    await tick(1000);
    await flush();
    expect(writes(native)).toHaveLength(2);
    expect(hook.result.current.lastError).toBe(false);
    expect(native.stored).not.toBeNull();
  });

  it('suspended cancels the pending write; afterwards an empty profile is cleared', async () => {
    const { native, hook } = setup(ready);
    await tick(500);
    hook.rerender({ ...ready, suspended: true });
    await tick(3000);
    expect(native.calls).toEqual([]);
    hook.rerender({ ...ready, suspended: true, profile: empty });
    await tick(3000);
    expect(native.calls).toEqual([]);
    hook.rerender({ ...ready, suspended: false, profile: empty });
    await tick(3000);
    expect(methods(native)).toEqual(['clearData']);
  });

  it('hidden groups changing rewrites the file without them', async () => {
    const { native, hook } = setup(ready);
    await tick(1000);
    hook.rerender({ ...ready, appState: withKeyboard({ hidden: ['education'] }) });
    await tick(1000);
    expect(writes(native)).toHaveLength(2);
    const data = JSON.parse(native.stored!) as { resumes: { groups: { id: string }[] }[] };
    expect(data.resumes[0]!.groups.map((g) => g.id)).not.toContain('education');
  });

  it('the UI language changing rewrites the labels', async () => {
    const { native, hook } = setup(ready);
    await tick(1000);
    hook.rerender({ ...ready, language: 'en' });
    await tick(1000);
    expect(writes(native)).toHaveLength(2);
    expect(JSON.parse(native.stored!).ui).toBe('en');
  });

  it('a write that resolves after the keyboard was turned off does not stop the next write', async () => {
    const native = createFakeResumeKeyboard({ enabled: true });
    let release: () => void = () => undefined;
    const write = native.writeData.bind(native);
    native.writeData = (o) => {
      native.calls.push({ method: 'writeData', args: o });
      return new Promise<void>((done) => {
        release = () => void write(o).then(done);
      });
    };
    const { hook } = setup(ready, native);
    await tick(1000); // the write is in flight
    hook.rerender({ ...ready, enabled: false });
    await flush();
    release();
    await flush();
    await flush();
    hook.rerender(ready);
    await tick(1000);
    expect(methods(native).filter((m) => m === 'writeData').length).toBeGreaterThanOrEqual(2);
    expect(methods(native)).toContain('clearData');
  });
});
