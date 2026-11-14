// The phone's reader: the real pdf.js (legacy build) and mammoth on made-up files, then a fake pdf.js and a fake Worker
// for the worker's life, cancelling, and exactly what pdf.js is handed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocxToHtml } from '../../../../src/import/extract/docx';
import { createResumeReader, type ReaderDeps } from '../../../../mobile/app/src/resumeImport/reader';
import type { ImportFile, ReadOutcome, ReadPhase, ReadSuccess } from '../../../../mobile/app/src/resumeImport/types';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join('tests', 'unit', 'mobile', 'fixtures', 'import', name)));
const sample = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join('fixtures', 'resume-samples', name)));
const fileOf = (bytes: Uint8Array, name = 'resume.pdf'): ImportFile => ({ name, mimeType: '', bytes, source: 'picker' });

/** Where the app would find its assets: here, the pdfjs-dist folder, as a file URL. */
const ASSET_BASE = `${pathToFileURL(path.resolve('node_modules/pdfjs-dist')).href}/`;
const CMAPS_ON_DISK = `${path.resolve('node_modules/pdfjs-dist/cmaps').replace(/\\/g, '/')}/`;
const nodeDocxToHtml: DocxToHtml = (input) => mammoth.convertToHtml({ buffer: Buffer.from(input.arrayBuffer) } as never);

/** The real legacy pdf.js. Node reads font tables from a path, so the one URL the reader may give is turned into it. */
const realPdfjs: NonNullable<ReaderDeps['loadPdfjs']> = async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const getDocument = (params: { cMapUrl?: string }) => {
    if (params.cMapUrl !== `${ASSET_BASE}pdfjs/cmaps/`) throw new Error(`unexpected cMapUrl ${params.cMapUrl}`);
    return (pdfjs.getDocument as (p: unknown) => unknown)({ ...params, cMapUrl: CMAPS_ON_DISK });
  };
  return { getDocument, GlobalWorkerOptions: pdfjs.GlobalWorkerOptions as never };
};
const realReader = createResumeReader({ loadPdfjs: realPdfjs, docxToHtml: nodeDocxToHtml, assetBase: ASSET_BASE, allowInProcess: true });

const ok = (r: ReadOutcome): ReadSuccess => {
  if (!r.ok) throw new Error(`read failed: ${r.reason}`);
  return r;
};
const valueAt = (r: ReadSuccess, p: string): string | undefined => r.draft.fields.find((f) => f.path === p)?.value;

describe('reading real files', () => {
  it('reads the Chinese sample PDF: 张 and 三, the phone, the e-mail and 示例大学 are in the draft', async () => {
    const r = ok(await realReader(fileOf(fixture('zh-zhangsan.pdf'))));
    expect(r.kind).toBe('pdf');
    expect(r.pages).toBe(1);
    expect(valueAt(r, 'basics.familyName')).toBe('张');
    expect(valueAt(r, 'basics.givenName')).toBe('三');
    expect(valueAt(r, 'contact.phone')).toBe('13800138000');
    expect(valueAt(r, 'contact.email')).toBe('zhangsan@example.com');
    expect(valueAt(r, 'education.0.school')).toBe('示例大学');
  });

  it('reads the Word sample into the same paths', async () => {
    const pdf = ok(await realReader(fileOf(fixture('zh-zhangsan.pdf'))));
    const word = ok(await realReader(fileOf(fixture('zh-zhangsan.docx'), 'resume.docx')));
    expect(word.kind).toBe('docx');
    expect(word.pages).toBe(1);
    const byPath = (r: ReadSuccess) => Object.fromEntries(r.draft.fields.map((f) => [f.path, f.value]));
    expect(byPath(word)).toEqual(byPath(pdf));
  });

  it('every draft line number points at the line holding that value', async () => {
    for (const name of ['zh-zhangsan.pdf', 'zh-zhangsan.docx', 'en-sample.pdf']) {
      const r = ok(await realReader(fileOf(fixture(name), name)));
      for (const f of r.draft.fields) {
        expect(f.line, f.path).toBeGreaterThanOrEqual(0);
        expect(f.line, f.path).toBeLessThan(r.lines.length);
      }
      // Values kept as written are found word for word on their line.
      for (const p of ['contact.email', 'basics.familyName', 'basics.givenName', 'education.0.school', 'work.0.company', 'work.0.position']) {
        const f = r.draft.fields.find((x) => x.path === p);
        if (!f) continue;
        expect(r.lines[f.line]!.text, `${name} ${p}`).toContain(f.value);
      }
      const phone = r.draft.fields.find((x) => x.path === 'contact.phone')!;
      // A phone can lose its country code or gain a trunk 0, so its last eight digits are what must match.
      expect(r.lines[phone.line]!.text.replace(/\D/g, '')).toContain(phone.value.replace(/\D/g, '').slice(-8));
    }
  });

  it('a scan is no_text, a locked PDF is encrypted, a .doc is old_word', async () => {
    expect(await realReader(fileOf(sample('image-only.pdf')))).toEqual({ ok: false, reason: 'no_text' });
    expect(await realReader(fileOf(sample('encrypted.pdf')))).toEqual({ ok: false, reason: 'encrypted' });
    expect(await realReader(fileOf(sample('old-format.doc'), 'resume.doc'))).toEqual({ ok: false, reason: 'old_word' });
  });

  it('prose with nothing recognisable is nothing_found, with the language it is written in', async () => {
    expect(await realReader(fileOf(fixture('no-match.pdf')))).toEqual({ ok: false, reason: 'nothing_found', locale: 'en-AU' });
  });

  it('calls onPhase with reading, then recognising', async () => {
    const phases: ReadPhase[] = [];
    ok(await realReader(fileOf(fixture('zh-zhangsan.docx'), 'a.docx'), { onPhase: (p) => phases.push(p) }));
    expect(phases).toEqual(['reading', 'recognising']);
    // A file refused by its bytes never starts reading.
    const none: ReadPhase[] = [];
    await realReader(fileOf(new Uint8Array(0)), { onPhase: (p) => none.push(p) });
    expect(none).toEqual([]);
  });

  it('returns the detected language and sets the draft locale to it', async () => {
    const zh = ok(await realReader(fileOf(fixture('zh-zhangsan.pdf'))));
    expect(zh.language).toEqual({ locale: 'zh-CN', mixed: false });
    expect(zh.draft.locale).toBe('zh-CN');
    const en = ok(await realReader(fileOf(fixture('en-sample.pdf'))));
    expect(en.language).toEqual({ locale: 'en-AU', mixed: false });
    expect(en.draft.locale).toBe('en-AU');
    const mixed = ok(await realReader(fileOf(fixture('mixed.pdf'))));
    expect(mixed.language.mixed).toBe(true);
    expect(mixed.draft.locale).toBe(mixed.language.locale);
  });
});

