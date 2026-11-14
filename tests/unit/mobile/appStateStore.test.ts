// Mobile app state (onboarding, fill language, recent pages): one store contract over the native vault (faked
// here), localStorage and memory.
import { describe, expect, it } from 'vitest';
import {
  APP_STATE_KEY,
  createLocalStorageAppStateStore,
  createMemoryAppStateStore,
  createVaultAppStateStore,
  defaultAppState,
  type AppState,
  type AppStateVaultPlugin,
} from '../../../mobile/app/src/store/appStateStore';
import { LOCAL_STORAGE_KEY } from '../../../mobile/app/src/store/profileStore';

const page = (url: string, id = 'p1') => ({ id, url, host: 'jobs.example.com', addedAt: 1000 });

function fakeVault(initial: string | null = null) {
  const calls: string[] = [];
  const vault: AppStateVaultPlugin & { data: string | null; calls: string[] } = {
    data: initial,
    calls,
    async readState() {
      calls.push('readState');
      return { data: vault.data };
    },
    async writeState({ data }) {
      calls.push('writeState');
      vault.data = data;
    },
    async clearState() {
      calls.push('clearState');
      vault.data = null;
    },
  };
  return vault;
}

describe('app state store', () => {
  it('memory store: reads nothing as null, returns what was saved', async () => {
    const store = createMemoryAppStateStore();
    expect(await store.load()).toBeNull();
    const saved = await store.save(defaultAppState());
    expect(saved).toEqual(defaultAppState());
    expect(await store.load()).toEqual(defaultAppState());
  });

  it('fills defaults for missing fields and rejects an invalid state, writing nothing', async () => {
    const store = createMemoryAppStateStore({ version: 1 });
    expect(await store.load()).toEqual({ version: 1, onboardingDone: false, fillLanguage: 'active', recentPages: [] });

    const good: AppState = { ...defaultAppState(), recentPages: [page('https://jobs.example.com/apply/1')] };
    await store.save(good);
    const bad = { ...good, recentPages: [page('javascript:alert(1)', 'p2')] } as AppState;
    await expect(store.save(bad)).rejects.toThrow();
    expect(await store.load()).toEqual(good);
    await expect(store.save({ ...good, fillLanguage: 'fr' } as unknown as AppState)).rejects.toThrow();
    expect(await store.load()).toEqual(good);
  });

  it('defaultAppState takes overrides', () => {
    expect(defaultAppState({ onboardingDone: true })).toEqual({
      version: 1,
      onboardingDone: true,
      fillLanguage: 'active',
      recentPages: [],
    });
  });

  it('vault store: JSON through readState / writeState, clear through clearState', async () => {
    const vault = fakeVault();
    const store = createVaultAppStateStore(vault);
    expect(await store.load()).toBeNull();
    const state = defaultAppState({ fillLanguage: 'zh' });
    await store.save(state);
    expect(JSON.parse(vault.data!)).toEqual(state);
    expect(await store.load()).toEqual(state);
    await store.clear();
    expect(vault.data).toBeNull();
    expect(await store.load()).toBeNull();
    expect(vault.calls).toEqual(['readState', 'writeState', 'readState', 'clearState', 'readState']);
  });

  it('localStorage store uses the raf.appState key', async () => {
    expect(APP_STATE_KEY).toBe('raf.appState');
    const storage = window.localStorage;
    storage.clear();
    const store = createLocalStorageAppStateStore(storage);
    await store.save(defaultAppState({ onboardingDone: true }));
    expect(JSON.parse(storage.getItem('raf.appState')!)).toEqual(defaultAppState({ onboardingDone: true }));
    expect(storage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
    await store.clear();
    expect(storage.getItem('raf.appState')).toBeNull();
    expect(await store.load()).toBeNull();
    storage.clear();
  });

  it('corrupt stored data makes load throw', async () => {
    await expect(createVaultAppStateStore(fakeVault('{not json')).load()).rejects.toThrow();
    await expect(createMemoryAppStateStore({ version: 2 }).load()).rejects.toThrow();
    await expect(createMemoryAppStateStore({ version: 1, recentPages: 'x' }).load()).rejects.toThrow();
    const failing: AppStateVaultPlugin = {
      readState: () => Promise.reject(new Error('decrypt')),
      writeState: async () => undefined,
      clearState: async () => undefined,
    };
    await expect(createVaultAppStateStore(failing).load()).rejects.toThrow();
  });

  it('saves run one at a time, in call order', async () => {
    let stored: string | null = null;
    const order: string[] = [];
    let active = 0;
    const vault: AppStateVaultPlugin = {
      async readState() {
        return { data: stored };
      },
      async writeState({ data }) {
        active += 1;
        expect(active).toBe(1);
        const lang = (JSON.parse(data) as AppState).fillLanguage;
        order.push(`start ${lang}`);
        await new Promise((r) => setTimeout(r, lang === 'zh' ? 20 : 1));
        stored = data;
        order.push(`end ${lang}`);
        active -= 1;
      },
      async clearState() {
        stored = null;
      },
    };
    const store = createVaultAppStateStore(vault);
    await Promise.all([
      store.save(defaultAppState({ fillLanguage: 'zh' })),
      store.save(defaultAppState({ fillLanguage: 'en' })),
    ]);
    expect(order).toEqual(['start zh', 'end zh', 'start en', 'end en']);
    expect((await store.load())?.fillLanguage).toBe('en');
  });
});
