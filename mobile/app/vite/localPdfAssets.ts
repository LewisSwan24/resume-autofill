// Puts pdf.js's worker (legacy build) and its font tables into the app at fixed names under pdfjs/, so reading a PDF on
// the phone needs nothing from the network. In the dev server the same paths are answered from node_modules.
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const WORKER_URL = '/pdfjs/pdf.worker.min.mjs';
const CMAP_URL = /^\/pdfjs\/cmaps\/([A-Za-z0-9._-]+\.bcmap)$/;
const CMAP_NAME = /^[A-Za-z0-9._-]+\.bcmap$/;

export function localPdfAssets(options: { pdfjsRoot?: string } = {}): Plugin {
  const root = options.pdfjsRoot ?? path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const workerFile = path.join(root, 'legacy', 'build', 'pdf.worker.min.mjs');
  const cmapDir = path.join(root, 'cmaps');

  return {
    name: 'raf-local-pdf-assets',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'pdfjs/pdf.worker.min.mjs', source: readFileSync(workerFile) });
      for (const name of readdirSync(cmapDir)) {
        if (!CMAP_NAME.test(name)) continue;
        this.emitFile({ type: 'asset', fileName: `pdfjs/cmaps/${name}`, source: readFileSync(path.join(cmapDir, name)) });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return next();
        const url = (req.url ?? '').split('?')[0]!;
        let file: string;
        let type: string;
        if (url === WORKER_URL) {
          file = workerFile;
          type = 'text/javascript';
        } else {
          // Only a plain checked name is ever joined to the folder: no slash, no percent sign, no dot-dot path.
          const name = CMAP_URL.exec(url)?.[1];
          if (!name) return next();
          file = path.join(cmapDir, name);
          type = 'application/octet-stream';
        }
        readFile(file).then(
          (body) => {
            res.setHeader('Content-Type', type);
            res.end(body);
          },
          () => next(),
        );
      });
    },
  };
}
