// Minimal, dependency-free STORED ZIP reader and writer with CRC-32 and zip-bomb bounds.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export const ZIP_MAX_ENTRIES = 256;
export const ZIP_MAX_TOTAL_BYTES = 120 * 1024 * 1024;
export const ZIP_MAX_ENTRY_BYTES = 25 * 1024 * 1024;

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

/** Package entries into an uncompressed (STORED) ZIP archive. */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`Too many ZIP entries (${entries.length} > ${ZIP_MAX_ENTRIES})`);
  }

  let totalBytes = 0;
  const encodedNames = entries.map((e) => {
    if (e.data.byteLength > ZIP_MAX_ENTRY_BYTES) {
      throw new Error(`ZIP entry "${e.name}" exceeds max size`);
    }
    totalBytes += e.data.byteLength;
    if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
      throw new Error('ZIP archive exceeds total size budget');
    }
    return own(enc.encode(e.name));
  });

  const lfhTotal = encodedNames.reduce((acc, name, i) => acc + 30 + name.byteLength + entries[i]!.data.byteLength, 0);
  const cdTotal = encodedNames.reduce((acc, name) => acc + 46 + name.byteLength, 0);
  const out = new Uint8Array(lfhTotal + cdTotal + 22);
  const view = new DataView(out.buffer);

  let offset = 0;
  const offsets: number[] = [];
  const crcs: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nameBytes = encodedNames[i]!;
    const crc = crc32(entry.data);
    offsets.push(offset);
    crcs.push(crc);

    view.setUint32(offset, SIG_LFH, true);
    view.setUint16(offset + 4, 20, true); // version needed: 2.0
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, 0, true); // STORED (no compression)
    view.setUint16(offset + 10, 0, true); // mod time
    view.setUint16(offset + 12, 0x5421, true); // static deterministic DOS date
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, entry.data.byteLength, true);
    view.setUint32(offset + 22, entry.data.byteLength, true);
    view.setUint16(offset + 26, nameBytes.byteLength, true);
    view.setUint16(offset + 28, 0, true); // extra length
    out.set(nameBytes, offset + 30);
    out.set(entry.data, offset + 30 + nameBytes.byteLength);
    offset += 30 + nameBytes.byteLength + entry.data.byteLength;
  }

  const cdStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nameBytes = encodedNames[i]!;
    view.setUint32(offset, SIG_CDH, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, FLAG_UTF8, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0x5421, true);
    view.setUint32(offset + 16, crcs[i]!, true);
    view.setUint32(offset + 20, entry.data.byteLength, true);
    view.setUint32(offset + 24, entry.data.byteLength, true);
    view.setUint16(offset + 28, nameBytes.byteLength, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, offsets[i]!, true);
    out.set(nameBytes, offset + 46);
    offset += 46 + nameBytes.byteLength;
  }

  view.setUint32(offset, SIG_EOCD, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, cdTotal, true);
  view.setUint32(offset + 16, cdStart, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}

export function isZipArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === SIG_LFH || view.getUint32(0, true) === SIG_EOCD;
}

/** Parse a STORED ZIP archive into an entry map using slices over the original buffer when safe. */
export function parseZip(bytes: Uint8Array): Map<string, Uint8Array<ArrayBuffer>> {
  if (bytes.byteLength < 22 || bytes.byteLength > ZIP_MAX_TOTAL_BYTES) {
    throw new Error('Invalid or oversized ZIP container');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocdOffset = -1;
  const searchMin = Math.max(0, bytes.byteLength - 22 - 65535);
  for (let i = bytes.byteLength - 22; i >= searchMin; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === bytes.byteLength) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP End-of-Central-Directory not found');

  const count = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (count > ZIP_MAX_ENTRIES || cdOffset + cdSize > eocdOffset) {
    throw new Error('ZIP directory out of bounds');
  }

  const out = new Map<string, Uint8Array<ArrayBuffer>>();
  let cursor = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== SIG_CDH) {
      throw new Error('Corrupt ZIP central directory');
    }
    const method = view.getUint16(cursor + 10, true);
    if (method !== 0) {
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compSize = view.getUint32(cursor + 20, true);
    const uncompSize = view.getUint32(cursor + 24, true);
    if (compSize !== uncompSize || uncompSize > ZIP_MAX_ENTRY_BYTES) {
      throw new Error('Invalid ZIP entry size');
    }
    totalUncompressed += uncompSize;
    if (totalUncompressed > ZIP_MAX_TOTAL_BYTES) {
      throw new Error('ZIP content exceeds total limit');
    }

    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const lfhOffset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLen + extraLen + commentLen > eocdOffset) {
      throw new Error('ZIP central directory entry truncated');
    }
    const name = dec.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (lfhOffset + 30 > cdOffset || view.getUint32(lfhOffset, true) !== SIG_LFH) {
      throw new Error(`Invalid local header for "${name}"`);
    }
    const lfhNameLen = view.getUint16(lfhOffset + 26, true);
    const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    if (dataStart + uncompSize > cdOffset) {
      throw new Error(`Entry "${name}" truncated`);
    }
    const data = own(bytes.subarray(dataStart, dataStart + uncompSize));
    if (crc32(data) !== expectedCrc) {
      throw new Error(`CRC-32 mismatch for "${name}"`);
    }
    out.set(name, data);
  }

  return out;
}
