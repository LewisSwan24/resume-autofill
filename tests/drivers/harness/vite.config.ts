// Builds the in-page driver test harness as a single IIFE: tests/drivers/harness/dist/harness.js.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./entry.ts', import.meta.url)),
      formats: ['iife'],
      name: '__rafHarness',
      fileName: () => 'harness.js',
    },
  },
});
