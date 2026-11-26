/// <reference types="chrome" />
// Helpers for the extension e2e specs. Everything that needs extension state goes through the service worker
// (`chrome.*` inside `serviceWorker.evaluate`); the page under test is driven with real mouse input only.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { FieldReport, FillReport } from '../../src/engine/types';
import type { Inspection } from '../shared/capturedExpectations';

export const FIXTURE_ORIGIN = 'http://localhost:4173';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RESULTS_DIR = path.join(ROOT, 'test-results');

export const fixtureUrl = (name: string): string => `${FIXTURE_ORIGIN}/${name}/`;

declare global {
  interface Window {
    __fixtureState: () => Record<string, unknown>;
  }
}

/** The service worker seeds the sample profile asynchronously after install: wait until it is stored. */
export async function waitForSeed(worker: Worker): Promise<void> {
  await pollWorker(
    worker,
    async () => {
      const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
      return Array.isArray(profile?.resumes) && profile.resumes.length >= 2 && !!profile.activeResumeId;
    },
    'sample profile seeded',
  );
}

/** Make the (single) resume of the given locale active by writing `profile.activeResumeId` directly. */
export async function setActiveResumeByLocale(worker: Worker, locale: string): Promise<string> {
  return worker.evaluate(async (loc) => {
    const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
    const hit = profile.resumes.find((r: { locale: string }) => r.locale === loc);
    if (!hit) throw new Error(`no resume with locale ${loc}`);
    profile.activeResumeId = hit.id;
    await chrome.storage.local.set({ profile });
    return hit.id as string;
  }, locale);
}

/** Poll an async predicate evaluated inside the worker. */
export async function pollWorker(
  worker: Worker,
  predicate: () => Promise<boolean>,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await worker.evaluate(predicate)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function tabIdOf(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? null, url);
  if (id === null) throw new Error(`no tab for ${url}`);
  return id;
}

/** Sum of the per-frame counts stored by the background under `scan:<tabId>`. */
export function scanTotal(worker: Worker, tabId: number): Promise<number> {
  return worker.evaluate(async (id) => {
    const key = `scan:${id}`;
    const counts = (await chrome.storage.session.get(key))[key] as Record<string, number> | undefined;
    return Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
  }, tabId);
}

export async function storedReport(worker: Worker, tabId: number): Promise<FillReport | null> {
  return worker.evaluate(async (id) => {
    const key = `report:${id}`;
    return ((await chrome.storage.session.get(key))[key] as FillReport | undefined) ?? null;
  }, tabId);
}

export interface FabBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box of the FAB host (== the FAB button, see fab.content/style.css). */
export async function fabBox(page: Page): Promise<FabBox> {
  const host = page.locator('raf-fab');
  await host.waitFor({ state: 'attached' });
  const box = await host.boundingBox();
  if (!box || box.width < 10 || box.height < 10) throw new Error(`FAB host has no size: ${JSON.stringify(box)}`);
  return box;
}

/** Texts of the accessibility tree: it includes the closed shadow root, which locators cannot reach. */
export async function accessibleNames(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: Array<{ name?: { value?: string }; ignored?: boolean }>;
    };
    return nodes.filter((n) => !n.ignored).map((n) => String(n.name?.value ?? '')).filter(Boolean);
  } finally {
    await cdp.detach();
  }
}

export interface FillRun {
  page: Page;
  tabId: number;
  report: FillReport;
  /** Total reported to the FAB before the click. */
  detected: number;
  /** Count shown on the FAB before the click. */
  fabDetected: number;
  /** What `beforeFill` returned. */
  before?: Inspection;
}

/**
 * The whole user journey on one fixture: set the active resume, open the page, wait for the FAB and the
 * detected count, click the FAB centre with the mouse and wait for the stored report.
 */
