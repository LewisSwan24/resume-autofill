// Run the real extension once on a real application page, with the fictional sample resume and all writes
// blocked. Use it rarely: this is a visit to someone's site.
//
//   pnpm live-check --url <url> [--locale en-AU] [--sample greenhouse/name] [--shot <file.png>]
//
// With --sample, the page is also scored against that sample's expected.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { locatorsOf } from '../tests/captured/readState.ts';
import { listSamples, scoreLine, scoreProblems, scoreSample } from '../tests/shared/capturedExpectations.ts';
import { guardWrites, runLiveCheck } from './live/liveCheck.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, '.output', 'chrome-mv3');

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    locale: { type: 'string', default: 'en-AU' },
    sample: { type: 'string' },
    shot: { type: 'string' },
  },
});

if (!args.url || !/^https?:\/\//.test(args.url)) {
  console.error('live-check: --url must be http(s)');
  process.exit(2);
}

const sample = args.sample ? listSamples().find((s) => `${s.ats}/${s.name}` === args.sample) : undefined;
if (args.sample && !sample) {
  console.error(`live-check: no sample ${args.sample} with an expected.json`);
  process.exit(2);
}

// An empty user data dir: a throwaway profile that has none of the user's logins.
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let failed = false;
try {
  const guard = await guardWrites(context);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const result = await runLiveCheck(context, worker, guard, {
    url: args.url,
    locale: args.locale!,
    ...(sample ? { locators: locatorsOf(sample.expected) } : {}),
  });

  console.log(`button shown: yes, ${result.fabDetected} fields detected`);
  console.log(`outcomes: ${JSON.stringify(result.report.counts)}`);
  console.log(`writes blocked: ${result.blocked.reduce((n, b) => n + b.count, 0)}, sockets closed: ${result.socketsClosed}`);
  for (const b of result.blocked) console.log(`  ${b.count} x ${b.method} ${b.host}${b.path}`);
  if (result.navigatedTo.length > 0) {
    failed = true;
    console.log(`left the page: ${result.navigatedTo.join(', ')}`);
  }
  if (sample) {
    const score = scoreSample(sample, 'live', result.before, result.after, result.report);
    console.log(scoreLine(score));
    const problems = scoreProblems(score, sample.expected);
    for (const p of problems) console.log(`  ${p}`);
    failed ||= problems.length > 0;
  }
  if (args.shot) await result.page.screenshot({ path: args.shot });
} catch (error) {
  failed = true;
  console.error(`live-check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await context.close();
}
process.exit(failed ? 1 : 0);
