import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// Decryption is made controllable: each call waits until the test releases it, so two change events can
// finish out of order (the second, newer one first) exactly as real AES-GCM calls sometimes do.
const releases: Array<() => void> = [];
vi.mock('../../../src/storage/vault', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/storage/vault')>();
  return {
    ...real,
    decryptProfileWithVault: (blob: { ct: string }) =>
      new Promise((resolve) => {
        releases.push(() => resolve(JSON.parse(blob.ct)));
      }),
  };
});

const { PROFILE_STORAGE_KEY, watchProfile } = await import('../../../src/storage');

const blob = (title: string) => ({
  __rafVault: 1,
  iv: 'x',
  ct: JSON.stringify({ schemaVersion: 2, resumes: [{ id: 'r', title, locale: 'en-AU' }], activeResumeId: 'r' }),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fakeBrowser.reset();
  releases.length = 0;
});

describe('watchProfile with an encrypted profile', () => {
  it('never delivers an older profile after a newer one', async () => {
    const seen: string[] = [];
    const stop = watchProfile((p) => seen.push(p.resumes[0]!.title));

    await fakeBrowser.storage.local.set({ [PROFILE_STORAGE_KEY]: blob('older') });
    await fakeBrowser.storage.local.set({ [PROFILE_STORAGE_KEY]: blob('newer') });
    await flush();
    // Finish in reverse order: the newer decryption first, then the older one.
    while (releases.length > 0) {
      releases.pop()!();
      await flush();
    }
    await flush();
    expect(seen.at(-1)).toBe('newer');
    expect(seen).not.toContain('older');
    stop();
  });
});