export async function fillFixture(
  context: BrowserContext,
  worker: Worker,
  name: string,
  locale: string,
  opts: {
    frame?: boolean;
    /** Open this address instead of a synthetic fixture (`name` is then ignored). */
    url?: string;
    /** Runs right after the page loads, before its fields are counted: a page that shows its form on a button. */
    afterLoad?: (page: Page) => Promise<void>;
    /** Runs once the page is open, before the FAB is clicked. */
    beforeFill?: (page: Page) => Promise<Inspection>;
    /** Fill with whichever resume is active now (`locale` is then ignored). */
    keepActive?: boolean;
  } = {},
): Promise<FillRun> {
  await waitForSeed(worker);
  if (!opts.keepActive) await setActiveResumeByLocale(worker, locale);

  const url = opts.url ?? fixtureUrl(name);
  const page = await context.newPage();
  await page.goto(url);
  await opts.afterLoad?.(page);
  if (opts.frame) await page.frameLocator('iframe[title="Additional questions"]').getByLabel('Notice period').waitFor();

  // A page may add to its address while it starts.
  const tabId = await tabIdOf(worker, page.url().split('#')[0]!);
  // Detected count: content → background (`scan:<tabId>`) → FAB (`scan:total`).
  const deadline = Date.now() + 20_000;
  let detected = 0;
  while ((detected = await scanTotal(worker, tabId)) === 0) {
    if (Date.now() > deadline) throw new Error('no fields detected (scan:<tabId> stayed empty)');
    await page.waitForTimeout(150);
  }
  if (opts.frame) {
    // Both frames must have reported before we click, or the iframe is not filled.
    while (Object.keys(await scanFrames(worker, tabId)).length < 2) {
      if (Date.now() > deadline) throw new Error('iframe never reported its scan');
      await page.waitForTimeout(150);
    }
  }

  // The FAB itself must display the count (scan:total reached the closed shadow root).
  let fabDetected = 0;
  // A page still building up is scanned again, and the two numbers settle on a busy machine a moment apart.
  const settleBy = Date.now() + 20_000;
  while (fabDetected === 0 || (fabDetected !== (detected = await scanTotal(worker, tabId)) && Date.now() < settleBy)) {
    const hit = (await accessibleNames(page)).map((n) => /^(\d+) fields? detected$|^识别到 (\d+) 个字段$/.exec(n)).find(Boolean);
    if (hit) fabDetected = Number(hit[1] ?? hit[2]);
    else if (Date.now() > deadline + 10_000) throw new Error('FAB never showed the detected count');
    else await page.waitForTimeout(150);
  }

  const before = await opts.beforeFill?.(page);

  const box = await fabBox(page);
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  // This click goes by position, so make sure it cannot land on a button of the page.
  const onTop = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.tagName.toLowerCase() ?? 'nothing', [x, y]);
  if (onTop !== 'raf-fab') throw new Error(`the page has ${onTop} on top of the FAB`);
  await page.mouse.click(x, y);

  const reportDeadline = Date.now() + 60_000;
  let report: FillReport | null = null;
  while (!(report = await storedReport(worker, tabId))) {
    if (Date.now() > reportDeadline) throw new Error('no report stored after clicking the FAB');
    await page.waitForTimeout(200);
  }
  return { page, tabId, report, detected, fabDetected, ...(before ? { before } : {}) };
}

function scanFrames(worker: Worker, tabId: number): Promise<Record<string, number>> {
  return worker.evaluate(async (id) => {
    const key = `scan:${id}`;
    return ((await chrome.storage.session.get(key))[key] as Record<string, number> | undefined) ?? {};
  }, tabId);
}

/** Screenshot of the FAB corner, including the card that opens above the button. */
export async function screenshotFab(page: Page, file: string): Promise<void> {
  const box = await fabBox(page);
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const right = Math.min(vp.width, box.x + box.width + 24);
  const bottom = Math.min(vp.height, box.y + box.height + 24);
  const x = Math.max(0, right - 460);
  const y = Math.max(0, bottom - 640);
  mkdirSync(RESULTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(RESULTS_DIR, file), clip: { x, y, width: right - x, height: bottom - y } });
}

export interface AccuracyRow {
  fixture: string;
  keys: number;
  correct: number;
  accuracy: number;
  wrong: string[];
}

/** Merge one fixture's result into test-results/accuracy.json (Playwright empties test-results per run). */
export function recordAccuracy(row: AccuracyRow): AccuracyRow[] {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, 'accuracy.json');
  let rows: AccuracyRow[] = [];
  try {
    rows = JSON.parse(readFileSync(file, 'utf8')) as AccuracyRow[];
  } catch {
    /* first fixture of the run */
  }
  rows = [...rows.filter((r) => r.fixture !== row.fixture), row];
  writeFileSync(file, JSON.stringify(rows, null, 2));
  return rows;
}

export const rowsOf = (report: FillReport, re: RegExp): FieldReport[] => report.fields.filter((f) => re.test(f.label));

/** Centre of an element in the FAB's closed shadow root, found by data-testid through the DevTools protocol, scrolled into view. */
export async function fabPoint(page: Page, testId: string): Promise<{ x: number; y: number } | null> {
  interface Node {
    nodeId: number;
    attributes?: string[];
    children?: Node[];
    shadowRoots?: Node[];
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: Node };
    const stack: Node[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      const a = n.attributes ?? [];
      const i = a.indexOf('data-testid');
      if (i >= 0 && a[i + 1] === testId) {
        // Inside the card's scrolling content it may sit below the fold.
        await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: n.nodeId });
        const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: n.nodeId })) as { model: { border: number[] } };
        const [x1, y1, , , x3, y3] = model.border;
        return { x: (x1! + x3!) / 2, y: (y1! + y3!) / 2 };
      }
      stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []));
    }
    return null;
  } finally {
    await cdp.detach();
  }
}
