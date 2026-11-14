// Attachment files for the mobile app (resume PDF, photo, transcript). One contract, three backends, like the
// profile store: the native ProfileVault plugin (each file encrypted in the app's private folder), IndexedDB when the
// page is previewed in a desktop browser, and memory for tests.

export interface FileInfo {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export interface FileStore {
  /** Store a new file under a fresh id. */
  put(input: { name: string; type: string; bytes: Uint8Array }): Promise<FileInfo>;
  /** Name, type, size and date of a stored file; null when there is no such file. */
  info(id: string): Promise<FileInfo | null>;
  /** The file's bytes too; null when there is no such file. */
  read(id: string): Promise<{ info: FileInfo; bytes: Uint8Array } | null>;
  /** Removing an unknown id is a no-op. */
  remove(id: string): Promise<void>;
  /** Ids of every stored file, including half-written ones, so a sweep can clear them. */
  list(): Promise<string[]>;
}

/** The native side (see ProfileVaultPlugin.java). `meta` is the FileInfo as JSON; `data` is base64. */
export interface FileVaultPlugin {
  writeFile(options: { id: string; meta: string; data: string }): Promise<void>;
  readFile(options: { id: string }): Promise<{ meta: string | null; data: string | null }>;
  readFileMeta(options: { id: string }): Promise<{ meta: string | null }>;
  deleteFile(options: { id: string }): Promise<void>;
  listFiles(): Promise<{ ids: string[] }>;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `Blob.arrayBuffer()` with a FileReader fallback for environments lacking it. */
export async function readBlob(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const describe = (input: { name: string; type: string; bytes: Uint8Array }): FileInfo => ({
  id: newId(),
  name: input.name,
  type: input.type,
  size: input.bytes.length,
  createdAt: Date.now(),
});

export function createMemoryFileStore(): FileStore {
  const files = new Map<string, { info: FileInfo; bytes: Uint8Array }>();
  return {
    async put(input) {
      const info = describe(input);
      files.set(info.id, { info, bytes: input.bytes.slice() });
      return { ...info };
    },
    async info(id) {
      const file = files.get(id);
      return file ? { ...file.info } : null;
    },
    async read(id) {
      const file = files.get(id);
      return file ? { info: { ...file.info }, bytes: file.bytes.slice() } : null;
    },
    async remove(id) {
      files.delete(id);
    },
    async list() {
      return [...files.keys()];
    },
  };
}

export function createVaultFileStore(vault: FileVaultPlugin): FileStore {
  const parse = (meta: string | null): FileInfo | null => (meta === null ? null : (JSON.parse(meta) as FileInfo));
  return {
    async put(input) {
      const info = describe(input);
      await vault.writeFile({ id: info.id, meta: JSON.stringify(info), data: toBase64(input.bytes) });
      return info;
    },
    async info(id) {
      return parse((await vault.readFileMeta({ id })).meta);
    },
    async read(id) {
      const { meta, data } = await vault.readFile({ id });
      const info = parse(meta);
      return info && data !== null ? { info, bytes: fromBase64(data) } : null;
    },
    async remove(id) {
      await vault.deleteFile({ id });
    },
    async list() {
      return (await vault.listFiles()).ids;
    },
  };
}

/** Over the extension's own IndexedDB file store (src/storage/fileStore.ts), for previewing in a desktop browser. */
export function createIndexedDbFileStore(): FileStore {
  const db = import('../../../../src/storage/fileStore');
  const infoOf = (r: { id: string; name: string; type: string; size: number; createdAt: number }): FileInfo => ({
    id: r.id,
    name: r.name,
    type: r.type,
    size: r.size,
    createdAt: r.createdAt,
  });
  return {
    async put(input) {
      const { putFile, getFile } = await db;
      const id = await putFile({ name: input.name, type: input.type, blob: new Blob([input.bytes as BlobPart], { type: input.type }) });
      return infoOf((await getFile(id))!);
    },
    async info(id) {
      const record = await (await db).getFile(id);
      return record ? infoOf(record) : null;
    },
    async read(id) {
      const record = await (await db).getFile(id);
      return record ? { info: infoOf(record), bytes: await readBlob(record.blob) } : null;
    },
    async remove(id) {
      await (await db).deleteFile(id);
    },
    async list() {
      return (await (await db).listFiles()).map((r) => r.id);
    },
  };
}

/** Delete every stored file whose id is not in `keep`. Resolves to the removed ids. */
export async function sweepFiles(files: FileStore, keep: ReadonlySet<string>): Promise<string[]> {
  const removed = (await files.list()).filter((id) => !keep.has(id));
  for (const id of removed) await files.remove(id);
  return removed;
}