// ---------------------------------------------------------------- with a fake pdf.js and a fake Worker

class FakeWorker {
  static made: FakeWorker[] = [];
  terminated = false;
  constructor(
    public url: string,
    public options?: WorkerOptions,
  ) {
    FakeWorker.made.push(this);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const TEXT = ['张三', '电话：13800138000 邮箱：zhangsan@example.com', '教育经历', '示例大学 2016.09 - 2020.06', '计算机科学与技术 本科'];

function fakeDoc() {
  const items = TEXT.map((str, i) => ({ str, transform: [12, 0, 0, 12, 50, 800 - i * 20], width: str.length * 12, height: 12 }));
  return {
    numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 600 }), getTextContent: async () => ({ items }) }),
    destroy: async () => undefined,
  };
}

interface FakeTask {
  params: Record<string, unknown>;
  portAtCall: unknown;
  srcAtCall: string;
  promise: Promise<unknown>;
  destroy: ReturnType<typeof vi.fn>;
  resolve(doc: unknown): void;
}

/** A pdf.js stand-in. `hold` keeps each document from loading until the test resolves it. */
function fakePdfjs(options: { hold?: boolean; rejectOnDestroy?: boolean } = {}) {
  const GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string } = { workerPort: null, workerSrc: '' };
  const tasks: FakeTask[] = [];
  const getDocument = vi.fn((params: Record<string, unknown>) => {
    let resolve!: (doc: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const task: FakeTask = {
      params,
      portAtCall: GlobalWorkerOptions.workerPort,
      srcAtCall: GlobalWorkerOptions.workerSrc,
      promise,
      resolve,
      destroy: vi.fn(async () => {
        if (options.rejectOnDestroy !== false) reject(Object.assign(new Error('destroyed'), { name: 'AbortException' }));
      }),
    };
    tasks.push(task);
    if (!options.hold) resolve(fakeDoc());
    return task;
  });
  const loadPdfjs = vi.fn(async () => ({ getDocument, GlobalWorkerOptions }));
  return { GlobalWorkerOptions, getDocument, tasks, loadPdfjs };
}

const PDF = fileOf(fixture('zh-zhangsan.pdf'));
const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  if (!check()) throw new Error('never happened');
};

