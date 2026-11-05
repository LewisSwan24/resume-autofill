// A chosen file to lines, in the options page only. The parsers load when a file is chosen, and everything stays local:
// the font tables pdf.js needs for Chinese come with the extension, and nothing is fetched from anywhere else.
import { browser } from 'wxt/browser';
import { extractDocx, type DocxToHtml } from './extract/docx';
import { extractPdf, type PdfLoader } from './extract/pdf';
import { MAX_FILE_BYTES, type ExtractResult } from './extract/types';

/** Inside the extension package, written there at build time (see wxt.config.ts). */
export const PDF_ASSET_DIR = 'pdfjs';

async function readPdf(data: Uint8Array): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL(`/${PDF_ASSET_DIR}/pdf.worker.min.mjs` as '/');
  return extractPdf(data, pdfjs.getDocument as unknown as PdfLoader, browser.runtime.getURL(`/${PDF_ASSET_DIR}/cmaps/` as '/'));
}

async function readDocx(data: Uint8Array): Promise<ExtractResult> {
  const { default: mammoth } = await import('mammoth/mammoth.browser.min.js');
  return extractDocx(data, mammoth.convertToHtml as DocxToHtml);
}

export async function readResumeFile(file: File): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) return { ok: false, reason: 'unsupported' };
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    return name.endsWith('.pdf') ? await readPdf(data) : await readDocx(data);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
