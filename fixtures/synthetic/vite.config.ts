import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Multi-page fixture site. Served on a fixed port so Playwright / the extension e2e can rely on it.
export default defineConfig({
  root,
  base: '/',
  plugins: [react(), vue()],
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page('./index.html'),
        native: page('./native/index.html'),
        nativeFrame: page('./native/frame.html'),
        antd: page('./antd/index.html'),
        element: page('./element/index.html'),
        aria: page('./aria/index.html'),
        questionsZh: page('./questions-zh/index.html'),
        questionsEn: page('./questions-en/index.html'),
        languagesWorks: page('./languages-works/index.html'),
        wizard1: page('./wizard/step-1.html'),
        wizard2: page('./wizard/step-2.html'),
        wizard3: page('./wizard/step-3.html'),
        wizardSpa: page('./wizard/spa.html'),
        wizardSpaQuestions: page('./wizard/spa-questions.html'),
        wizardFramed: page('./wizard/framed.html'),
        wizardShadow: page('./wizard/shadow.html'),
        uploadRead: page('./upload-read/index.html'),
      },
    },
  },
});
