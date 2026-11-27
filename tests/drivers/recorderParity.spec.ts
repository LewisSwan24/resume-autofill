// The extension's recorder sanitises a page with the browser's own parser; the command-line capture uses jsdom. Both
// must write the same sample from the same page, or a recording made in the applicant's Chrome would replay unlike
// one made from the command line.
import { expect, test } from '@playwright/test';
import { jsdomHtml } from '../../scripts/capture/dom.ts';
import { Scrubber, auditHtml, sanitizeStaticHtml } from '../../src/capture/sanitize.ts';
import { injectHarness } from './helpers';

const TERMS = ['Zhiyuan', 'Lin'];

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta name="csrf-token" content="abcdefghijklmnop">
    <style>.hidden { display: none }</style>
    <script>window.boot = 1</script>
  </head>
  <body>
    <!-- build 42 -->
    <form>
      <label for="first">First name</label>
      <input id="first" name="first" value="Zhiyuan">
      <label><input type="checkbox" name="agree" checked> I agree</label>
      <select name="country"><option value="au" selected>Australia</option><option value="nz">New Zealand</option></select>
      <textarea name="note">Write to zhiyuan.lin@example.com</textarea>
      <p class="hidden" data-owner="Lin">Call +61 412 345 678</p>
      <button onclick="go()">Next</button>
      <x-card id="card"></x-card>
      <template><p>template text by Lin</p></template>
    </form>
    <script>
      const root = document.getElementById('card').attachShadow({ mode: 'open', serializable: true });
      root.innerHTML = '<label>Email <input type="email" value="zhiyuan.lin@example.com"></label>';
    </script>
  </body>
</html>`;

test('the recorder and the command line write the same static page', async ({ page }) => {
  await page.setContent(PAGE);
  await injectHarness(page);
  const data = await page.evaluate(() => window.__raf.serializeInPage());
  expect(data.html).toContain('shadowrootmode="open"');

  const inBrowser = await page.evaluate(({ html, css, terms }) => window.__raf.sanitizeInBrowser(html, css, terms), {
    html: data.html,
    css: data.css,
    terms: TERMS,
  });
  const inNode = sanitizeStaticHtml(data.html, new Scrubber({ terms: TERMS }), { css: data.css, dom: jsdomHtml });

  expect(inBrowser).toBe(inNode);
  expect(inNode).not.toMatch(/Zhiyuan|Lin\b|zhiyuan\.lin|412 345|<script|onclick|csrf-token|build 42/);
  expect(inNode).toContain('.hidden { display: none }');
  expect(auditHtml(inNode, { terms: TERMS, dom: jsdomHtml })).toEqual([]);
});
