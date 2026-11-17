import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'wxt';

// The PDF reader's worker and its font tables, in the package: nothing is fetched at run time.
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:publicAssets': (_wxt, assets) => {
      assets.push({ absoluteSrc: path.join(pdfjsRoot, 'build', 'pdf.worker.min.mjs'), relativeDest: 'pdfjs/pdf.worker.min.mjs' });
      for (const name of readdirSync(path.join(pdfjsRoot, 'cmaps'))) {
        if (name.endsWith('.bcmap')) assets.push({ absoluteSrc: path.join(pdfjsRoot, 'cmaps', name), relativeDest: `pdfjs/cmaps/${name}` });
      }
    },
  },
  manifest: {
    // The extension's own pages only connect to self or an optional user-enabled local loopback Ollama instance
    // (127.0.0.1 / localhost). No external domains are permitted, and content/background scripts perform zero fetches.
    content_security_policy: {
      extension_pages:
        "default-src 'self'; script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'none'; frame-src 'none'",
    },
    name: '网申简历一键填写助手 / Resume Autofill',
    description: 'One-click autofill of job application forms from a locally stored resume.',
    // No `tabs` permission: tabs.query/sendMessage/onUpdated work without it, and tab URLs are
    // already visible through host_permissions. Icons come from public/icon/{16,32,48,128}.png.
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'webNavigation'],
    host_permissions: ['<all_urls>'],
    side_panel: { default_path: 'sidepanel.html' },
    action: { default_title: '网申简历一键填写助手 / Resume Autofill' },
  },
});