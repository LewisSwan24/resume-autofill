// Builds the mobile app's web UI into mobile/app/dist, which Capacitor copies into the Android project.
// React, zod and the plugin come from the repository root; the page imports src/editor, src/schema and src/i18n.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localPdfAssets } from './vite/localPdfAssets.ts';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
/** The app's version for the About sheet in the browser preview (on a phone it comes from the installed package). */
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [react(), localPdfAssets()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
