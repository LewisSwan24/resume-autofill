// PDF to lines. Only text is taken: nothing is rendered, and nothing in the file gets to run.
import { linesOfPage, type Piece } from './lines';
import { MAX_FILE_BYTES, type ExtractResult, type TextLine } from './types';

/** Below this many characters a page on average, the file is pictures of text. */
const MIN_CHARS_PER_PAGE = 30;
/** No resume runs longer, and a file saying it has a million pages is only trying to be slow. */
export const MAX_PDF_PAGES = 50;
/** Pieces of text across the whole file. Reading stops here, in the middle of a page if need be. */
export const MAX_PDF_ITEMS = 100_000;
/** A resume takes a second or two. Whatever a file is doing by now, it is not being read. */
export const MAX_PDF_MS = 30_000;

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}
interface PdfPage {
  getViewport(params: { scale: number }): { width: number };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  streamTextContent?(): { getReader(): PdfTextReader };
  cleanup?(): void;
}
interface PdfTextReader {
  read(): Promise<{ done: boolean; value?: { items: PdfTextItem[] } }>;
  cancel(): Promise<void>;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy?(): Promise<void>;
}
export interface PdfLoadParams {
  data: Uint8Array;
  isEvalSupported: false;
  disableFontFace: true;
  useSystemFonts: false;
  disableAutoFetch: true;
  disableStream: true;
  cMapUrl?: string;
  cMapPacked: true;
}
/** `pdfjs.getDocument`, passed in: an extension page and a test load the library differently. */
export type PdfLoader = (params: PdfLoadParams) => { promise: Promise<PdfDocument>; destroy?(): Promise<void> };

/** The text of a page, taken in pieces where the library can, so that a page holding millions stops at the limit. */
async function itemsOfPage(page: PdfPage, room: number): Promise<PdfTextItem[]> {
  if (!page.streamTextContent) return (await page.getTextContent()).items.slice(0, room);
  const reader = page.streamTextContent().getReader();
  const items: PdfTextItem[] = [];
  try {
    while (items.length < room) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value?.items ?? []) items.push(item);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return items.slice(0, room);
}

function piecesOf(items: PdfTextItem[]): Piece[] {
  return items.flatMap((item) => {
    const t = item.transform;
    if (!t || !item.str) return [];
    const fontSize = Math.abs(t[3] ?? 0) || item.height || 0;
    return [{ text: item.str, x: t[4] ?? 0, y: t[5] ?? 0, width: item.width ?? 0, fontSize }];
  });
}

export async function extractPdf(data: Uint8Array, load: PdfLoader, cMapUrl?: string): Promise<ExtractResult> {
  if (data.byteLength > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('out of time')), MAX_PDF_MS);
  });
  try {
    let doc: PdfDocument;
    const task = load({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      cMapPacked: true,
      ...(cMapUrl ? { cMapUrl } : {}),
    });
    try {
      doc = await Promise.race([task.promise, outOfTime]);
    } catch (error) {
      void task.destroy?.()?.catch(() => undefined);
      const encrypted = (error as { name?: string } | null)?.name === 'PasswordException';
      return { ok: false, reason: encrypted ? 'encrypted' : 'failed' };
    }
    try {
      return await Promise.race([readPages(doc), outOfTime]);
    } catch {
      return { ok: false, reason: 'failed' };
    } finally {
      // Not waited for: a file that has stopped answering may not answer this either.
      void doc.destroy?.()?.catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readPages(doc: PdfDocument): Promise<ExtractResult> {
  const lines: TextLine[] = [];
  let pages = 0;
  let items = 0;
  while (pages < Math.min(doc.numPages, MAX_PDF_PAGES) && items < MAX_PDF_ITEMS) {
    pages++;
    const page = await doc.getPage(pages);
    const content = await itemsOfPage(page, MAX_PDF_ITEMS - items);
    items += content.length;
    for (const line of linesOfPage(piecesOf(content), pages, page.getViewport({ scale: 1 }).width)) lines.push(line);
    page.cleanup?.();
  }
  const chars = lines.reduce((sum, l) => sum + l.text.replace(/\s/g, '').length, 0);
  if (chars / Math.max(pages, 1) < MIN_CHARS_PER_PAGE) return { ok: false, reason: 'no_text' };
  return { ok: true, lines, pages };
}
