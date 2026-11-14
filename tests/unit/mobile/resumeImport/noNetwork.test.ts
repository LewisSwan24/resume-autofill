// Reading a resume never touches the network: pdf.js is pointed only at the app's own files, the reader calls no
// network API, nothing in the import code names a web address, and the page's policy blocks the rest.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocxToHtml } from '../../../../src/import/extract/docx';
import { createResumeReader, type ReaderDeps } from '../../../../mobile/app/src/resumeImport/reader';
import type { ImportFile } from '../../../../mobile/app/src/resumeImport/types';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join('tests', 'unit', 'mobile', 'fixtures', 'import', name)));
const fileOf = (bytes: Uint8Array, name: string): ImportFile => ({ name, mimeType: '', bytes, source: 'picker' });

afterEach(() => vi.unstubAllGlobals());

describe('no network', () => {
  it('every URL given to pdf.js is on the page\'s origin under pdfjs/', async () => {
    const GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string } = { workerPort: null, workerSrc: '' };
    const seen: string[] = [];
    const getDocument = vi.fn((params: Record<string, unknown>) => {
      for (const value of Object.values(params)) if (typeof value === 'string') seen.push(value);
      return { promise: Promise.reject(new Error('stop here')), destroy: async () => undefined };
    });
    const workers: string[] = [];
    const read = createResumeReader({
      loadPdfjs: async () => ({ getDocument, GlobalWorkerOptions }),
      createWorker: (url) => {
        workers.push(url);
        return { terminate() {} } as unknown as Worker;
      },
    });
    await read(fileOf(fixture('zh-zhangsan.pdf'), 'a.pdf'));
    expect(getDocument).toHaveBeenCalledTimes(1);
    const all = [...workers, GlobalWorkerOptions.workerSrc, ...seen];
    expect(all).toHaveLength(3);
    const origin = new URL(document.baseURI).origin;
    for (const url of all) {
      expect(new URL(url).origin, url).toBe(origin);
      expect(new URL(url).pathname, url).toMatch(/^\/(?:.*\/)?pdfjs\//);
    }
  });

  it('reading the Chinese sample calls neither fetch, XMLHttpRequest nor WebSocket', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch');
    });
    const xhrSpy = vi.fn(function () {
      throw new Error('XMLHttpRequest');
    });
    const wsSpy = vi.fn(function () {
      throw new Error('WebSocket');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', wsSpy);

    const base = `${pathToFileURL(path.resolve('node_modules/pdfjs-dist')).href}/`;
    const onDisk = `${path.resolve('node_modules/pdfjs-dist/cmaps').replace(/\\/g, '/')}/`;
    const loadPdfjs: NonNullable<ReaderDeps['loadPdfjs']> = async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
      const getDocument = (params: { cMapUrl?: string }) => (pdfjs.getDocument as (p: unknown) => unknown)({ ...params, cMapUrl: onDisk });
      return { getDocument, GlobalWorkerOptions: pdfjs.GlobalWorkerOptions as never };
    };
    const docxToHtml: DocxToHtml = (input) => mammoth.convertToHtml({ buffer: Buffer.from(input.arrayBuffer) } as never);
    const read = createResumeReader({ loadPdfjs, docxToHtml, assetBase: base, allowInProcess: true });

    expect((await read(fileOf(fixture('zh-zhangsan.pdf'), 'a.pdf'))).ok).toBe(true);
    expect((await read(fileOf(fixture('zh-zhangsan.docx'), 'a.docx'))).ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });

  it('no http or https URL is written anywhere in mobile/app/src/resumeImport', () => {
    const dir = path.join('mobile', 'app', 'src', 'resumeImport');
    const files = readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isFile());
    expect(files).toContain('reader.ts');
    for (const name of files) expect(readFileSync(path.join(dir, name), 'utf8'), name).not.toMatch(/https?:\/\//i);
  });

  it('index.html allows connections only to self, blob: and data:, and no frames or form posts', () => {
    const html = readFileSync(path.join('mobile', 'app', 'index.html'), 'utf8');
    const metas = [...html.matchAll(/<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi)];
    expect(metas).toHaveLength(1);
    const content = /content="([^"]*)"/.exec(metas[0]![0])![1]!;
    const policy = new Map(
      content
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([name, ...values]) => [name!, values.join(' ')]),
    );
    expect(policy.get('connect-src')).toBe("'self' blob: data:");
    expect(policy.get('worker-src')).toBe("'self' blob:");
    expect(policy.get('img-src')).toBe("'self' blob: data:");
    expect(policy.get('font-src')).toBe("'self' data:");
    expect(policy.get('media-src')).toBe("'self' blob:");
    expect(policy.get('object-src')).toBe("'none'");
    expect(policy.get('frame-src')).toBe("'none'");
    expect(policy.get('form-action')).toBe("'none'");
    expect(policy.get('base-uri')).toBe("'self'");
    // Capacitor puts its bridge in the page as an inline script: these two would break the app.
    expect(policy.has('script-src')).toBe(false);
    expect(policy.has('default-src')).toBe(false);
  });
});
