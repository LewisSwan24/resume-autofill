// pdf.js's worker and font tables come with the app, at fixed names, and nothing else is served from there.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localPdfAssets } from '../../../../mobile/app/vite/localPdfAssets';
import { PDF_ASSET_DIR, PDF_WORKER_FILE, pdfAssetUrls } from '../../../../mobile/app/src/resumeImport/pdfAssets';

const PDFJS = path.resolve('node_modules/pdfjs-dist');

interface Emitted {
  type: string;
  fileName: string;
  source: Uint8Array | string;
}

async function emitted(): Promise<Emitted[]> {
  const plugin = localPdfAssets();
  const out: Emitted[] = [];
  const hook = plugin.generateBundle as unknown as (this: unknown, ...args: unknown[]) => unknown;
  const fn = typeof hook === 'function' ? hook : (hook as { handler: typeof hook }).handler;
  await fn.call({ emitFile: (file: Emitted) => (out.push(file), 'ref') }, {}, {}, false);
  return out;
}

type Handler = (req: { url?: string; method?: string }, res: FakeResponse, next: () => void) => void;
interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | null;
  setHeader(name: string, value: string): void;
  end(body?: Buffer | string): void;
}

async function middleware(): Promise<Handler> {
  const plugin = localPdfAssets();
  let handler: Handler | null = null;
  const server = { middlewares: { use: (fn: Handler) => void (handler = fn) } };
  const hook = plugin.configureServer as unknown as (server: unknown) => unknown;
  const fn = typeof hook === 'function' ? hook : (hook as { handler: typeof hook }).handler;
  await fn(server);
  if (!handler) throw new Error('no middleware');
  return handler;
}

function request(handler: Handler, url: string): Promise<{ next: boolean; res: FakeResponse }> {
  return new Promise((resolve) => {
    const res: FakeResponse = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(body) {
        this.body = body === undefined ? null : Buffer.from(body);
        resolve({ next: false, res: this });
      },
    };
    handler({ url, method: 'GET' }, res, () => resolve({ next: true, res }));
  });
}

describe('pdf.js assets', () => {
  it('pdfAssetUrls gives absolute URLs under the base', () => {
    expect(PDF_ASSET_DIR).toBe('pdfjs');
    expect(PDF_WORKER_FILE).toBe('pdf.worker.min.mjs');
    expect(pdfAssetUrls('https://localhost/')).toEqual({
      worker: 'https://localhost/pdfjs/pdf.worker.min.mjs',
      cMaps: 'https://localhost/pdfjs/cmaps/',
    });
    expect(pdfAssetUrls('https://localhost/index.html')).toEqual({
      worker: 'https://localhost/pdfjs/pdf.worker.min.mjs',
      cMaps: 'https://localhost/pdfjs/cmaps/',
    });
    expect(pdfAssetUrls('http://127.0.0.1:5173/app/').worker).toBe('http://127.0.0.1:5173/app/pdfjs/pdf.worker.min.mjs');
  });

  it('the plugin emits the legacy worker at pdfjs/pdf.worker.min.mjs, byte for byte', async () => {
    const files = await emitted();
    const worker = files.filter((f) => f.fileName === 'pdfjs/pdf.worker.min.mjs');
    expect(worker).toHaveLength(1);
    expect(worker[0]!.type).toBe('asset');
    const expected = readFileSync(path.join(PDFJS, 'legacy', 'build', 'pdf.worker.min.mjs'));
    expect(Buffer.from(worker[0]!.source).equals(expected)).toBe(true);
  });

  it('the plugin emits every .bcmap under pdfjs/cmaps/, including UniGB-UCS2-H.bcmap', async () => {
    const files = await emitted();
    const cmaps = readdirSync(path.join(PDFJS, 'cmaps')).filter((n) => n.endsWith('.bcmap'));
    const names = files.filter((f) => f.fileName.startsWith('pdfjs/cmaps/')).map((f) => f.fileName);
    expect(names.sort()).toEqual(cmaps.map((n) => `pdfjs/cmaps/${n}`).sort());
    const gb = files.find((f) => f.fileName === 'pdfjs/cmaps/UniGB-UCS2-H.bcmap')!;
    expect(Buffer.from(gb.source).equals(readFileSync(path.join(PDFJS, 'cmaps', 'UniGB-UCS2-H.bcmap')))).toBe(true);
    expect(files.every((f) => f.type === 'asset' && !/[A-Za-z0-9]{8}\./.test(path.basename(f.fileName).replace(/\.bcmap$|\.min\.mjs$/, '')))).toBe(true);
  });

  it('the dev middleware serves a cmap and refuses ../ and names that are not .bcmap', async () => {
    const handler = await middleware();
    const cmap = await request(handler, '/pdfjs/cmaps/UniGB-UCS2-H.bcmap');
    expect(cmap.next).toBe(false);
    expect(cmap.res.headers['content-type']).toBe('application/octet-stream');
    expect(cmap.res.body!.equals(readFileSync(path.join(PDFJS, 'cmaps', 'UniGB-UCS2-H.bcmap')))).toBe(true);

    const worker = await request(handler, '/pdfjs/pdf.worker.min.mjs');
    expect(worker.res.headers['content-type']).toBe('text/javascript');
    expect(worker.res.body!.equals(readFileSync(path.join(PDFJS, 'legacy', 'build', 'pdf.worker.min.mjs')))).toBe(true);

    for (const url of [
      '/pdfjs/cmaps/../package.json',
      '/pdfjs/cmaps/..%2Fpackage.json',
      '/pdfjs/cmaps/%2e%2e%2f%2e%2e%2fpackage.json',
      '/pdfjs/cmaps/LICENSE',
      '/pdfjs/cmaps/sub/UniGB-UCS2-H.bcmap',
      '/pdfjs/cmaps/..\\..\\package.json.bcmap',
      '/pdfjs/pdf.min.mjs',
      '/pdfjs/../package.json',
      '/src/main.tsx',
    ]) {
      const r = await request(handler, url);
      expect(r.next, url).toBe(true);
      expect(r.res.body, url).toBeNull();
    }
    // A missing cmap with a fine name falls through too, so the server answers 404.
    expect((await request(handler, '/pdfjs/cmaps/Nothing-Here.bcmap')).next).toBe(true);
    // A query string does not change the answer.
    expect((await request(handler, '/pdfjs/cmaps/UniGB-UCS2-H.bcmap?v=1')).next).toBe(false);
  });
});
