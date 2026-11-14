// The bytes decide what a file is: never its name, never the type the sender gave it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sniffFile } from '../../../../mobile/app/src/resumeImport/sniff';
import { IMPORT_MAX_BYTES } from '../../../../mobile/app/src/resumeImport/types';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join('tests', 'unit', 'mobile', 'fixtures', 'import', name)));
const sample = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join('fixtures', 'resume-samples', name)));
const sniff = (bytes: Uint8Array, name = 'file', mimeType = '') => sniffFile({ bytes, name, mimeType });

/** A zip holding these names, each a little text. */
function zipOf(names: string[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const data = Buffer.from('<x/>');
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(head, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

describe('sniffFile', () => {
  it('knows a PDF by its header even when the type says octet-stream', () => {
    expect(sniff(fixture('zh-zhangsan.pdf'), 'download', 'application/octet-stream')).toEqual({ kind: 'pdf' });
    // A little junk before the header is still a PDF.
    const late = new Uint8Array([...new TextEncoder().encode('\n\n  '), ...new TextEncoder().encode('%PDF-1.7\n')]);
    expect(sniff(late, 'x.bin')).toEqual({ kind: 'pdf' });
  });

  it('knows a .docx by word/document.xml in its zip, whatever its name', () => {
    expect(sniff(fixture('zh-zhangsan.docx'), 'resume.pdf', 'application/pdf')).toEqual({ kind: 'docx' });
    expect(sniff(zipOf(['[Content_Types].xml', 'word/document.xml']), 'noname')).toEqual({ kind: 'docx' });
  });

  it('calls an OLE file old_word', () => {
    expect(sniff(sample('old-format.doc'), 'resume.docx')).toEqual({ problem: 'old_word' });
  });

  it('calls a zip without word/document.xml wrong_type', () => {
    expect(sniff(zipOf(['content.xml', 'mimetype']), 'resume.docx')).toEqual({ problem: 'wrong_type' });
    // The local header alone, with no directory at all, is not enough either.
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'resume.docx')).toEqual({ problem: 'wrong_type' });
  });

  it('calls text and a PNG wrong_type, and zero bytes empty', () => {
    expect(sniff(new TextEncoder().encode('张三 简历'), 'resume.pdf', 'application/pdf')).toEqual({ problem: 'wrong_type' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniff(png, 'resume.pdf')).toEqual({ problem: 'wrong_type' });
    expect(sniff(new Uint8Array(0), 'resume.pdf', 'application/pdf')).toEqual({ problem: 'empty' });
  });

  it('says too_large above 10 MB without reading past the length', () => {
    class Untouchable extends Uint8Array {
      constructor(length: number) {
        super(0);
        Object.defineProperty(this, 'length', { value: length });
        Object.defineProperty(this, 'byteLength', { value: length });
        return new Proxy(this, {
          get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error(`read byte ${key}`);
            if (key === 'subarray' || key === 'slice' || key === Symbol.iterator) throw new Error(`called ${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
        });
      }
    }
    const big = new Untouchable(IMPORT_MAX_BYTES + 1);
    expect(() => big[0]).toThrow();
    expect(sniff(big, 'resume.pdf', 'application/pdf')).toEqual({ problem: 'too_large' });
    // Exactly the limit is still looked at.
    const atLimit = new Uint8Array(IMPORT_MAX_BYTES);
    atLimit.set(new TextEncoder().encode('%PDF-1.4'));
    expect(sniff(atLimit)).toEqual({ kind: 'pdf' });
  });
});
