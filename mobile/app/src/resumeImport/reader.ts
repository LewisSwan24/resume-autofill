// A PDF or Word file to a draft resume, on the phone. pdf.js runs in a module worker loaded from the app itself, never
// on the main thread; Word is read on the main thread because the extractor needs DOMParser. Nothing is logged, and the
// bytes are held only for the length of a call.
/// <reference path="./vendor.d.ts" />
import { extractDocx, type DocxToHtml } from '../../../../src/import/extract/docx';
import { extractPdf, type PdfLoader } from '../../../../src/import/extract/pdf';
import type { ExtractFailure, ExtractResult } from '../../../../src/import/extract/types';
import { parseResume } from '../../../../src/import/parse';
import { cleanLines } from '../../../../src/import/parse/clean';
import { detectLanguage } from './language';
import { pdfAssetUrls } from './pdfAssets';
import { sniffFile } from './sniff';
import type { ImportFailure, ImportFile, ReadOptions, ReadOutcome, ResumeReader } from './types';

type WorkerOptionsLike = { workerPort: Worker | null; workerSrc: string };
type Pdfjs = { getDocument: unknown; GlobalWorkerOptions: WorkerOptionsLike };

export interface ReaderDeps {
  /** Default: () => import('pdfjs-dist/legacy/build/pdf.min.mjs'). */
  loadPdfjs?: () => Promise<{ getDocument: unknown; GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string } }>;
  /** Default: (url) => new Worker(url, { type: 'module' }). */
  createWorker?: (url: string) => Worker;
  /** Default: mammoth.browser's convertToHtml, loaded on first use. */
  docxToHtml?: DocxToHtml;
  /** Default: document.baseURI. */
  assetBase?: string;
  /** Tests in Node only: let pdf.js read in-process when there is no Worker. Never set by the app. */
  allowInProcess?: boolean;
  /** Default 60_000. */
  workerIdleMs?: number;
}

const FAILURES: Record<ExtractFailure, ImportFailure> = {
  encrypted: 'encrypted',
  no_text: 'no_text',
  too_large: 'too_large',
  unsupported: 'wrong_type',
  failed: 'failed',
};

const CANCELLED = Symbol('cancelled');

