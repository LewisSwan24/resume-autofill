// The acceptance run: the real extension on the replayed page, started by clicking the real FAB. Its content
// scripts live in the ISOLATED world and the page keeps its own CSP, unlike the harness run in captured.spec.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../e2e/fixtures';
import { fillFixture } from '../e2e/helpers';
import { listSamples, recordScore, scoreLine, scoreProblems, scoreSample } from '../shared/capturedExpectations';
import { inspect, locatorsOf } from './readState';

// Phones run no extensions. The app injects the engine itself, which is what the harness replay in
// captured.spec.ts does, on the device the sample was captured with.
for (const sample of listSamples().filter((s) => s.device === 'desktop')) {
  test(`extension on ${sample.ats}/${sample.name}: filling gives exactly what expected.json says`, async ({ context, serviceWorker }) => {
    test.setTimeout(180_000);
    // Only web requests: the extension's own files must keep loading. Anything not in the HAR is aborted.
    if (!sample.readInPlace) {
      await context.routeFromHAR(path.join(sample.dir, 'page.har'), { notFound: 'abort', url: /^https?:\/\// });
    } else {
      // A step read in place has no recording: its snapshot, and nothing else.
      const body = readFileSync(path.join(sample.dir, 'page.html'), 'utf8');
      await context.route(/^https?:\/\//, (route) =>
        route.request().url() === sample.url ? route.fulfill({ contentType: 'text/html; charset=utf-8', body }) : route.abort(),
      );
    }
    // `serviceWorkers: 'block'` would stop the extension too, so only the page's registrations are refused.
    await context.addInitScript(() => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register = () => Promise.reject(new Error('blocked in replay'));
      }
    });

    const locators = locatorsOf(sample.expected);
    const firstField = Object.values(sample.expected.fields)[0]!.selector;
    const run = await fillFixture(context, serviceWorker, '', sample.expected.__resume, {
      url: sample.url,
      beforeFill: async (page) => {
        await page.locator(firstField).first().waitFor({ state: 'attached', timeout: 20_000 });
        if (sample.expected.__banner) {
          await page.locator(sample.expected.__banner).first().click();
          await page.locator(sample.expected.__banner).first().waitFor({ state: 'hidden' });
        }
        return inspect(page, locators);
      },
    });
    const after = await inspect(run.page, locators);
    const score = scoreSample(sample, 'extension', run.before!, after, run.report);
    recordScore(score);
    console.log(scoreLine(score));
    expect(scoreProblems(score, sample.expected)).toEqual([]);
  });
}
