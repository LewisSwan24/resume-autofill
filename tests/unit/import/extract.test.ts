// The real libraries on made-up files. The samples come from scripts/make-resume-samples.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { extractDocx, linesOfHtml, MAX_DOCUMENT_BYTES, type DocxToHtml } from '../../../src/import/extract/docx';
import { findGutter, linesOfPage, type Piece } from '../../../src/import/extract/lines';
import { extractPdf, MAX_PDF_PAGES, type PdfLoader } from '../../../src/import/extract/pdf';
import { MAX_FILE_BYTES, type ExtractResult } from '../../../src/import/extract/types';

const sample = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join('fixtures', 'resume-samples', name)));
const CMAPS = `${path.resolve('node_modules/pdfjs-dist/cmaps').replace(/\\/g, '/')}/`;
const load = getDocument as unknown as PdfLoader;
const toHtml: DocxToHtml = (input) => mammoth.convertToHtml({ buffer: Buffer.from(input.arrayBuffer) } as never);

const pdf = (name: string): Promise<ExtractResult> => extractPdf(sample(name), load, CMAPS);
const textOf = (r: ExtractResult): string[] => (r.ok ? r.lines.map((l) => l.text) : []);

describe('PDF text', () => {
  it('reads Chinese, with labels and dates whole', async () => {
    const r = await pdf('zh-single.pdf');
    const lines = textOf(r);
    expect(lines[0]).toBe('林知远');
    expect(lines.some((l) => l.includes('zhiyuan.lin@example.com') && l.includes('13800138000'))).toBe(true);
    expect(lines).toContain('教育经历');
    expect(lines.join('\n')).toContain('2021.03 - 至今');
    expect(lines.join('\n')).toContain('页面加载时间缩短 40%');
  });

  it('keeps a company and its dates apart as cells of one line', async () => {
    const r = await pdf('en-single.pdf');
    expect(r.ok && r.lines.find((l) => l.text.startsWith('Example Software'))?.cells).toEqual(['Example Software Pty Ltd', 'Mar 2021 - Present']);
  });

  it('gives the name the largest font', async () => {
    const r = await pdf('en-single.pdf');
    if (!r.ok) throw new Error(r.reason);
    const largest = [...r.lines].sort((a, b) => b.fontSize - a.fontSize)[0];
    expect(largest?.text).toBe('Zhiyuan (Leo) Lin');
  });

  it('reads two columns one after the other', async () => {
    const lines = textOf(await pdf('en-two-columns.pdf'));
    const at = (s: string): number => lines.findIndex((l) => l.includes(s));
    for (const s of ['mia.harper@example.com', 'Bachelor of Design', 'Fictional Studio', 'Pretend Agency']) expect(at(s), s).toBeGreaterThanOrEqual(0);
    // Everything on the left comes before anything on the right, with no line mixing the two.
    expect(at('2014 - 2017')).toBeLessThan(at('Experience'));
    expect(lines.filter((l) => l.includes('Figma') && l.includes('Studio'))).toEqual([]);
  });

  it('does not take a single column with dates on the right for two columns', async () => {
    const r = await pdf('en-single.pdf');
    const lines = textOf(r);
    expect(lines.findIndex((l) => l.includes('Mar 2021'))).toBe(lines.findIndex((l) => l.includes('Example Software')));
  });

  it('says a scan has no text', async () => {
    expect(await pdf('image-only.pdf')).toEqual({ ok: false, reason: 'no_text' });
  });

  it('says a file needs a password, and never asks for it', async () => {
    expect(await pdf('encrypted.pdf')).toEqual({ ok: false, reason: 'encrypted' });
  });

  it('refuses a file over the limit before reading it', async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1);
    expect(await extractPdf(huge, () => { throw new Error('must not load'); })).toEqual({ ok: false, reason: 'too_large' });
  });

  it('says a broken file failed', async () => {
    expect(await extractPdf(new TextEncoder().encode('not a pdf at all'), load, CMAPS)).toEqual({ ok: false, reason: 'failed' });
  });

  it('never lets the library run code from the file', async () => {
    let seen: Record<string, unknown> = {};
    const spy: PdfLoader = (params) => {
      seen = params as unknown as Record<string, unknown>;
      return load(params);
    };
    await extractPdf(sample('en-single.pdf'), spy, CMAPS);
    expect(seen).toMatchObject({ isEvalSupported: false, disableFontFace: true, disableAutoFetch: true, disableStream: true });
  });
});

