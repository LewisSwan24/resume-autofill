import { beforeEach, describe, expect, it } from 'vitest';
import {
  FILE_DB_NAME,
  deleteFile,
  fileToDataUrl,
  fileToFileData,
  getFile,
  listFiles,
  putFile,
  resetFileStoreForTests,
} from '../../../src/storage';

const textBlob = (s: string, type = 'text/plain') => new Blob([s], { type });

beforeEach(async () => {
  await resetFileStoreForTests();
});

describe('fileStore', () => {
  it('uses the documented database name', () => {
    expect(FILE_DB_NAME).toBe('raf-files');
  });

  it('puts a file, generating an id, and gets it back', async () => {
    const id = await putFile({ name: 'cv.txt', type: 'text/plain', blob: textBlob('hello') });
    expect(id).toBeTruthy();
    const rec = await getFile(id);
    expect(rec).toMatchObject({ id, name: 'cv.txt', type: 'text/plain', size: 5 });
    expect(rec!.createdAt).toBeTypeOf('number');
    expect(rec!.blob.size).toBe(5);
    expect(await fileToDataUrl(rec!)).toBe('data:text/plain;base64,aGVsbG8=');
  });

  it('uses a caller-provided id and overwrites that record', async () => {
    await putFile({ id: 'photo', name: 'a.png', type: 'image/png', blob: textBlob('one', 'image/png') });
    const id = await putFile({ id: 'photo', name: 'b.png', type: 'image/png', blob: textBlob('three', 'image/png') });
    expect(id).toBe('photo');
    expect(await listFiles()).toHaveLength(1);
    expect(await getFile('photo')).toMatchObject({ name: 'b.png', size: 5 });
  });

  it('returns undefined for unknown ids', async () => {
    expect(await getFile('nope')).toBeUndefined();
  });

  it('lists all files, oldest first', async () => {
    const a = await putFile({ id: 'a', name: 'a', type: 'text/plain', blob: textBlob('1') });
    const b = await putFile({ id: 'b', name: 'b', type: 'text/plain', blob: textBlob('2') });
    const list = await listFiles();
    expect(list.map((f) => f.id)).toEqual([a, b]);
  });

  it('deletes files; deleting a missing id is a no-op', async () => {
    const id = await putFile({ name: 'x', type: 'text/plain', blob: textBlob('x') });
    await deleteFile(id);
    expect(await getFile(id)).toBeUndefined();
    await expect(deleteFile('missing')).resolves.toBeUndefined();
    expect(await listFiles()).toEqual([]);
  });

  it('converts a record to a data URL with the record mime type', async () => {
    const id = await putFile({ name: 'a.txt', type: 'text/plain', blob: textBlob('hello') });
    const rec = (await getFile(id))!;
    expect(await fileToDataUrl(rec)).toBe('data:text/plain;base64,aGVsbG8=');
  });

  it('handles binary content and falls back to octet-stream', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const id = await putFile({ name: 'bin', type: '', blob: new Blob([bytes]) });
    const rec = (await getFile(id))!;
    expect(await fileToDataUrl(rec)).toBe('data:application/octet-stream;base64,AAEC+v8=');
  });

  it('handles large files without stack overflow', async () => {
    const big = new Uint8Array(1024 * 1024).fill(65);
    const id = await putFile({ name: 'big', type: 'application/octet-stream', blob: new Blob([big]) });
    const url = await fileToDataUrl((await getFile(id))!);
    expect(url.startsWith('data:application/octet-stream;base64,QUFB')).toBe(true);
    expect(url.length).toBe('data:application/octet-stream;base64,'.length + Math.ceil((1024 * 1024) / 3) * 4);
  });

  it('fileToFileData yields the driver FileData shape', async () => {
    const id = await putFile({ name: 'a.txt', type: 'text/plain', blob: textBlob('hello') });
    expect(await fileToFileData((await getFile(id))!)).toEqual({
      name: 'a.txt',
      type: 'text/plain',
      dataUrl: 'data:text/plain;base64,aGVsbG8=',
    });
  });
});
