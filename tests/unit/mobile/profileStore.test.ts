// Mobile app profile storage: the store contract (load / save) over three backends, and the save-time rules the
// extension's profileRepo applies (kept in step until P1 extracts one shared ProfileStore).
import { describe, expect, it } from 'vitest';
import {
  createLocalStorageStore,
  createMemoryStore,
  createVaultStore,
  emptyProfile,
  prepareForSave,
  type VaultPlugin,
} from '../../../mobile/app/src/store/profileStore';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';

function profileWith(ids: string[], active: string | null = ids[0] ?? null): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: ids.map((id) => ResumeSchema.parse({ id, title: `Resume ${id}`, locale: 'zh-CN', updatedAt: 1000 })),
    activeResumeId: active,
  });
}

function fakeVault(initial: string | null = null): VaultPlugin & { data: string | null; writes: number } {
  const vault = {
    data: initial,
    writes: 0,
    async read() {
      return { data: vault.data };
    },
    async write({ data }: { data: string }) {
      vault.writes += 1;
      vault.data = data;
    },
  };
  return vault;
}

describe('prepareForSave', () => {
  it('points a dangling activeResumeId at the first resume, and null when there are none', () => {
    expect(prepareForSave(profileWith(['a', 'b'], 'gone'), null, 5).activeResumeId).toBe('a');
    expect(prepareForSave(profileWith([], null), null, 5).activeResumeId).toBeNull();
  });

  it('keeps updatedAt of unchanged resumes and stamps changed or new ones', () => {
    const before = profileWith(['a', 'b']);
    const next = structuredClone(before);
    next.resumes[1]!.basics.givenName = 'Changed';
    next.resumes.push(ResumeSchema.parse({ id: 'c', title: 'New', locale: 'en-AU', updatedAt: 1 }));
    const saved = prepareForSave(next, before, 9999);
    expect(saved.resumes.map((r) => r.updatedAt)).toEqual([1000, 9999, 9999]);
  });

  it('throws on an invalid profile', () => {
    const bad = profileWith(['a']);
    (bad.resumes[0]!.basics as { height: number | null }).height = -1;
    expect(() => prepareForSave(bad, null, 1)).toThrow();
  });
});

describe('memory store', () => {
  it('starts with an empty valid profile and returns what was saved', async () => {
    const store = createMemoryStore();
    expect(await store.load()).toEqual(emptyProfile());
    await store.save(profileWith(['a']));
    expect((await store.load()).resumes.map((r) => r.id)).toEqual(['a']);
  });
});

describe('vault store (encrypted file on the phone)', () => {
  it('reads nothing as an empty profile', async () => {
    expect(await createVaultStore(fakeVault()).load()).toEqual(emptyProfile());
  });

  it('writes the profile as JSON and reads it back', async () => {
    const vault = fakeVault();
    const store = createVaultStore(vault);
    const saved = await store.save(profileWith(['a', 'b'], 'b'));
    expect(JSON.parse(vault.data!)).toEqual(saved);
    expect((await createVaultStore(vault).load()).activeResumeId).toBe('b');
  });

  it('refuses to load corrupt data and leaves it untouched', async () => {
    const vault = fakeVault('{not json');
    await expect(createVaultStore(vault).load()).rejects.toThrow();
    expect(vault.data).toBe('{not json');
    expect(vault.writes).toBe(0);
  });

  it('never writes an invalid profile', async () => {
    const vault = fakeVault();
    const bad = profileWith(['a']);
    (bad.resumes[0]!.basics as { height: number | null }).height = -1;
    await expect(createVaultStore(vault).save(bad)).rejects.toThrow();
    expect(vault.writes).toBe(0);
  });

  it('runs saves one after another, so the last call wins', async () => {
    const vault = fakeVault();
    const store = createVaultStore(vault);
    await Promise.all([store.save(profileWith(['a'])), store.save(profileWith(['a', 'b']))]);
    expect((await store.load()).resumes.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('localStorage store (desktop browser preview)', () => {
  it('round-trips through the given storage', async () => {
    localStorage.clear();
    const store = createLocalStorageStore(localStorage);
    await store.save(profileWith(['a']));
    expect((await createLocalStorageStore(localStorage).load()).resumes[0]!.id).toBe('a');
  });
});
