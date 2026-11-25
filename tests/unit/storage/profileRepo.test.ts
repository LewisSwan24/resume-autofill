import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  PROFILE_STORAGE_KEY,
  counterpartResume,
  deleteResume,
  getActiveResume,
  loadProfile,
  resumeLanguage,
  saveProfile,
  setActiveResume,
  setUiLanguage,
  switchResumeLanguage,
  upsertResume,
  watchProfile,
} from '../../../src/storage';
import { CURRENT_SCHEMA_VERSION, ProfileMigrationError, ProfileSchema, ResumeSchema, createSampleProfile } from '../../../src/schema';

const T0 = Date.UTC(2026, 5, 1);

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const newResume = (id: string, extra: Record<string, unknown> = {}) =>
  ResumeSchema.parse({ id, title: id, locale: 'en-AU', createdAt: 1, updatedAt: 1, ...extra });

describe('loadProfile', () => {
  it('returns an empty, valid, sample-free profile when nothing is stored', async () => {
    const p = await loadProfile();
    expect(ProfileSchema.safeParse(p).success).toBe(true);
    expect(p.resumes).toEqual([]);
    expect(p.activeResumeId).toBeNull();
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Loading must not write anything.
    expect(await fakeBrowser.storage.local.get(PROFILE_STORAGE_KEY)).toEqual({});
  });

  it('migrates an un-versioned stored profile', async () => {
    await fakeBrowser.storage.local.set({
      [PROFILE_STORAGE_KEY]: { resumes: [{ id: 'a', title: 'A', locale: 'zh-CN' }] },
    });
    const p = await loadProfile();
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.activeResumeId).toBe('a');
    expect(p.resumes[0]?.basics.familyName).toBe('');
  });

  it('throws (and keeps the data) when the stored profile is corrupt or too new', async () => {
    await fakeBrowser.storage.local.set({ [PROFILE_STORAGE_KEY]: { schemaVersion: 99, resumes: [] } });
    await expect(loadProfile()).rejects.toBeInstanceOf(ProfileMigrationError);
    expect(await fakeBrowser.storage.local.get(PROFILE_STORAGE_KEY)).toEqual({
      [PROFILE_STORAGE_KEY]: { schemaVersion: 99, resumes: [] },
    });
  });
});

describe('saveProfile', () => {
  it('round-trips through storage', async () => {
    const sample = createSampleProfile();
    const saved = await saveProfile(sample);
    expect(await loadProfile()).toEqual(saved);
    expect(saved.resumes.map((r) => r.id)).toEqual(sample.resumes.map((r) => r.id));
  });

  it('rejects invalid data without writing', async () => {
    const bad = createSampleProfile();
    bad.resumes[0]!.basics.birthDate = 'not-a-date';
    await expect(saveProfile(bad)).rejects.toThrow();
    expect(await fakeBrowser.storage.local.get(PROFILE_STORAGE_KEY)).toEqual({});
  });

  it('bumps updatedAt only for new or changed resumes', async () => {
    const p = createSampleProfile();
    await saveProfile(p);
    const first = await loadProfile();
    expect(first.resumes.every((r) => r.updatedAt === T0)).toBe(true);

    vi.setSystemTime(T0 + 5000);
    const edited = structuredClone(first);
    edited.resumes[0]!.basics.givenName = 'Changed';
    edited.resumes.push(newResume('fresh'));
    await saveProfile(edited);

    const second = await loadProfile();
    expect(second.resumes[0]!.updatedAt).toBe(T0 + 5000);
    expect(second.resumes[1]!.updatedAt).toBe(T0); // untouched
    expect(second.resumes[2]!.updatedAt).toBe(T0 + 5000); // new
  });

  it('does not bump anything when nothing changed', async () => {
    await saveProfile(createSampleProfile());
    vi.setSystemTime(T0 + 9999);
    await saveProfile(await loadProfile());
    expect((await loadProfile()).resumes.every((r) => r.updatedAt === T0)).toBe(true);
  });

  it('ignores a caller-supplied updatedAt when content changed', async () => {
    await saveProfile(createSampleProfile());
    vi.setSystemTime(T0 + 100);
    const p = await loadProfile();
    p.resumes[0]!.title = 'New title';
    p.resumes[0]!.updatedAt = 42;
    await saveProfile(p);
    expect((await loadProfile()).resumes[0]!.updatedAt).toBe(T0 + 100);
  });

  it('repairs a dangling activeResumeId', async () => {
    const p = createSampleProfile();
    p.activeResumeId = 'ghost';
    const saved = await saveProfile(p);
    expect(saved.activeResumeId).toBe(p.resumes[0]!.id);

    const empty = ProfileSchema.parse({ schemaVersion: 1, activeResumeId: 'ghost' });
    expect((await saveProfile(empty)).activeResumeId).toBeNull();
  });
});

