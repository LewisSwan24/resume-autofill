// What a file is, from its bytes. Its name and the type the sender gave it never decide, because either can be wrong.
import { IMPORT_MAX_BYTES, type ImportFile, type ImportKind } from './types';

export type Sniffed = { kind: ImportKind } | { problem: 'too_large' | 'wrong_type' | 'old_word' | 'empty' };

/** A PDF may have a little junk before its header; readers look this far. */
const PDF_HEADER_WITHIN = 1024;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
/** The old Word format, and every other OLE compound file. */
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const END_RECORD = 0x06054b50;
const ENTRY_RECORD = 0x02014b50;
const MAX_ZIP_COMMENT = 0xffff;
const WORD_DOCUMENT = 'word/document.xml';

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((x, i) => b[at + i] === x);

function hasPdfHeader(b: Uint8Array): boolean {
  const last = Math.min(b.length, PDF_HEADER_WITHIN) - PDF_HEADER.length;
  for (let i = 0; i <= last; i++) if (startsWith(b, PDF_HEADER, i)) return true;
  return false;
}

/** Whether the zip's central directory names word/document.xml. A directory that does not line up says no. */
function zipHoldsWordDocument(b: Uint8Array): boolean {
  if (b.length < 22) return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - MAX_ZIP_COMMENT; i--) {
    if (view.getUint32(i, true) === END_RECORD) {
      end = i;
      break;
    }
  }
  if (end < 0) return false;
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  if (at + size > end) return false;
  const decoder = new TextDecoder();
  for (let seen = 0; seen < count && at + 46 <= end; seen++) {
    if (view.getUint32(at, true) !== ENTRY_RECORD) return false;
    const nameLength = view.getUint16(at + 28, true);
    if (at + 46 + nameLength > end) return false;
    if (decoder.decode(b.subarray(at + 46, at + 46 + nameLength)) === WORD_DOCUMENT) return true;
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return false;
}

export function sniffFile(file: Pick<ImportFile, 'bytes' | 'name' | 'mimeType'>): Sniffed {
  // The length only: a file over the limit is not looked into at all.
  const size = file.bytes.byteLength;
  if (size === 0) return { problem: 'empty' };
  if (size > IMPORT_MAX_BYTES) return { problem: 'too_large' };
  const b = file.bytes;
  if (hasPdfHeader(b)) return { kind: 'pdf' };
  if (startsWith(b, OLE)) return { problem: 'old_word' };
  if (startsWith(b, ZIP) && zipHoldsWordDocument(b)) return { kind: 'docx' };
  return { problem: 'wrong_type' };
}
