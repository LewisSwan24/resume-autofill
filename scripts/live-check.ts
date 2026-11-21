// Run the real extension once on a real application page, with the fictional sample resume and all writes
// blocked. Use it rarely: this is a visit to someone's site.
//
//   pnpm live-check --url <url> [--locale en-AU] [--sample greenhouse/name] [--shot <file.png>] [--advance]
//
// With --advance, it then presses "Advance to the last page" and reports where auto-advance stopped and what
// it pressed. Writes stay blocked, so a step that has to save to the site before it moves on stops the run.
//
// With --sample, the page is also scored against that sample's expected.json.
//
// --profile-dir runs in a browser profile of your own (outside the repository), for a page behind a login, such
// as a capture profile in ~/.raf-capture/profiles/<ats>. Writes stay blocked there too.
// --save-searches <file.json> keeps what the page's own search boxes asked and were answered (no headers), so
// tests/shared/searchAnswers.ts can give a replay the same answers. The file must be outside the repository.
// --read-posts <regex> lets through POSTs whose path the regex matches whole, for a site that reads by POST
// (Moka loads its job, form and option lists that way). Name read endpoints only: every other write stays blocked.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { locatorsOf } from '../tests/captured/readState.ts';
import { listSamples, scoreLine, scoreProblems, scoreSample } from '../tests/shared/capturedExpectations.ts';
import { liveContextOptions } from './capture/device.ts';
import { writeFileSync } from 'node:fs';
import { advanceLive, guardWrites, runLiveCheck } from './live/liveCheck.ts';
import { recordSearches } from './live/searches.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, '.output', 'chrome-mv3');

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    locale: { type: 'string', default: 'en-AU' },
    sample: { type: 'string' },
    shot: { type: 'string' },
    advance: { type: 'boolean', default: false },
    'profile-dir': { type: 'string' },
    'save-searches': { type: 'string' },
    'read-posts': { type: 'string' },
  },
});

/** A login profile or saved answers inside the repository could end up in a commit. */
const outsideRepo = (p: string): boolean => {
  const rel = path.relative(ROOT, path.resolve(p));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
};
for (const opt of ['profile-dir', 'save-searches'] as const) {
  if (args[opt] && !outsideRepo(args[opt])) {
    console.error(`live-check: --${opt} must be outside the repository`);
    process.exit(2);
  }
}

if (!args.url || !/^https?:\/\//.test(args.url)) {
  console.error('live-check: --url must be http(s)');
  process.exit(2);
}

const sample = args.sample ? listSamples().find((s) => `${s.ats}/${s.name}` === args.sample) : undefined;
if (args.sample && !sample) {
  console.error(`live-check: no sample ${args.sample} with an expected.json`);
  process.exit(2);
}

// An empty user data dir by default: a throwaway profile that has none of the user's logins. It speaks the
// language the sample was captured in, or the resume's.
const context = await chromium.launchPersistentContext(
  args['profile-dir'] ? path.resolve(args['profile-dir']) : '',
  liveContextOptions(sample?.locale ?? args.locale!, EXT),
);
const searches = args['save-searches'] ? recordSearches(context) : null;

let failed = false;
try {
  const guard = await guardWrites(context, args['read-posts'] ? new RegExp(args['read-posts']) : null);
  // A login profile may already hold the site's own service worker: take the extension's.
  const ours = (w: { url(): string }) => w.url().startsWith('chrome-extension://');
  const worker = context.serviceWorkers().find(ours) ?? (await context.waitForEvent('serviceworker', { predicate: ours }));
  const result = await runLiveCheck(context, worker, guard, {
    url: args.url,
    locale: args.locale!,
    ...(sample ? { locators: locatorsOf(sample.expected) } : {}),
  });

  console.log(`button shown: yes, ${result.fabDetected} fields detected`);
  console.log(`outcomes: ${JSON.stringify(result.report.counts)}`);
  console.log(`writes blocked: ${result.blocked.reduce((n, b) => n + b.count, 0)}, sockets closed: ${result.socketsClosed}`);
  for (const b of result.blocked) console.log(`  ${b.count} x ${b.method} ${b.host}${b.path}`);
  if (process.env.LIVE_DEBUG) {
    for (const f of result.report.fields) {
      console.log(`  · ${f.outcome} ${f.fieldKey ?? '-'} (${f.confidence}) "${f.label}" -> ${f.observed ?? f.value ?? ''} ${(f.candidates ?? []).map((c) => c.label).join(' | ')}`);
    }
  }
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
  if (args.advance) {
    const run = await advanceLive(result.page, worker);
    console.log(`advance offered: ${run.offered ? 'yes' : 'no'}`);
    if (run.offered) {
      console.log(`advance stopped: ${run.state ? `${run.state.stopReason} after ${run.state.steps} step(s)` : 'did not stop in time'}`);
      console.log(`pressed: ${run.pressed.length ? run.pressed.map((p) => `"${p}"`).join(', ') : 'nothing'}`);
      failed ||= run.state === null;
    }
    if (run.leftOrigin.length > 0) {
      failed = true;
      console.log(`left the site: ${run.leftOrigin.join(', ')}`);
    }
    const blocked = guard.blocked();
    console.log(`writes blocked in all: ${blocked.reduce((n, b) => n + b.count, 0)}`);
    for (const b of blocked) console.log(`  ${b.count} x ${b.method} ${b.host}${b.path}`);
  }
  if (args.shot) await result.page.screenshot({ path: args.shot });
  if (searches && args['save-searches']) {
    writeFileSync(path.resolve(args['save-searches']), `${JSON.stringify(searches(), null, 2)}\n`);
    console.log(`search answers saved: ${searches().length}`);
  }
} catch (error) {
  failed = true;
  console.error(`live-check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await context.close();
}
process.exit(failed ? 1 : 0);
