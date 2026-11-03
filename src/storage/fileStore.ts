// Attachment storage in IndexedDB (database `raf-files`, object store `files`, key = id).
// Files are kept out of `storage.local` so resumes stay small and JSON-only. Bytes are stored as an\n// ArrayBuffer (not a Blob) so the same code works in any structured-clone implementation.
import type { FileData } from '../drivers/types';

export const FILE_DB_NAME = 'raf-files';
const STORE = 'files';
const DB_VERSION = 1;

export interface FileRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

/** Shape persisted in IndexedDB: raw bytes (structured-clone safe) rather than a Blob. */
interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  data: ArrayBuffer;
  createdAt: number;
}

export interface PutFileInput {
  /** Reuse an id to overwrite that record; omitted → a new id is generated. */
  id?: string;
  name: string;
  type: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(FILE_DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another context upgrading/deleting the DB must not be blocked by us.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to open file database'));
    req.onblocked = () => reject(new Error('File database open blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('File transaction aborted'));
  });
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** `Blob.arrayBuffer()` with a FileReader fallback for environments lacking it. */
async function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const toRecord = (s: StoredFile): FileRecord => ({
  id: s.id,
  name: s.name,
  type: s.type,
  size: s.size,
  createdAt: s.createdAt,
  blob: new Blob([s.data], { type: s.type }),
});

/** Store (or overwrite) a file; resolves to its id. */
export async function putFile(input: PutFileInput): Promise<string> {
  const data = await readBytes(input.blob);
  const record: StoredFile = {
    id: input.id ?? newId(),
    name: input.name,
    type: input.type,
    size: data.byteLength,
    data,
    createdAt: Date.now(),
  };
  await run('readwrite', (s) => s.put(record));
  return record.id;
}

export async function getFile(id: string): Promise<FileRecord | undefined> {
  const stored = await run<StoredFile | undefined>('readonly', (s) => s.get(id));
  return stored ? toRecord(stored) : undefined;
}

/** Deleting an unknown id is a no-op. */
export async function deleteFile(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** All stored files, oldest first. */
export async function listFiles(): Promise<FileRecord[]> {
  const all = await run<StoredFile[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt).map(toRecord);
}

const CHUNK = 0x8000;

/** `data:<type>;base64,...` for a stored file (empty type → application/octet-stream). */
export async function fileToDataUrl(record: Pick<FileRecord, 'type' | 'blob'>): Promise<string> {
  const bytes = new Uint8Array(await readBytes(record.blob));
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${record.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** Driver-ready payload (`FileData`) for a stored file. */
export async function fileToFileData(record: FileRecord): Promise<FileData> {
  return { name: record.name, type: record.type, dataUrl: await fileToDataUrl(record) };
}

/** Test helper: close the connection and delete the whole database. */
export async function resetFileStoreForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise.catch(() => null))?.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(FILE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

