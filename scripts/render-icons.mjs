// Renders the extension icons (public/icon/{16,32,48,128}.png) from the design-system drafts with Playwright Chromium.
//
//   node scripts/render-icons.mjs
//
// The SVGs below are copies of docs/design-system/icon-draft/*.svg (docs/ is local only, so the source of truth for the
// build lives here). DESIGN-SYSTEM §6.4: accent tile #0066cc with ~22% corner radius, pure white Bootstrap Icons glyph
// (MIT), no gradient, no shadow, no text. 128 / 48 use the thin-stroke `file-earmark-check`; 32 / 16 use the bolder
// `check-lg` (the thin strokes blur at small sizes). Each SVG is loaded at the exact pixel size on a transparent page.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ACCENT = '#0066cc';

// 128 canvas: rx 28 = 21.9%; glyph 16-grid scaled 5x (80px) centred by translate(24 24).
const LARGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Resume Autofill">
  <rect width="128" height="128" rx="28" fill="${ACCENT}"/>
  <g transform="translate(24 24) scale(5)" fill="#ffffff">
    <path d="M10.854 7.854a.5.5 0 0 0-.708-.708L7.5 9.793 6.354 8.646a.5.5 0 1 0-.708.708l1.5 1.5a.5.5 0 0 0 .708 0z"/>
    <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z"/>
  </g>
</svg>`;

// 32 canvas: rx 7 = 21.9%; bolder `check-lg`, scale 1.5 (24px) centred by translate(4 4).
const SMALL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Resume Autofill">
  <rect width="32" height="32" rx="7" fill="${ACCENT}"/>
  <g transform="translate(4 4) scale(1.5)" fill="#ffffff">
    <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z"/>
  </g>
</svg>`;

const TARGETS = [
  { size: 128, svg: LARGE },
  { size: 48, svg: LARGE },
  { size: 32, svg: SMALL },
  { size: 16, svg: SMALL },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icon');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const { size, svg } of TARGETS) {
    const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
    );
    const file = path.join(outDir, `${size}.png`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await context.close();
    console.log(`wrote ${path.relative(root, file)} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
