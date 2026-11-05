// Word to lines, with a table row read as one line. The markup is only ever parsed, never put in a page.
import { MAX_FILE_BYTES, type ExtractResult, type TextLine } from './types';

export type DocxToHtml = (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;

const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const line = (cells: string[]): TextLine => ({ text: cells.join(' '), cells, page: 1, fontSize: 0 });

/** The zip signature every .docx starts with. The old .doc starts with something else. */
const isZip = (b: Uint8Array): boolean => b[0] === 0x50 && b[1] === 0x4b;

/** The text of a Word file, unpacked. A long resume is a small part of this. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** Everything in the file, unpacked, photos included. */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const END_RECORD = 0x06054b50;
const ENTRY_RECORD = 0x02014b50;
/** The end record is the last thing in a zip but for a comment of at most this length. */
const MAX_ZIP_COMMENT = 0xffff;

/** The parts holding markup, which are what gets read into memory as text. */
const IS_TEXT_PART = /\.(?:xml|rels)$/i;

/**
 * What a zip says it unpacks to, read before anything is unpacked: ten megabytes can hold ten gigabytes.
 * Its directory has to line up from end to end, or what it says cannot be taken as all there is, and the unzipper may
 * well read it differently. No end record at all is left for the unzipper to refuse. Lying about sizes is not caught.
 */
function problemWithZip(b: Uint8Array): 'too_large' | 'failed' | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - MAX_ZIP_COMMENT; i--) {
    if (view.getUint32(i, true) === END_RECORD) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  // The larger format these values give way to has no place in a file of ten megabytes.
  if (count === 0xffff || at === 0xffffffff || size === 0xffffffff) return 'too_large';
  if (at + size !== end) return 'failed';
  let total = 0;
  let seen = 0;
  while (at < end) {
    if (at + 46 > end || view.getUint32(at, true) !== ENTRY_RECORD) return 'failed';
    const unpacked = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLength));
    total += unpacked;
    if (total > MAX_UNPACKED_BYTES || (IS_TEXT_PART.test(name) && unpacked > MAX_DOCUMENT_BYTES)) return 'too_large';
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    seen++;
  }
  return at === end && seen === count ? null : 'failed';
}

const BLOCK = 'p, div, li, h1, h2, h3, h4, h5, h6, tr, td, th, br';

/** Words kept apart where the file keeps them apart, by a break or by a paragraph of their own. */
function pieces(el: Element): string[] {
  const clone = el.cloneNode(true) as Element;
  for (const block of Array.from(clone.querySelectorAll(BLOCK))) block.after(el.ownerDocument.createTextNode('\n'));
  return (clone.textContent ?? '').split('\n').map(squash).filter(Boolean);
}

export function linesOfHtml(html: string): TextLine[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: TextLine[] = [];
  const walk = (parent: Element): void => {
    for (const el of Array.from(parent.children)) {
      if (el.tagName === 'TABLE') {
        for (const row of Array.from(el.querySelectorAll('tr'))) {
          const cells = Array.from(row.children).map((c) => pieces(c).join(' ')).filter(Boolean);
          if (cells.length > 0) out.push(line(cells));
        }
      } else if (el.tagName === 'UL' || el.tagName === 'OL') {
        for (const item of Array.from(el.querySelectorAll('li'))) {
          for (const text of pieces(item)) out.push(line([text]));
        }
      } else {
        for (const text of pieces(el)) out.push(line([text]));
      }
    }
  };
  walk(doc.body);
  return out;
}

export async function extractDocx(data: Uint8Array, toHtml: DocxToHtml): Promise<ExtractResult> {
  if (data.byteLength > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };
  if (!isZip(data)) return { ok: false, reason: 'unsupported' };
  const problem = problemWithZip(data);
  if (problem) return { ok: false, reason: problem };
  try {
    const { value } = await toHtml({ arrayBuffer: data.slice().buffer as ArrayBuffer });
    const lines = linesOfHtml(value);
    return lines.length > 0 ? { ok: true, lines, pages: 1 } : { ok: false, reason: 'no_text' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
