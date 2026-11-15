// WOFF 1.0 → sfnt: the generator turns @fontsource/lexend's bundled WOFF files into the TTFs the
// keyboard loads, with no download. A synthetic WOFF checks the table directory, checksums, padding and the binary
// search fields of the rebuilt offset table.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

type WoffToSfnt = (buf: Buffer) => Buffer;
let woffToSfnt: WoffToSfnt;
beforeAll(async () => {
  // A computed specifier: the script is plain .mjs with no type declarations.
  const url = pathToFileURL(resolve(__dirname, '../../../../mobile/scripts/woff.mjs')).href;
  ({ woffToSfnt } = (await import(url)) as { woffToSfnt: WoffToSfnt });
});

interface Table {
  tag: string;
  data: Buffer;
  compress: boolean;
  checksum: number;
}

/** A WOFF 1.0 file holding the given tables, in the given (tag-sorted) order. */
function makeWoff(tables: Table[], flavor = 0x00010000, signature = 'wOFF'): Buffer {
  const header = 44;
  const dir = 20 * tables.length;
  const blobs = tables.map((t) => (t.compress ? deflateSync(t.data) : t.data));
  const pad4 = (n: number) => (n + 3) & ~3;
  let offset = header + dir;
  const offsets = blobs.map((b) => {
    const at = offset;
    offset += pad4(b.length);
    return at;
  });
  const total = offset;
  const sfntSize = 12 + 16 * tables.length + tables.reduce((s, t) => s + pad4(t.data.length), 0);
  const out = Buffer.alloc(total);
  out.write(signature, 0, 'latin1');
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(total, 8);
  out.writeUInt16BE(tables.length, 12);
  out.writeUInt16BE(0, 14);
  out.writeUInt32BE(sfntSize, 16);
  out.writeUInt16BE(1, 20);
  tables.forEach((t, i) => {
    const at = header + 20 * i;
    out.write(t.tag, at, 'latin1');
    out.writeUInt32BE(offsets[i]!, at + 4);
    out.writeUInt32BE(blobs[i]!.length, at + 8);
    out.writeUInt32BE(t.data.length, at + 12);
    out.writeUInt32BE(t.checksum, at + 16);
    blobs[i]!.copy(out, offsets[i]!);
  });
  return out;
}

const repetitive = Buffer.from('abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd'.repeat(4), 'latin1'); // 160 bytes, compresses well
const odd = Buffer.from([1, 2, 3, 4, 5]); // 5 bytes, stored, needs 3 bytes of padding
const small = Buffer.from([9, 8, 7, 6, 5, 4, 3]); // 7 bytes, stored

describe('woffToSfnt', () => {
  it('rebuilds the sfnt: table directory, checksums kept, 4-byte padding and binary-search fields', () => {
    const tables: Table[] = [
      { tag: 'AAAA', data: repetitive, compress: true, checksum: 0x11111111 },
      { tag: 'BBBB', data: odd, compress: false, checksum: 0x22222222 },
      { tag: 'CCCC', data: small, compress: false, checksum: 0x33333333 },
    ];
    const woff = makeWoff(tables);
    expect(woff.readUInt32BE(44 + 8)).toBeLessThan(repetitive.length); // the first table really is compressed
    const sfnt = woffToSfnt(woff);

    expect(sfnt.readUInt32BE(0)).toBe(0x00010000);
    expect(sfnt.readUInt16BE(4)).toBe(3);
    expect(sfnt.readUInt16BE(6)).toBe(32); // searchRange = 2^floor(log2 3) * 16
    expect(sfnt.readUInt16BE(8)).toBe(1); // entrySelector
    expect(sfnt.readUInt16BE(10)).toBe(16); // rangeShift = 3 * 16 - 32

    const start = 12 + 16 * 3;
    const expected = [
      { tag: 'AAAA', checksum: 0x11111111, offset: start, data: repetitive },
      { tag: 'BBBB', checksum: 0x22222222, offset: start + 160, data: odd },
      { tag: 'CCCC', checksum: 0x33333333, offset: start + 160 + 8, data: small },
    ];
    expected.forEach((e, i) => {
      const at = 12 + 16 * i;
      expect(sfnt.toString('latin1', at, at + 4)).toBe(e.tag);
      expect(sfnt.readUInt32BE(at + 4)).toBe(e.checksum);
      expect(sfnt.readUInt32BE(at + 8)).toBe(e.offset);
      expect(sfnt.readUInt32BE(at + 12)).toBe(e.data.length);
      expect(e.offset % 4).toBe(0);
      expect(sfnt.subarray(e.offset, e.offset + e.data.length).equals(e.data)).toBe(true);
    });
    expect(sfnt.subarray(start + 160 + 5, start + 160 + 8).equals(Buffer.alloc(3))).toBe(true); // zero padding
    expect(sfnt.length).toBe(start + 160 + 8 + 8);
    expect(sfnt.length).toBe(woff.readUInt32BE(16)); // totalSfntSize
  });

  it('works for one table and for a power-of-two table count', () => {
    const one = woffToSfnt(makeWoff([{ tag: 'head', data: odd, compress: false, checksum: 7 }]));
    expect([one.readUInt16BE(6), one.readUInt16BE(8), one.readUInt16BE(10)]).toEqual([16, 0, 0]);
    const four = woffToSfnt(
      makeWoff(['AAAA', 'BBBB', 'CCCC', 'DDDD'].map((tag) => ({ tag, data: small, compress: false, checksum: 1 }))),
    );
    expect([four.readUInt16BE(6), four.readUInt16BE(8), four.readUInt16BE(10)]).toEqual([64, 2, 0]);
  });

  it('keeps the flavor (OpenType CFF)', () => {
    expect(woffToSfnt(makeWoff([{ tag: 'CFF ', data: odd, compress: false, checksum: 0 }], 0x4f54544f)).readUInt32BE(0)).toBe(0x4f54544f);
  });

  it('throws on a bad signature', () => {
    expect(() => woffToSfnt(makeWoff([{ tag: 'AAAA', data: odd, compress: false, checksum: 0 }], 0x00010000, 'wOF2'))).toThrow();
  });

  it('throws when a table inflates to the wrong length or points outside the file', () => {
    const woff = makeWoff([{ tag: 'AAAA', data: repetitive, compress: true, checksum: 0 }]);
    const wrongLength = Buffer.from(woff);
    wrongLength.writeUInt32BE(repetitive.length + 4, 44 + 12);
    expect(() => woffToSfnt(wrongLength)).toThrow();
    const outside = Buffer.from(woff);
    outside.writeUInt32BE(woff.length + 100, 44 + 4);
    expect(() => woffToSfnt(outside)).toThrow();
    expect(() => woffToSfnt(Buffer.alloc(10))).toThrow();
  });
});
