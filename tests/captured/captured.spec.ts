// Accuracy on real pages, offline. Samples live in fixtures/captured/ and are not committed, so a clean clone
// has none: that fails loudly here unless RAF_ALLOW_NO_CAPTURES=1 says it is expected.
//
// Two layers: the static snapshot checks what discovery and classification make of the page, the HAR replay
// runs the fill against the page's real scripts. This file uses the in-page harness. extension.spec.ts repeats
// the fill through the real extension, whose content scripts live in a different JS world.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { FillReport } from '../../src/engine/types';
import {
  listSamples,
  recordScore,
  scoreLine,
  scoreProblems,
  scoreSample,
  type CapturedSample,
  type SampleScore,
  verdictSelectors,
} from '../shared/capturedExpectations';
import { injectHarness } from '../drivers/helpers';
import { contextOptionsFor } from '../../scripts/capture/device';
import { inspect, locatorsOf, unjudgedControls } from './readState';

const samples = listSamples();

test('there are captured samples to test', () => {
  if (process.env.RAF_ALLOW_NO_CAPTURES) return;
  expect(samples.length, 'no sample in fixtures/captured: capture one, or set RAF_ALLOW_NO_CAPTURES=1 on a clean clone').toBeGreaterThan(0);
});

// A step behind a login is read in place, with no recording to replay. It runs on its snapshot instead.
async function openForFill(browser: Browser, sample: CapturedSample): Promise<Page> {
  return sample.readInPlace ? openStatic(browser, sample) : openReplay(browser, sample);
}

async function openStatic(browser: Browser, sample: CapturedSample): Promise<Page> {
  const context = await browser.newContext({ ...contextOptionsFor(sample.device, sample.locale), bypassCSP: true });
  const html = readFileSync(path.join(sample.dir, 'page.html'), 'utf8');
  // Everything but the document is refused, so this cannot reach the site.
  await context.route('**/*', (route) =>
    route.request().url() === sample.url ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(sample.url);
  return page;
}

async function openReplay(browser: Browser, sample: CapturedSample): Promise<Page> {
  const context = await browser.newContext({
    ...contextOptionsFor(sample.device, sample.locale),
    serviceWorkers: 'block',
    bypassCSP: true,
  });
  // Anything not in the HAR is aborted, so the page cannot reach the site either.
  await context.routeFromHAR(path.join(sample.dir, 'page.har'), { notFound: 'abort' });
  const page = await context.newPage();
  await page.goto(sample.url, { waitUntil: 'load' });
  const firstField = Object.values(sample.expected.fields)[0]!.selector;
  await page.locator(firstField).first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(800);
  return page;
}

for (const sample of samples) {
  test.describe(`${sample.ats}/${sample.name}`, () => {
    test('static snapshot: controls classify as written in expected.json', async ({ browser }) => {
      const page = await openStatic(browser, sample);
      try {
        await injectHarness(page);
        const wanted = Object.entries(sample.expected.fields).flatMap(([label, f]) =>
          f.fieldKey && !f.liveOnlyKey ? [{ label, selector: f.control ?? f.selector, fieldKey: f.fieldKey }] : [],
        );
        const rows = await page.evaluate((items) => {
          const { contexts, classifications } = window.__raf.scanDocument(document);
          return items.map((item) => {
            const el = document.querySelector(item.selector);
            const i = contexts.findIndex((c) => c.control.el === el || (el && (c.control.el.contains(el) || el.contains(c.control.el))));
            return { ...item, actual: i >= 0 ? (classifications[i]?.fieldKey ?? null) : 'not discovered' };
          });
        }, wanted);
        expect(wanted.length, 'the sample names no fieldKey to check').toBeGreaterThan(0);
        expect(rows.filter((r) => r.actual !== r.fieldKey)).toEqual([]);
      } finally {
        await page.context().close();
      }
    });

    test('static snapshot: every control on the page has a verdict', async ({ browser }) => {
      const page = await openStatic(browser, sample);
      try {
        await injectHarness(page);
        expect(await unjudgedControls(page, verdictSelectors(sample.expected))).toEqual([]);
      } finally {
        await page.context().close();
      }
    });

    test(`${sample.readInPlace ? 'snapshot' : 'replay'}: filling gives exactly what expected.json says`, async ({ browser }) => {
      test.setTimeout(180_000);
      const page = await openForFill(browser, sample);
      let score: SampleScore;
      try {
        const locators = locatorsOf(sample.expected);
        await injectHarness(page);
        const before = await inspect(page, locators);
        const report: FillReport = await page.evaluate(async (locale) => {
          const raf = window.__raf;
          const resume = raf.samples.resumes.find((r) => r.locale === locale);
          if (!resume) throw new Error(`no sample resume for ${locale}`);
          return (await raf.runFill(document, { resume, files: raf.sampleFiles })).report;
        }, sample.expected.__resume);
        const after = await inspect(page, locators);
        score = scoreSample(sample, 'harness', before, after, report);
        if (process.env.CAPTURED_DEBUG) {
          for (const f of report.fields) {
            console.log(`  · ${f.outcome} ${f.fieldKey ?? '-'} (${f.confidence}) "${f.label}" -> ${f.observed ?? f.value ?? ''}`);
          }
        }
      } finally {
        await page.context().close();
      }
      recordScore(score);
      console.log(scoreLine(score));
      expect(scoreProblems(score, sample.expected)).toEqual([]);
    });
  });
}
