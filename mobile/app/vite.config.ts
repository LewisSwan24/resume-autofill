// Builds the mobile app's web UI into mobile/app/dist, which Capacitor copies into the Android project.
// React, zod and the plugin come from the repository root; the page imports src/editor, src/schema and src/i18n.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [react()],
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
