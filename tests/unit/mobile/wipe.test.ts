// Delete all data: on the device one native call (files and Keystore key); in the preview and tests a sweep over
// the stores.
import { describe, expect, it, vi } from 'vitest';
import { createMemoryAppStateStore, defaultAppState } from '../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore } from '../../../mobile/app/src/store/fileStore';
import { createMemoryStore } from '../../../mobile/app/src/store/profileStore';
import { createStoreWiper, createVaultWiper } from '../../../mobile/app/src/store/wipe';
import { ProfileSchema, ResumeSchema } from '../../../src/schema';

describe('wipe', () => {
  it('store wiper: profile has no resumes, no files remain, app state reads null', async () => {
    const profile = createMemoryStore(
      ProfileSchema.parse({
        schemaVersion: 1,
        resumes: [ResumeSchema.parse({ id: 'a', title: '张三', locale: 'zh-CN' })],
        activeResumeId: 'a',
      }),
    );
    const files = createMemoryFileStore();
    await files.put({ name: 'resume.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) });
    await files.put({ name: 'photo.jpg', type: 'image/jpeg', bytes: new Uint8Array([4]) });
    const appState = createMemoryAppStateStore(defaultAppState({ onboardingDone: true }));

    await createStoreWiper({ profile, files, appState }).wipeAll();

    const after = await profile.load();
    expect(after.resumes).toEqual([]);
    expect(after.activeResumeId).toBeNull();
    expect(await files.list()).toEqual([]);
    expect(await appState.load()).toBeNull();
  });

  it('vault wiper: one native wipe call, nothing else', async () => {
    const vault = { wipe: vi.fn(async () => undefined) };
    await createVaultWiper(vault).wipeAll();
    expect(vault.wipe).toHaveBeenCalledTimes(1);
    expect(vault.wipe).toHaveBeenCalledWith();
  });

  it('vault wiper passes a failure on', async () => {
    const vault = { wipe: vi.fn(() => Promise.reject(new Error('WIPE_FAILED'))) };
    await expect(createVaultWiper(vault).wipeAll()).rejects.toThrow();
  });
});
