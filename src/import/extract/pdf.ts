// PDF to lines. Only text is taken: nothing is rendered, and nothing in the file gets to run.
import { linesOfPage, type Piece } from './lines';
import { MAX_FILE_BYTES, type ExtractResult, type TextLine } from './types';

/** Below this many characters a page on average, the file is pictures of text. */
const MIN_CHARS_PER_PAGE = 30;
/** No resume runs longer, and a file saying it has a million pages is only trying to be slow. */
export const MAX_PDF_PAGES = 50;
/** Pieces of text across the whole file. Reading stops at the end of the page that passes this. */
const MAX_PDF_ITEMS = 100_000;

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}
interface PdfPage {
  getViewport(params: { scale: number }): { width: number };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup?(): void;
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
export type PdfLoader = (params: PdfLoadParams) => { promise: Promise<PdfDocument> };

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
  let doc: PdfDocument;
  try {
    doc = await load({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      cMapPacked: true,
      ...(cMapUrl ? { cMapUrl } : {}),
    }).promise;
  } catch (error) {
    const encrypted = (error as { name?: string } | null)?.name === 'PasswordException';
    return { ok: false, reason: encrypted ? 'encrypted' : 'failed' };
  }
  try {
    const lines: TextLine[] = [];
    let pages = 0;
    let items = 0;
    while (pages < Math.min(doc.numPages, MAX_PDF_PAGES) && items < MAX_PDF_ITEMS) {
      pages++;
      const page = await doc.getPage(pages);
      const content = await page.getTextContent();
      items += content.items.length;
      for (const line of linesOfPage(piecesOf(content.items), pages, page.getViewport({ scale: 1 }).width)) lines.push(line);
      page.cleanup?.();
    }
    const chars = lines.reduce((sum, l) => sum + l.text.replace(/\s/g, '').length, 0);
    if (chars / Math.max(pages, 1) < MIN_CHARS_PER_PAGE) return { ok: false, reason: 'no_text' };
    return { ok: true, lines, pages };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    await doc.destroy?.();
  }
}
