// Attachment file storage of the mobile app: the same contract over memory, the native vault (faked here) and
// IndexedDB, plus the sweep that clears files no resume points at.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIndexedDbFileStore,
  createMemoryFileStore,
  createVaultFileStore,
  sweepFiles,
  type FileStore,
  type FileVaultPlugin,
} from '../../../mobile/app/src/store/fileStore';
import { resetFileStoreForTests } from '../../../src/storage/fileStore';

/** What the Java plugin keeps: per id an encrypted meta file and an encrypted data file, either may be missing. */
function fakeVault() {
  const meta = new Map<string, string>();
  const data = new Map<string, string>();
  const plugin: FileVaultPlugin = {
    async writeFile({ id, meta: m, data: d }) {
      data.set(id, d);
      meta.set(id, m);
    },
    async readFile({ id }) {
      return { meta: meta.get(id) ?? null, data: meta.has(id) ? (data.get(id) ?? null) : null };
    },
    async readFileMeta({ id }) {
      return { meta: meta.get(id) ?? null };
    },
    async deleteFile({ id }) {
      meta.delete(id);
      data.delete(id);
    },
    async listFiles() {
      return { ids: [...new Set([...meta.keys(), ...data.keys()])] };
    },
  };
  return { plugin, meta, data };
}

const every = new Uint8Array(256).map((_, i) => i);

const backends: [string, () => FileStore][] = [
  ['memory', () => createMemoryFileStore()],
  ['vault', () => createVaultFileStore(fakeVault().plugin)],
  ['IndexedDB', () => createIndexedDbFileStore()],
];

afterEach(async () => {
  await resetFileStoreForTests();
});

describe.each(backends)('%s file store', (_name, make) => {
  it('keeps the name, type, size and every byte of a file', async () => {
    const files = make();
    const stored = await files.put({ name: '简历.pdf', type: 'application/pdf', bytes: every });
    expect(stored).toMatchObject({ name: '简历.pdf', type: 'application/pdf', size: 256 });
    expect(stored.id).toBeTruthy();
    expect(await files.info(stored.id)).toEqual(stored);
    const read = await files.read(stored.id);
    expect(read?.info).toEqual(stored);
    expect([...read!.bytes]).toEqual([...every]);
  });

  it('gives each file its own id, lists them, and removes one', async () => {
    const files = make();
    const a = await files.put({ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });
    const b = await files.put({ name: 'b.png', type: 'image/png', bytes: new Uint8Array([2]) });
    expect(a.id).not.toBe(b.id);
    expect((await files.list()).sort()).toEqual([a.id, b.id].sort());
    await files.remove(a.id);
    expect(await files.list()).toEqual([b.id]);
    expect(await files.info(a.id)).toBeNull();
    expect(await files.read(a.id)).toBeNull();
  });

  it('treats an unknown id as no file', async () => {
    const files = make();
    expect(await files.info('nope')).toBeNull();
    expect(await files.read('nope')).toBeNull();
    await expect(files.remove('nope')).resolves.toBeUndefined();
  });
});

describe('vault file store', () => {
  it('sends the bytes as base64 and the details as JSON', async () => {
    const vault = fakeVault();
    const files = createVaultFileStore(vault.plugin);
    const stored = await files.put({ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array([0, 255, 16]) });
    expect(vault.data.get(stored.id)).toBe('AP8Q');
    expect(JSON.parse(vault.meta.get(stored.id)!)).toEqual(stored);
  });

  it('lists a half-written file (data without details) so a sweep can clear it, but never shows it', async () => {
    const vault = fakeVault();
    vault.data.set('half', 'AA==');
    const files = createVaultFileStore(vault.plugin);
    expect(await files.list()).toEqual(['half']);
    expect(await files.info('half')).toBeNull();
    expect(await sweepFiles(files, new Set())).toEqual(['half']);
    expect(vault.data.size).toBe(0);
  });

  it('keeps a large file intact through base64', async () => {
    const files = createVaultFileStore(fakeVault().plugin);
    const big = new Uint8Array(200_003).map((_, i) => (i * 7) % 256);
    const stored = await files.put({ name: 'big.pdf', type: 'application/pdf', bytes: big });
    const read = await files.read(stored.id);
    expect(read!.bytes.length).toBe(big.length);
    expect(read!.bytes.every((v, i) => v === big[i])).toBe(true);
  });
});

describe('sweepFiles', () => {
  it('removes only the files not in the keep set', async () => {
    const files = createMemoryFileStore();
    const kept = await files.put({ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array([1]) });
    const orphan = await files.put({ name: 'b.pdf', type: 'application/pdf', bytes: new Uint8Array([2]) });
    expect(await sweepFiles(files, new Set([kept.id, 'not-stored']))).toEqual([orphan.id]);
    expect(await files.list()).toEqual([kept.id]);
  });
});