describe('Word text', () => {
  it('reads a table row as one line of cells', async () => {
    const r = await extractDocx(sample('zh-table.docx'), toHtml);
    if (!r.ok) throw new Error(r.reason);
    expect(r.lines.find((l) => l.text.startsWith('姓名'))?.cells).toEqual(['姓名：', '林知远', '性别：', '男']);
    expect(r.lines.find((l) => l.text.startsWith('2021.03'))?.cells).toEqual(['2021.03 - 至今', '示例科技有限公司', '高级前端工程师']);
  });

  it('reads plain paragraphs in order', async () => {
    const lines = textOf(await extractDocx(sample('en.docx'), toHtml));
    expect(lines[0]).toBe('Noah Bennett');
    expect(lines).toContain('Work Experience');
    expect(lines.indexOf('Education')).toBeGreaterThan(lines.indexOf('Work Experience'));
  });

  it('says the old format is not supported, without opening it', async () => {
    const r = await extractDocx(sample('old-format.doc'), () => { throw new Error('must not open'); });
    expect(r).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('takes markup as text', () => {
    const lines = linesOfHtml('<p>&lt;img src=x onerror=alert(1)&gt;</p><script>alert(1)</script>');
    expect(lines[0]?.text).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('columns', () => {
  const piece = (text: string, x: number, y: number, width = 50): Piece => ({ text, x, y, width, fontSize: 10 });

  it('finds no gutter when a line crosses the page', () => {
    const left = [800, 780, 760, 740].map((y) => piece('left', 50, y));
    const right = [800, 780, 760, 740].map((y) => piece('right', 300, y));
    expect(findGutter([...left, ...right], 600)).not.toBeNull();
    expect(findGutter([...left, ...right, piece('wide', 50, 720, 400)], 600)).toBeNull();
  });

  it('finds no gutter when the right side has too few lines to be a column', () => {
    const left = [800, 780, 760, 740].map((y) => piece('left', 50, y));
    expect(findGutter([...left, piece('2020', 500, 800), piece('2021', 500, 760)], 600)).toBeNull();
  });

  it('puts small gaps between words and none in Chinese', () => {
    const lines = linesOfPage([piece('Senior', 50, 800, 30), piece('Engineer', 83, 800, 40), piece('高级', 50, 780, 20), piece('工程师', 72, 780, 30)], 1, 600);
    expect(lines.map((l) => l.text)).toEqual(['Senior Engineer', '高级工程师']);
  });
});

describe('a file built to be slow or to use up the memory', () => {
  const piece = (x: number, y = 700): Piece => ({ text: 'word', x, y, width: 20, fontSize: 10 });
  const page = (items: unknown[]) => ({ getViewport: () => ({ width: 600 }), getTextContent: async () => ({ items }) });
  const item = { str: 'Some words on this page, long enough to count', transform: [1, 0, 0, 10, 0, 700], width: 100 };

  it.each([4e9, Infinity, 1e308])('makes no table as wide as a page that claims to be %d wide', (width) => {
    expect(findGutter([piece(0), piece(100)], width)).toBeNull();
    expect(linesOfPage([piece(0), piece(100)], 1, width).length).toBeGreaterThan(0);
  });

  it('takes a page holding far more pieces than any page has', () => {
    const many = Array.from({ length: 300_000 }, (_, i) => piece(i % 500, 700 - (i % 60) * 12));
    const started = Date.now();
    expect(linesOfPage(many, 1, 600).length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('takes pieces as wide as the page without walking every one across it', () => {
    const wide = Array.from({ length: 200_000 }, () => ({ ...piece(0), width: 1e9 }));
    const started = Date.now();
    findGutter(wide, 14_400);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops after as many pages as a resume could have', async () => {
    let asked = 0;
    const load = (() => ({ promise: Promise.resolve({ numPages: 1_000_000, getPage: async () => (asked++, page([item])) }) })) as unknown as PdfLoader;
    const r = await extractPdf(new Uint8Array(1), load);
    expect(r.ok).toBe(true);
    expect(asked).toBeLessThanOrEqual(MAX_PDF_PAGES);
  });

  it('stops once it has read more text than a resume could hold', async () => {
    let asked = 0;
    const heavy = Array.from({ length: 200_000 }, () => item);
    const load = (() => ({ promise: Promise.resolve({ numPages: MAX_PDF_PAGES, getPage: async () => (asked++, page(heavy)) }) })) as unknown as PdfLoader;
    expect((await extractPdf(new Uint8Array(1), load)).ok).toBe(true);
    expect(asked).toBeLessThanOrEqual(2);
  });

  /** Just the parts of a zip that say what is in it. */
  function zipClaiming(entries: [string, number][]): Uint8Array {
    const parts: number[] = [0x50, 0x4b, 0x03, 0x04];
    const u16 = (n: number) => [n & 255, (n >>> 8) & 255];
    const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const start = parts.length;
    for (const [name, size] of entries) {
      const bytes = [...Buffer.from(name)];
      parts.push(0x50, 0x4b, 0x01, 0x02, ...Array(20).fill(0), ...u32(size), ...u16(bytes.length), ...Array(16).fill(0), ...bytes);
    }
    const length = parts.length - start;
    parts.push(0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...u16(entries.length), ...u16(entries.length), ...u32(length), ...u32(start), 0, 0);
    return new Uint8Array(parts);
  }
  const never: DocxToHtml = () => {
    throw new Error('should not be opened');
  };

  it.each([
    ['a body too big to read', [['word/document.xml', MAX_DOCUMENT_BYTES + 1]]],
    ['a size too big to write down', [['word/document.xml', 0xffffffff]]],
    ['a pile of parts that add up', Array.from({ length: 40 }, (_, i) => [`word/media/${i}.png`, 4_000_000])],
  ] as [string, [string, number][]][])('refuses a Word file with %s before opening it', async (_name, entries) => {
    expect(await extractDocx(zipClaiming(entries), never)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('opens a Word file of a reasonable size', async () => {
    const r = await extractDocx(zipClaiming([['word/document.xml', 300_000], ['word/media/photo.png', 2_000_000]]), async () => ({ value: '<p>Mia Harper</p>' }));
    expect(textOf(r)).toEqual(['Mia Harper']);
  });
});
