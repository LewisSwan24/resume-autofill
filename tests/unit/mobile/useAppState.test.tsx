// The app state hook: waits for the profile to say whether this is a first run, starts from defaults when nothing
// (or something corrupt) is stored, and applies changes at once with a rollback when saving fails.
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryAppStateStore,
  defaultAppState,
  type AppState,
  type AppStateStore,
} from '../../../mobile/app/src/store/appStateStore';
import { useAppState } from '../../../mobile/app/src/useAppState';

type Seed = { hasResumes: boolean } | null;

describe('useAppState', () => {
  it('waits for the seed before loading', async () => {
    const store = createMemoryAppStateStore();
    const load = vi.spyOn(store, 'load');
    const { result, rerender } = renderHook(({ seed }: { seed: Seed }) => useAppState(store, seed), {
      initialProps: { seed: null as Seed },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(load).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
    rerender({ seed: { hasResumes: false } });
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('first run without resumes: onboarding not done, and the default is saved', async () => {
    const store = createMemoryAppStateStore();
    const { result } = renderHook(() => useAppState(store, { hasResumes: false }));
    await waitFor(() => expect(result.current.state).toEqual(defaultAppState({ onboardingDone: false })));
    await waitFor(async () => expect(await store.load()).toEqual(defaultAppState({ onboardingDone: false })));
  });

  it('nothing stored but resumes exist (upgrade): onboarding counts as done', async () => {
    const store = createMemoryAppStateStore();
    const { result } = renderHook(() => useAppState(store, { hasResumes: true }));
    await waitFor(() => expect(result.current.state?.onboardingDone).toBe(true));
    await waitFor(async () => expect((await store.load())?.onboardingDone).toBe(true));
  });

  it('stored state is used as it is', async () => {
    const stored = defaultAppState({ onboardingDone: true, fillLanguage: 'en' });
    const store = createMemoryAppStateStore(stored);
    const { result } = renderHook(() => useAppState(store, { hasResumes: false }));
    await waitFor(() => expect(result.current.state).toEqual(stored));
  });

  it('corrupt stored state: starts from defaults and overwrites it', async () => {
    const store = createMemoryAppStateStore({ version: 9, junk: true });
    const { result } = renderHook(() => useAppState(store, { hasResumes: true }));
    await waitFor(() => expect(result.current.state).toEqual(defaultAppState({ onboardingDone: true })));
    await waitFor(async () => expect(await store.load()).toEqual(defaultAppState({ onboardingDone: true })));
  });

  it('update shows the change at once and stores it', async () => {
    const store = createMemoryAppStateStore(defaultAppState({ onboardingDone: true }));
    const { result } = renderHook(() => useAppState(store, { hasResumes: true }));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    let done: Promise<boolean> = Promise.resolve(false);
    act(() => {
      done = result.current.update((s) => ({ ...s, fillLanguage: 'zh' }));
    });
    expect(result.current.state?.fillLanguage).toBe('zh');
    let ok = false;
    await act(async () => {
      ok = await done;
    });
    expect(ok).toBe(true);
    expect((await store.load())?.fillLanguage).toBe('zh');
  });

  it('two quick updates both apply, the second on top of the first', async () => {
    const store = createMemoryAppStateStore(defaultAppState({ onboardingDone: true }));
    const { result } = renderHook(() => useAppState(store, { hasResumes: true }));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    await act(async () => {
      await Promise.all([
        result.current.update((s) => ({ ...s, fillLanguage: 'en' })),
        result.current.update((s) => ({ ...s, onboardingDone: false })),
      ]);
    });
    expect(result.current.state).toEqual(defaultAppState({ fillLanguage: 'en', onboardingDone: false }));
    expect(await store.load()).toEqual(defaultAppState({ fillLanguage: 'en', onboardingDone: false }));
  });

  it('a failed save resolves false and rolls the state back to the stored one', async () => {
    const inner = createMemoryAppStateStore(defaultAppState({ onboardingDone: true }));
    let fail = false;
    const store: AppStateStore = {
      load: () => inner.load(),
      clear: () => inner.clear(),
      save: (s: AppState) => (fail ? Promise.reject(new Error('disk full')) : inner.save(s)),
    };
    const { result } = renderHook(() => useAppState(store, { hasResumes: true }));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    fail = true;
    let ok = true;
    await act(async () => {
      ok = await result.current.update((s) => ({ ...s, fillLanguage: 'en' }));
    });
    expect(ok).toBe(false);
    expect(result.current.state).toEqual(defaultAppState({ onboardingDone: true }));
  });

  it('nothing could ever be saved (Keystore failure): a change stays on screen for this run and still resolves false', async () => {
    const store: AppStateStore = {
      load: () => Promise.resolve(null),
      clear: () => Promise.resolve(),
      save: () => Promise.reject(new Error('no key')),
    };
    const { result } = renderHook(() => useAppState(store, { hasResumes: false }));
    await waitFor(() => expect(result.current.state).toEqual(defaultAppState({ onboardingDone: false })));
    let ok = true;
    await act(async () => {
      ok = await result.current.update((s) => ({ ...s, onboardingDone: true }));
    });
    expect(ok).toBe(false);
    expect(result.current.state?.onboardingDone).toBe(true);
  });
});