afterEach(() => {
  FakeWorker.made = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the worker', () => {
  it('creates one module Worker from <origin>/pdfjs/pdf.worker.min.mjs and sets workerPort before getDocument', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pdfjs = fakePdfjs();
    const read = createResumeReader({ loadPdfjs: pdfjs.loadPdfjs, assetBase: 'https://localhost/' });
    ok(await read(PDF));
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.url).toBe('https://localhost/pdfjs/pdf.worker.min.mjs');
    expect(FakeWorker.made[0]!.options).toEqual({ type: 'module' });
    expect(pdfjs.tasks).toHaveLength(1);
    expect(pdfjs.tasks[0]!.portAtCall).toBe(FakeWorker.made[0]);
    expect(pdfjs.tasks[0]!.srcAtCall).toBe('https://localhost/pdfjs/pdf.worker.min.mjs');
  });

  it('reuses the worker for the next file and terminates it after the idle time', async () => {
    const pdfjs = fakePdfjs();
    const createWorker = vi.fn((url: string) => new FakeWorker(url) as unknown as Worker);
    const read = createResumeReader({ loadPdfjs: pdfjs.loadPdfjs, createWorker, assetBase: 'https://localhost/' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const settle = async (p: Promise<ReadOutcome>): Promise<ReadOutcome> => {
      let done = false;
      void p.then(() => (done = true));
      for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(1);
      return p;
    };
    ok(await settle(read(PDF)));
    ok(await settle(read(PDF)));
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(pdfjs.tasks[1]!.portAtCall).toBe(FakeWorker.made[0]);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(FakeWorker.made[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
    expect(pdfjs.GlobalWorkerOptions.workerPort).toBeNull();

    // The next file gets a fresh one.
    ok(await settle(read(PDF)));
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(pdfjs.tasks[2]!.portAtCall).toBe(FakeWorker.made[1]);
  });

  it('fails instead of reading on the main thread when no worker can be made', async () => {
    const pdfjs = fakePdfjs();
    const throwing = createResumeReader({
      loadPdfjs: pdfjs.loadPdfjs,
      createWorker: () => {
        throw new Error('no workers here');
      },
      assetBase: 'https://localhost/',
    });
    expect(await throwing(PDF)).toEqual({ ok: false, reason: 'failed' });
    // No Worker in this environment at all, and the default way to make one.
    expect(typeof globalThis.Worker).toBe('undefined');
    const missing = createResumeReader({ loadPdfjs: pdfjs.loadPdfjs, assetBase: 'https://localhost/' });
    expect(await missing(PDF)).toEqual({ ok: false, reason: 'failed' });
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
    expect(pdfjs.GlobalWorkerOptions.workerPort).toBeNull();
  });

  it('abort while loading destroys the loading task and resolves cancelled', async () => {
    const pdfjs = fakePdfjs({ hold: true });
    const read = createResumeReader({ loadPdfjs: pdfjs.loadPdfjs, createWorker: (u) => new FakeWorker(u) as unknown as Worker, assetBase: 'https://localhost/' });
    const controller = new AbortController();
    const phases: ReadPhase[] = [];
    const pending = read(PDF, { signal: controller.signal, onPhase: (p) => phases.push(p) });
    await until(() => pdfjs.tasks.length === 1);
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
    expect(pdfjs.tasks[0]!.destroy).toHaveBeenCalled();
    expect(phases).toEqual(['reading']);
  });

  it('a result arriving after abort is ignored', async () => {
    // This pdf.js does not stop when told to: the document still arrives, after the abort.
    const pdfjs = fakePdfjs({ hold: true, rejectOnDestroy: false });
    const read = createResumeReader({ loadPdfjs: pdfjs.loadPdfjs, createWorker: (u) => new FakeWorker(u) as unknown as Worker, assetBase: 'https://localhost/' });
    const controller = new AbortController();
    const phases: ReadPhase[] = [];
    const pending = read(PDF, { signal: controller.signal, onPhase: (p) => phases.push(p) });
    await until(() => pdfjs.tasks.length === 1);
    controller.abort();
    pdfjs.tasks[0]!.resolve(fakeDoc());
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
    expect(phases).toEqual(['reading']);
    // Already aborted before it starts: nothing is read at all.
    expect(await read(PDF, { signal: AbortSignal.abort() })).toEqual({ ok: false, reason: 'cancelled' });
    expect(pdfjs.tasks).toHaveLength(1);
  });

  it('passes pdf.js only the extractor\'s options and a same-origin cMapUrl', async () => {
    const pdfjs = fakePdfjs();
    const read = createResumeReader({ loadPdfjs: pdfjs.loadPdfjs, createWorker: (u) => new FakeWorker(u) as unknown as Worker, assetBase: 'https://localhost/' });
    ok(await read(PDF));
    expect(pdfjs.tasks[0]!.params).toEqual({
      data: PDF.bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      cMapPacked: true,
      cMapUrl: 'https://localhost/pdfjs/cmaps/',
    });
  });
});
