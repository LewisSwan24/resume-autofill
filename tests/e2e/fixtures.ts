import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// RAF_EXT_DIR lets parallel workers test a private copy of the build output.
export const EXT = process.env.RAF_EXT_DIR
  ? path.resolve(process.env.RAF_EXT_DIR)
  : path.join(ROOT, '.output', 'chrome-mv3');

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  // Extensions need a persistent context and the full (new-headless) Chromium,
  // not the headless shell: hence channel 'chromium'.
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // `headless` is Playwright's built-in option (false with --headed); HEADED=1 also forces a window.
      headless: headless && !process.env.HEADED,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    // Worker URL: chrome-extension://<id>/background.js
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export const expect = test.expect;
