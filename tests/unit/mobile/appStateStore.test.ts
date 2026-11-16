// Mobile app state v2 (onboarding, fill language, application records, reminder and clipboard settings): one store
// contract over the native vault (faked here), localStorage and memory.
import { describe, expect, it } from 'vitest';
import {
  APP_STATE_KEY,
  createLocalStorageAppStateStore,
  createMemoryAppStateStore,
  createVaultAppStateStore,
  ApplicationRecordSchema,
  defaultAppState,
  type AppState,
  type AppStateVaultPlugin,
} from '../../../mobile/app/src/store/appStateStore';
import { LOCAL_STORAGE_KEY } from '../../../mobile/app/src/store/profileStore';

const record = (url: string, id = 'p1') =>
  ApplicationRecordSchema.parse({ id, url, host: 'jobs.example.com', statusAt: 1000, createdAt: 1000, openedAt: 1000, updatedAt: 1000 });

const V2_DEFAULTS = {
  version: 2,
  onboardingDone: false,
  fillLanguage: 'active',
  applications: [],
  reminders: { time: '09:00', dayBefore: true, dayOf: true, defaultOn: false },
  clipboard: { offer: true, lastStamp: null, dismissed: [] },
  keyboard: { show: true, hidden: [] },
};

/** Every field set: a record with deadline, notes and history; non-default reminders and clipboard. */
const fullState = (): AppState =>
  defaultAppState({
    onboardingDone: true,
    fillLanguage: 'zh',
    applications: [
      {
        ...record('https://jobs.example.com/apply/1#step2'),
        title: '示例科技校园招聘',
        company: '示例科技',
        companyGuessed: false,
        position: '产品经理',
        status: 'filling',
        statusAt: 2000,
        deadline: { date: '2026-11-20', time: '18:00' },
        remind: true,
        notes: '要准备作品集',
        history: [{ at: 1500, resumeId: 'r1', locale: 'zh-CN', filled: 12, attention: 3, skipped: 5, undone: true }],
      },
    ],
    reminders: { time: '20:00', dayBefore: false, dayOf: true, defaultOn: true },
    clipboard: { offer: false, lastStamp: 123, dismissed: ['0123456789abcdef0123456789abcdef'] },
  });

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

  it('v2 defaults', async () => {
    expect(defaultAppState()).toEqual(V2_DEFAULTS);
    expect(await createMemoryAppStateStore({ version: 2 }).load()).toEqual(V2_DEFAULTS);
    expect(defaultAppState({ onboardingDone: true })).toEqual({ ...V2_DEFAULTS, onboardingDone: true });
  });

  it('a full v2 state round-trips through every backend', async () => {
    const state = fullState();
    window.localStorage.clear();
    for (const store of [createMemoryAppStateStore(), createVaultAppStateStore(fakeVault()), createLocalStorageAppStateStore(window.localStorage)]) {
      expect(await store.save(state)).toEqual(state);
      expect(await store.load()).toEqual(state);
    }
    window.localStorage.clear();
  });

  it('rejects an invalid state, writing nothing', async () => {
    const store = createMemoryAppStateStore();
    const good = defaultAppState({ applications: [record('https://jobs.example.com/apply/1')] });
    await store.save(good);
    await expect(store.save({ ...good, fillLanguage: 'fr' } as unknown as AppState)).rejects.toThrow();
    await expect(store.save({ ...good, reminders: { ...good.reminders, time: '24:00' } })).rejects.toThrow();
    await expect(store.save({ ...good, applications: [{ ...good.applications[0]!, deadline: { date: '2026-02-30' } }] })).rejects.toThrow();
    expect(await store.load()).toEqual(good);
  });

  it('a record with a javascript: url is refused on save', async () => {
    const store = createMemoryAppStateStore();
    const good = defaultAppState({ applications: [record('https://jobs.example.com/apply/1')] });
    await store.save(good);
    const bad = { ...good, applications: [{ ...good.applications[0]!, url: 'javascript:alert(1)' }] };
    await expect(store.save(bad)).rejects.toThrow();
    expect(await store.load()).toEqual(good);
  });

  it('more than 500 records is refused', async () => {
    const many = Array.from({ length: 501 }, (_, i) => record(`https://jobs.example.com/${i}`, `r${i}`));
    const store = createMemoryAppStateStore();
    await expect(store.save({ ...defaultAppState(), applications: many })).rejects.toThrow();
    expect(await store.load()).toBeNull();
    await store.save({ ...defaultAppState(), applications: many.slice(0, 500) });
    expect((await store.load())?.applications).toHaveLength(500);
  });

  it('dismissed digests must be 32 hex characters', async () => {
    const store = createMemoryAppStateStore();
    const clip = (dismissed: string[]) => ({ ...defaultAppState(), clipboard: { offer: true, lastStamp: null, dismissed } });
    await expect(store.save(clip(['https://jobs.example.com/']))).rejects.toThrow();
    await expect(store.save(clip(['0123456789ABCDEF0123456789ABCDEF']))).rejects.toThrow();
    await expect(store.save(clip(Array.from({ length: 21 }, () => 'a'.repeat(32))))).rejects.toThrow();
    await store.save(clip(['a'.repeat(32)]));
    expect((await store.load())?.clipboard.dismissed).toEqual(['a'.repeat(32)]);
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
    await expect(createMemoryAppStateStore({ version: 0 }).load()).rejects.toThrow();
    await expect(createMemoryAppStateStore({ version: 1, recentPages: 'x' }).load()).rejects.toThrow();
    await expect(createMemoryAppStateStore({ version: 2, applications: 'x' }).load()).rejects.toThrow();
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
