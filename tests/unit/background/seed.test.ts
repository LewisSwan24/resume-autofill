import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { dataUrlToBlob, seedSamplesIfEmpty } from '../../../src/background/seed';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';
import { getFile, listFiles, loadProfile, resetFileStoreForTests, saveProfile } from '../../../src/storage';

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
});

describe('dataUrlToBlob', () => {
  it('decodes base64 payloads and keeps the type', async () => {
    const blob = dataUrlToBlob('data:text/plain;base64,aGVsbG8=');
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(5);
  });
  it('rejects things that are not data urls', () => {
    expect(() => dataUrlToBlob('https://example.com/x.png')).toThrow();
  });
});

describe('seedSamplesIfEmpty', () => {
  it('seeds the sample profile and every sample file under the ids the profile references', async () => {
    expect(await seedSamplesIfEmpty()).toBe(true);

    const profile = await loadProfile();
    expect(profile.resumes.length).toBe(createSampleProfile().resumes.length);
    expect(profile.activeResumeId).toBe(profile.resumes[0]!.id);

    const expected = createSampleFiles();
    for (const [id, file] of Object.entries(expected)) {
      const stored = await getFile(id);
      expect(stored?.name).toBe(file.name);
      expect(stored?.type).toBe(file.type);
    }
    for (const r of profile.resumes) {
      for (const id of [r.attachments.resumeFileId, r.attachments.photoFileId]) {
        if (id) expect(await getFile(id)).toBeDefined();
      }
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seedSamplesIfEmpty();
    const before = await loadProfile();
    const filesBefore = (await listFiles()).map((f) => f.id);

    expect(await seedSamplesIfEmpty()).toBe(false);

    expect(await loadProfile()).toEqual(before);
    expect((await listFiles()).map((f) => f.id)).toEqual(filesBefore);
  });

  it('never touches an existing profile', async () => {
    const mine = createSampleProfile();
    mine.resumes = [{ ...mine.resumes[0]!, id: 'mine', title: 'My own resume' }];
    mine.activeResumeId = 'mine';
    await saveProfile(mine);

    expect(await seedSamplesIfEmpty()).toBe(false);

    const profile = await loadProfile();
    expect(profile.resumes.map((r) => r.id)).toEqual(['mine']);
    expect(await listFiles()).toEqual([]);
  });

  it('keeps settings of an existing resume-less profile', async () => {
    const empty = await loadProfile();
    await saveProfile({ ...empty, settings: { ...empty.settings, uiLanguage: 'en' } });
    expect(await seedSamplesIfEmpty()).toBe(true);
    expect((await loadProfile()).settings.uiLanguage).toBe('en');
  });

  it('leaves corrupt stored data alone', async () => {
    await fakeBrowser.storage.local.set({ profile: { schemaVersion: 999, garbage: true } });
    expect(await seedSamplesIfEmpty()).toBe(false);
    expect((await fakeBrowser.storage.local.get('profile')).profile).toEqual({ schemaVersion: 999, garbage: true });
    expect(await listFiles()).toEqual([]);
  });
});
