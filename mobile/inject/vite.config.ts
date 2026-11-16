// Builds the fill browser's page engine (entry.ts) into one IIFE, inject/dist/engine.js, that native injects at
// document start into every frame. `name` is only there because Vite's iife format asks for one: the entry exports
// nothing, so nothing is assigned to the page's window. scripts/copy-page-assets.mjs copies it into the APK assets.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { ZOD_INTRO, keepZodGlobalsLocal } from './zodGlobals';

const injectDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: injectDir,
  plugins: [keepZodGlobalsLocal()],
  publicDir: false,
  // The engine's own console.warn calls (src/fill/runFill.ts) carry field ids and errors; in a page that shares our
  // world the page could read them, so the bundle has no console calls at all.
  define: { 'process.env.NODE_ENV': '"production"', 'console.warn': '(() => {})', 'console.error': '(() => {})', 'console.log': '(() => {})' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    target: 'es2020',
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: {
      output: {
        // No code generation in the page: zod's JIT probes `Function('')` when the first schema is built, and a strict
        // page CSP reports that to the site. Its jitless switch must be set before any module runs, so it goes in
        // the IIFE's intro, on the IIFE-local holder that replaces globalThis inside zod (see zodGlobals.ts).
        intro: ZOD_INTRO,
      },
    },
    lib: {
      entry: fileURLToPath(new URL('./entry.ts', import.meta.url)),
      formats: ['iife'],
      name: '__rafEngine',
      fileName: () => 'engine.js',
    },
  },
});
