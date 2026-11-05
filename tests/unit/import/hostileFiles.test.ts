// Files built to take the page down: what they say about themselves has to line up before anything is unpacked,
// and reading a PDF stops at its limit and at its deadline, whatever the file does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDocx, MAX_DOCUMENT_BYTES } from '../../../src/import/extract/docx';
import { extractPdf, MAX_PDF_ITEMS, MAX_PDF_MS, type PdfLoader } from '../../../src/import/extract/pdf';
import { parseResume } from '../../../src/import/parse';

interface Part {
  name: string;
  size: number;
}

/** The directory of a zip and its end record, which is all that is read before anything is unpacked. */
function zip(parts: Part[], options: { prefix?: number; count?: number; size?: number } = {}): Uint8Array {
  const encoder = new TextEncoder();
  const prefix = options.prefix ?? 0;
  const records = parts.map((part) => {
    const name = encoder.encode(part.name);
    const record = new Uint8Array(46 + name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, part.size, true);
    view.setUint16(28, name.length, true);
    record.set(name, 46);
    return record;
  });
  const directory = records.reduce((sum, r) => sum + r.length, 0);
  const out = new Uint8Array(2 + prefix + directory + 22);
  out.set([0x50, 0x4b], 0);
  let at = 2 + prefix;
  for (const record of records) {
    out.set(record, at);
    at += record.length;
  }
  const view = new DataView(out.buffer);
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 10, options.count ?? parts.length, true);
  view.setUint32(at + 12, options.size ?? directory, true);
  view.setUint32(at + 16, 2, true);
  return out;
}

const read = async (data: Uint8Array) => {
  const toHtml = vi.fn(async () => ({ value: '<p>Mia Harper</p>' }));
  const result = await extractDocx(data, toHtml);
  return { result, unpacked: toHtml.mock.calls.length > 0 };
};
const big = MAX_DOCUMENT_BYTES + 1;

describe('a Word file built to be heavy', () => {
  it('reads an ordinary file', async () => {
    const { result, unpacked } = await read(zip([{ name: 'word/document.xml', size: 100_000 }, { name: 'word/media/photo.png', size: MAX_DOCUMENT_BYTES * 2 }]));
    expect(result.ok).toBe(true);
    expect(unpacked).toBe(true);
  });

  it.each(['word/document.xml', 'word/styles.xml', 'word/footnotes.xml', 'WORD/DOCUMENT.XML', '[Content_Types].xml', 'word/_rels/document.xml.rels'])('refuses too much text in %s', async (name) => {
    const { result, unpacked } = await read(zip([{ name, size: big }]));
    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(unpacked).toBe(false);
  });

  it('refuses more than it says in its count', async () => {
    const { result, unpacked } = await read(zip([{ name: 'word/a.png', size: 1 }, { name: 'word/document.xml', size: big }], { count: 1 }));
    expect(result.ok).toBe(false);
    expect(unpacked).toBe(false);
  });

  it('refuses a directory that is not where the file says', async () => {
    const { result, unpacked } = await read(zip([{ name: 'word/document.xml', size: big }], { prefix: 64 }));
    expect(result.ok).toBe(false);
    expect(unpacked).toBe(false);
  });

  it('refuses a directory that runs on past its end', async () => {
    const { result, unpacked } = await read(zip([{ name: 'word/document.xml', size: 10 }], { size: 10 }));
    expect(result.ok).toBe(false);
    expect(unpacked).toBe(false);
  });
});

const TEXT = 'Mia Harper builds fictional software at a fictional studio in Brisbane';
const piece = { str: TEXT, transform: [1, 0, 0, 12, 10, 700], width: 300, height: 12 };

function pdf(page: Record<string, unknown>): PdfLoader {
  const whole = { getViewport: () => ({ width: 600 }), ...page };
  return (() => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => whole, destroy: async () => undefined }) })) as unknown as PdfLoader;
}

describe('a PDF built to be slow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops reading a page at its limit and lets go of the rest', async () => {
    let chunks = 0;
    const cancel = vi.fn(async () => undefined);
    const streamTextContent = () => ({
      getReader: () => ({
        read: async () => {
          chunks++;
          return { done: false, value: { items: Array.from({ length: 1000 }, () => piece) } };
        },
        cancel,
      }),
    });
    const result = await extractPdf(new Uint8Array(4), pdf({ streamTextContent, getTextContent: () => { throw new Error('reads it all'); } }));
    expect(result.ok).toBe(true);
    expect(chunks * 1000).toBeLessThanOrEqual(MAX_PDF_ITEMS + 1000);
    expect(cancel).toHaveBeenCalled();
  });

  it('reads a file that comes to an end', async () => {
    let left = 2;
    const streamTextContent = () => ({
      getReader: () => ({
        read: async () => (left-- > 0 ? { done: false, value: { items: [piece] } } : { done: true }),
        cancel: async () => undefined,
      }),
    });
    const result = await extractPdf(new Uint8Array(4), pdf({ streamTextContent }));
    expect(result.ok && result.lines.length).toBeGreaterThan(0);
  });

  it('still reads with a library that has no stream', async () => {
    const result = await extractPdf(new Uint8Array(4), pdf({ getTextContent: async () => ({ items: [piece] }) }));
    expect(result.ok).toBe(true);
  });

  it('gives up on a page that never finishes', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(async () => undefined);
    const load = (() => ({
      promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 600 }), getTextContent: () => new Promise(() => undefined) }), destroy }),
    })) as unknown as PdfLoader;
    const reading = extractPdf(new Uint8Array(4), load);
    await vi.advanceTimersByTimeAsync(MAX_PDF_MS + 1);
    await expect(reading).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(destroy).toHaveBeenCalled();
  });

  it('gives up on a file that never opens', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(async () => undefined);
    const load = (() => ({ promise: new Promise(() => undefined), destroy })) as unknown as PdfLoader;
    const reading = extractPdf(new Uint8Array(4), load);
    await vi.advanceTimersByTimeAsync(MAX_PDF_MS + 1);
    await expect(reading).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(destroy).toHaveBeenCalled();
  });
});

describe('lines built to be slow to look through', () => {
  it.each([
    ['digits that end in letters', `${'1'.repeat(3990)}ab`],
    ['nothing but letters', 'a'.repeat(4000)],
    ['an address with no end', `${'a'.repeat(3000)}@${'b'.repeat(900)}`],
    ['digits and marks', '1-'.repeat(1990)],
    ['many short runs', '123 456 '.repeat(490)],
  ])('%s', (_name, text) => {
    const started = Date.now();
    const lines = Array.from({ length: 2000 }, () => ({ text, cells: [text], page: 1, fontSize: 0 }));
    parseResume(lines);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