/** The promise's value, or CANCELLED as soon as the signal fires: a library that answers late is not waited for. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof CANCELLED> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(CANCELLED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(CANCELLED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(signal.aborted ? CANCELLED : value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) resolve(CANCELLED);
        else reject(error);
      },
    );
  });
}

/** One frame, so the progress screen can show the next step before the parser takes the thread. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    // A page in the background gets no frames; the timer keeps the read going there.
    const timer = setTimeout(resolve, typeof requestAnimationFrame === 'function' ? 100 : 0);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
}

const defaultLoadPdfjs = (): Promise<Pdfjs> => import('pdfjs-dist/legacy/build/pdf.min.mjs');
const defaultDocxToHtml = async (): Promise<DocxToHtml> => {
  const { default: mammoth } = await import('mammoth/mammoth.browser.min.js');
  return mammoth.convertToHtml as DocxToHtml;
};

export function createResumeReader(deps: ReaderDeps = {}): ResumeReader {
  const idleMs = deps.workerIdleMs ?? 60_000;
  let pdfjsLoading: Promise<Pdfjs> | null = null;
  let docxLoading: Promise<DocxToHtml> | null = null;
  let worker: Worker | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pdfReads = 0;

  const retire = (pdfjs: Pdfjs): void => {
    idleTimer = undefined;
    if (!worker || pdfReads > 0) return;
    worker.terminate();
    if (pdfjs.GlobalWorkerOptions.workerPort === worker) pdfjs.GlobalWorkerOptions.workerPort = null;
    worker = null;
  };

  /** The worker, made on first use and handed to pdf.js before any document. Null when none can be made. */
  const workerFor = (pdfjs: Pdfjs, url: string): Worker | null => {
    if (!worker) {
      const make = deps.createWorker ?? (typeof Worker === 'undefined' ? null : (u: string) => new Worker(u, { type: 'module' }));
      if (!make) return null;
      try {
        worker = make(url);
      } catch {
        return null;
      }
    }
    pdfjs.GlobalWorkerOptions.workerSrc = url;
    pdfjs.GlobalWorkerOptions.workerPort = worker;
    return worker;
  };

  const readPdf = async (file: ImportFile, signal: AbortSignal | undefined): Promise<ExtractResult | typeof CANCELLED> => {
    const loading = (pdfjsLoading ??= (deps.loadPdfjs ?? defaultLoadPdfjs)());
    let pdfjs: Pdfjs;
    try {
      const loaded = await unlessAborted(loading, signal);
      if (loaded === CANCELLED) return CANCELLED;
      pdfjs = loaded;
    } catch {
      pdfjsLoading = null;
      return { ok: false, reason: 'failed' };
    }
    const urls = pdfAssetUrls(deps.assetBase ?? document.baseURI);
    clearTimeout(idleTimer);
    pdfReads++;
    const tasks: { destroy?(): Promise<void> }[] = [];
    const destroyAll = () => {
      for (const task of tasks) void task.destroy?.()?.catch(() => undefined);
    };
    signal?.addEventListener('abort', destroyAll, { once: true });
    try {
      // The app never parses a PDF on the main thread: no worker means no reading.
      if (!workerFor(pdfjs, urls.worker) && !deps.allowInProcess) return { ok: false, reason: 'failed' };
      const getDocument = pdfjs.getDocument as PdfLoader;
      const load: PdfLoader = (params) => {
        const task = getDocument(params);
        tasks.push(task);
        if (signal?.aborted) void task.destroy?.()?.catch(() => undefined);
        return task;
      };
      return await unlessAborted(extractPdf(file.bytes, load, urls.cMaps), signal);
    } finally {
      signal?.removeEventListener('abort', destroyAll);
      pdfReads--;
      if (pdfReads === 0 && worker) idleTimer = setTimeout(() => retire(pdfjs), idleMs);
    }
  };

  const readDocx = async (file: ImportFile, signal: AbortSignal | undefined): Promise<ExtractResult | typeof CANCELLED> => {
    let toHtml: DocxToHtml;
    if (deps.docxToHtml) toHtml = deps.docxToHtml;
    else {
      try {
        const loaded = await unlessAborted((docxLoading ??= defaultDocxToHtml()), signal);
        if (loaded === CANCELLED) return CANCELLED;
        toHtml = loaded;
      } catch {
        docxLoading = null;
        return { ok: false, reason: 'failed' };
      }
    }
    return unlessAborted(extractDocx(file.bytes, toHtml), signal);
  };

  return async (file: ImportFile, options: ReadOptions = {}): Promise<ReadOutcome> => {
    const { signal, onPhase } = options;
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };
    const sniffed = sniffFile(file);
    if ('problem' in sniffed) return { ok: false, reason: sniffed.problem };
    try {
      onPhase?.('reading');
      const result = sniffed.kind === 'pdf' ? await readPdf(file, signal) : await readDocx(file, signal);
      if (result === CANCELLED || signal?.aborted) return { ok: false, reason: 'cancelled' };
      if (!result.ok) return { ok: false, reason: FAILURES[result.reason] };

      onPhase?.('recognising');
      await nextFrame();
      if (signal?.aborted) return { ok: false, reason: 'cancelled' };
      const lines = cleanLines(result.lines);
      const draft = parseResume(result.lines);
      const language = detectLanguage(lines, draft.locale);
      if (draft.fields.length === 0) return { ok: false, reason: 'nothing_found', locale: language.locale };
      return { ok: true, kind: sniffed.kind, lines, draft: { ...draft, locale: language.locale }, pages: result.pages, language };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  };
}

/** The app's reader, with the default deps. */
export const readResume: ResumeReader = createResumeReader();