describe('active resume', () => {
  it('getActiveResume returns null for an empty profile', async () => {
    expect(await getActiveResume()).toBeNull();
  });

  it('getActiveResume / setActiveResume', async () => {
    const sample = createSampleProfile();
    await saveProfile(sample);
    const [a, b] = sample.resumes;
    expect((await getActiveResume())?.id).toBe(sample.activeResumeId);

    const target = sample.activeResumeId === a!.id ? b! : a!;
    await setActiveResume(target.id);
    expect((await getActiveResume())?.id).toBe(target.id);
  });

  it('setActiveResume rejects unknown ids and leaves state alone', async () => {
    const sample = await saveProfile(createSampleProfile());
    await expect(setActiveResume('ghost')).rejects.toThrow(/ghost/);
    expect((await loadProfile()).activeResumeId).toBe(sample.activeResumeId);
  });
});

describe('upsertResume', () => {
  it('appends a new resume and makes it active when none was active', async () => {
    const saved = await upsertResume({ id: 'r1', title: 'First', locale: 'zh-CN' });
    expect(saved.id).toBe('r1');
    expect(saved.basics.familyName).toBe(''); // schema defaults applied
    const p = await loadProfile();
    expect(p.resumes.map((r) => r.id)).toEqual(['r1']);
    expect(p.activeResumeId).toBe('r1');
  });

  it('keeps the existing active resume when adding another', async () => {
    await upsertResume({ id: 'r1', title: 'First', locale: 'zh-CN' });
    await upsertResume({ id: 'r2', title: 'Second', locale: 'en-AU' });
    expect((await loadProfile()).activeResumeId).toBe('r1');
  });

  it('replaces by id in place (order preserved) and bumps updatedAt', async () => {
    await upsertResume({ id: 'r1', title: 'First', locale: 'zh-CN' });
    await upsertResume({ id: 'r2', title: 'Second', locale: 'en-AU' });
    vi.setSystemTime(T0 + 1000);
    const updated = await upsertResume({ id: 'r1', title: 'Renamed', locale: 'zh-CN' });
    expect(updated.updatedAt).toBe(T0 + 1000);
    const p = await loadProfile();
    expect(p.resumes.map((r) => [r.id, r.title])).toEqual([['r1', 'Renamed'], ['r2', 'Second']]);
    expect(p.resumes[1]!.updatedAt).toBe(T0);
  });

  it('rejects invalid resumes', async () => {
    await expect(upsertResume({ id: '', title: 'x', locale: 'zh-CN' })).rejects.toThrow();
    await expect(upsertResume({ id: 'x', title: 'x', locale: 'fr' } as never)).rejects.toThrow();
  });

  it('serialises concurrent upserts (no lost updates)', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) => upsertResume({ id, title: id, locale: 'en-AU' })),
    );
    expect((await loadProfile()).resumes.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('deleteResume', () => {
  it('removes the resume and clears linkedResumeId references to it', async () => {
    await saveProfile(createSampleProfile());
    const p = await loadProfile();
    const [a, b] = p.resumes;
    expect(a!.linkedResumeId).toBe(b!.id);

    expect(await deleteResume(b!.id)).toBe(true);
    const after = await loadProfile();
    expect(after.resumes.map((r) => r.id)).toEqual([a!.id]);
    expect(after.resumes[0]!.linkedResumeId).toBeUndefined();
  });

  it('only touches resumes that referenced the deleted one', async () => {
    await upsertResume({ id: 'a', title: 'a', locale: 'zh-CN', linkedResumeId: 'b' });
    await upsertResume({ id: 'b', title: 'b', locale: 'en-AU' });
    await upsertResume({ id: 'c', title: 'c', locale: 'en-AU', linkedResumeId: 'a' });
    await deleteResume('b');
    const p = await loadProfile();
    expect(p.resumes.find((r) => r.id === 'a')?.linkedResumeId).toBeUndefined();
    expect(p.resumes.find((r) => r.id === 'c')?.linkedResumeId).toBe('a');
    // c was untouched, so its updatedAt is not bumped.
    expect(p.resumes.find((r) => r.id === 'c')?.updatedAt).toBe(T0);
  });

  it('moves the active resume to the first remaining one, or null when empty', async () => {
    await upsertResume({ id: 'a', title: 'a', locale: 'zh-CN' });
    await upsertResume({ id: 'b', title: 'b', locale: 'en-AU' });
    expect((await loadProfile()).activeResumeId).toBe('a');
    await deleteResume('a');
    expect((await loadProfile()).activeResumeId).toBe('b');
    await deleteResume('b');
    expect((await loadProfile()).activeResumeId).toBeNull();
  });

  it('returns false for unknown ids', async () => {
    await upsertResume({ id: 'a', title: 'a', locale: 'zh-CN' });
    expect(await deleteResume('ghost')).toBe(false);
    expect((await loadProfile()).resumes).toHaveLength(1);
  });
});

describe('watchProfile', () => {
  it('notifies with the new parsed profile on change and stops after unsubscribe', async () => {
    const seen: string[][] = [];
    const stop = watchProfile((p) => seen.push(p.resumes.map((r) => r.id)));

    await upsertResume({ id: 'a', title: 'a', locale: 'zh-CN' });
    await upsertResume({ id: 'b', title: 'b', locale: 'en-AU' });
    expect(seen.at(-1)).toEqual(['a', 'b']);

    stop();
    const count = seen.length;
    await upsertResume({ id: 'c', title: 'c', locale: 'en-AU' });
    expect(seen).toHaveLength(count);
  });

  it('ignores other keys and other areas', async () => {
    const cb = vi.fn();
    const stop = watchProfile(cb);
    await fakeBrowser.storage.local.set({ somethingElse: 1 });
    await fakeBrowser.storage.sync.set({ [PROFILE_STORAGE_KEY]: { resumes: [] } });
    await fakeBrowser.storage.session.set({ [PROFILE_STORAGE_KEY]: { resumes: [] } });
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it('reports an empty profile when the key is removed, and skips unparsable values', async () => {
    await upsertResume({ id: 'a', title: 'a', locale: 'zh-CN' });
    const cb = vi.fn();
    const stop = watchProfile(cb);

    await fakeBrowser.storage.local.set({ [PROFILE_STORAGE_KEY]: 'garbage' });
    expect(cb).not.toHaveBeenCalled();

    await fakeBrowser.storage.local.remove(PROFILE_STORAGE_KEY);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0].resumes).toEqual([]);
    stop();
  });
});

describe('one-click switches', () => {
  const zh = (id: string, extra: Record<string, unknown> = {}) => newResume(id, { locale: 'zh-CN', ...extra });
  const en = (id: string, extra: Record<string, unknown> = {}) => newResume(id, { locale: 'en-AU', ...extra });
  const profileOf = (resumes: ReturnType<typeof newResume>[], activeResumeId: string | null) =>
    ProfileSchema.parse({ schemaVersion: 1, resumes, activeResumeId });

  it('resumeLanguage maps a locale to the interface language it reads in', () => {
    expect(resumeLanguage('zh-CN')).toBe('zh');
    expect(resumeLanguage('en-AU')).toBe('en');
  });

  it('counterpartResume prefers the linked resume in the other language', () => {
    const p = profileOf([zh('a', { linkedResumeId: 'c' }), en('b'), en('c')], 'a');
    expect(counterpartResume(p)?.id).toBe('c');
  });

  it('counterpartResume falls back to the first resume in the other language when the link is missing, dangling or same-language', () => {
    expect(counterpartResume(profileOf([zh('a'), zh('x'), en('b'), en('c')], 'a'))?.id).toBe('b');
    expect(counterpartResume(profileOf([zh('a', { linkedResumeId: 'gone' }), en('b')], 'a'))?.id).toBe('b');
    expect(counterpartResume(profileOf([zh('a', { linkedResumeId: 'x' }), zh('x'), en('b')], 'a'))?.id).toBe('b');
    expect(counterpartResume(profileOf([en('b'), zh('a'), zh('x')], 'b'))?.id).toBe('a');
  });

  it('counterpartResume is null when every resume is in one language, or there is none', () => {
    expect(counterpartResume(profileOf([zh('a'), zh('x')], 'a'))).toBeNull();
    expect(counterpartResume(profileOf([], null))).toBeNull();
  });

  it('switchResumeLanguage makes the counterpart active, and a second click comes back', async () => {
    const sample = await saveProfile(createSampleProfile());
    expect(sample.activeResumeId).toBe('sample-zh');
    expect((await switchResumeLanguage())?.id).toBe('sample-en');
    expect((await loadProfile()).activeResumeId).toBe('sample-en');
    expect((await switchResumeLanguage())?.id).toBe('sample-zh');
    expect((await loadProfile()).activeResumeId).toBe('sample-zh');
  });

  it('switchResumeLanguage returns null and writes nothing when there is no other language', async () => {
    await saveProfile(profileOf([zh('a'), zh('x')], 'a'));
    const cb = vi.fn();
    const stop = watchProfile(cb);
    expect(await switchResumeLanguage()).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    expect((await loadProfile()).activeResumeId).toBe('a');
    stop();
  });

  it('setUiLanguage stores the language and leaves the resumes untouched', async () => {
    const before = await saveProfile(createSampleProfile());
    vi.setSystemTime(T0 + 60_000);
    await setUiLanguage('en');
    const after = await loadProfile();
    expect(after.settings.uiLanguage).toBe('en');
    expect(after.settings.previewBeforeFill).toBe(before.settings.previewBeforeFill);
    expect(after.resumes).toEqual(before.resumes);
    await setUiLanguage('zh');
    expect((await loadProfile()).settings.uiLanguage).toBe('zh');
  });
});
