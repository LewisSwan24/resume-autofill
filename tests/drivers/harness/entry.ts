// Entry of the in-page harness bundle (IIFE → dist/harness.js). Injected into fixture pages and
// frames by tests/drivers/helpers.ts; exposes everything under `window.__raf`.
// Keep this graph free of chrome.* / wxt/browser: the bundle runs on a plain web page.
import { normalizeLabel } from '../../../src/dictionary/normalize';
import { discover } from '../../../src/engine/discover';
import { buildFieldContext } from '../../../src/engine/grouping';
import { executeStep } from '../../../src/drivers/execute';
import { getDriver } from '../../../src/drivers/registry';
import { registerAllDrivers } from '../../../src/drivers';
import { scanDocument } from '../../../src/engine/scan';
import { runFill } from '../../../src/fill/runFill';
import { readStep, pressNext } from './steps';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';
import { buildIntent, execIntent, listLabels, locate } from './inpage';
import { Scrubber, sanitizeStaticHtml } from '../../../src/capture/sanitize';
import { serializeInPage } from '../../../src/capture/serialize';

/** The static page as the extension's recorder writes it: the browser's own parser, one scrubber. */
const sanitizeInBrowser = (html: string, css: string, terms: string[]): string => sanitizeStaticHtml(html, new Scrubber({ terms }), { css });

// ---------------------------------------------------------------------------------------------
// EXTENSION POINT (Task 17 / scan): to expose more of the product code, add an import here and
// a property to `extra` — nothing else in the harness or helpers needs to change.
//   import { scan } from '../../../src/engine/scan';       // TODO: enable once src/engine/scan.ts exists
//   import { runFill } from '../../../src/fill/runFill';   // TODO: enable once src/fill/runFill.ts exists
registerAllDrivers();
const extra = {
  scanDocument,
  runFill,
  readStep,
  pressNext,
  serializeInPage,
  sanitizeInBrowser,
};
// ---------------------------------------------------------------------------------------------

const raf = {
  discover,
  buildFieldContext,
  getDriver,
  executeStep,
  normalizeLabel,
  samples: createSampleProfile(),
  sampleFiles: createSampleFiles(),
  // test conveniences (see inpage.ts)
  locate,
  listLabels,
  buildIntent,
  execIntent,
  ...extra,
};

export type RafHarness = typeof raf;

declare global {
  interface Window {
    __raf: RafHarness;
  }
}

window.__raf = raf;

