// WOFF 1.0 → sfnt (TTF/OTF), Node stdlib only. Used by gen-native-theme.mjs to turn the
// bundled @fontsource/lexend WOFF files into the TTFs the keyboard loads from res/font, with no download.
// Format: https://www.w3.org/TR/WOFF/ — a 44-byte header, a 20-byte entry per table, then each table's data,
// zlib-compressed when compLength < origLength. Metadata and private blocks are dropped (fonts do not need them).
import { inflateSync } from 'node:zlib';

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const HEADER = 44;
const ENTRY = 20;

const pad4 = (n) => (n + 3) & ~3;

/** @param {Buffer} buf a WOFF 1.0 file  @returns {Buffer} the sfnt it wraps */
export function woffToSfnt(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER) throw new Error('woff: file too short');
  if (buf.readUInt32BE(0) !== WOFF_SIGNATURE) throw new Error('woff: bad signature');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  if (numTables === 0) throw new Error('woff: no tables');
  if (HEADER + ENTRY * numTables > buf.length) throw new Error('woff: table directory outside the file');

  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const at = HEADER + ENTRY * i;
    const tag = buf.readUInt32BE(at);
    const offset = buf.readUInt32BE(at + 4);
    const compLength = buf.readUInt32BE(at + 8);
    const origLength = buf.readUInt32BE(at + 12);
    const checksum = buf.readUInt32BE(at + 16);
    if (offset + compLength > buf.length) throw new Error('woff: table data outside the file');
    if (compLength > origLength) throw new Error('woff: compressed table longer than the original');
    const raw = buf.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : raw;
    if (data.length !== origLength) throw new Error('woff: table length mismatch');
    tables.push({ tag, checksum, data });
  }

  let pow2 = 1;
  let entrySelector = 0;
  while (pow2 * 2 <= numTables) {
    pow2 *= 2;
    entrySelector += 1;
  }
  const searchRange = pow2 * 16;
  const rangeShift = numTables * 16 - searchRange;

  const dirEnd = 12 + 16 * numTables;
  const size = tables.reduce((s, t) => s + pad4(t.data.length), dirEnd);
  const out = Buffer.alloc(size); // zero-filled, so padding is zeros
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(rangeShift, 10);
  let offset = dirEnd;
  tables.forEach((t, i) => {
    const at = 12 + 16 * i;
    out.writeUInt32BE(t.tag, at);
    out.writeUInt32BE(t.checksum, at + 4);
    out.writeUInt32BE(offset, at + 8);
    out.writeUInt32BE(t.data.length, at + 12);
    t.data.copy(out, offset);
    offset += pad4(t.data.length);
  });
  return out;
}
