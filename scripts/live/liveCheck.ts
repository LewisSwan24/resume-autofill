// One real run on a real page: the extension fills it with the fictional sample resume, started by a click on
// its own button, the only click made. Sites save drafts and upload files on their own while a form is being
// filled, so everything that could write to them is stopped at the browser and listed.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { FillReport } from '../../src/engine/types.ts';
import type { Inspection } from '../../tests/shared/capturedExpectations.ts';
import { fabPoint, fillFixture, tabIdOf } from '../../tests/e2e/helpers.ts';
import type { AdvanceState } from '../../src/background/wizardSession.ts';
import { inspect, type Locators } from '../../tests/captured/readState.ts';

export interface BlockedRequest {
  method: string;
  host: string;
  /** Without the query string, which can hold what was typed. */
  path: string;
  count: number;
}

export interface WriteGuard {
  blocked(): BlockedRequest[];
  socketsClosed(): number;
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * A POST to a GraphQL endpoint holding a query. Some forms load their questions this way. Any word
 * "mutation" or "subscription" stops it, even one in a string or a comment: better one read too few.
 */
function isGraphqlRead(method: string, url: string, body: string | null): boolean {
  if (method !== 'POST' || !body || !/graphql/i.test(new URL(url).pathname)) return false;
  let query: unknown;
  try {
    query = (JSON.parse(body) as { query?: unknown }).query;
  } catch {
    return false;
  }
  if (typeof query !== 'string') return false;
  return /^\s*(?:query\b|\{)/.test(query) && !/mutation|subscription/i.test(query);
}

/** Call before opening any page. Lets reads through; stops writes, sockets and service workers. */
export async function guardWrites(context: BrowserContext): Promise<WriteGuard> {
  const log = new Map<string, BlockedRequest>();
  let sockets = 0;

  await context.route(/^https?:\/\//, (route) => {
    const request = route.request();
    const method = request.method();
    if (READ_METHODS.has(method) || isGraphqlRead(method, request.url(), request.postData())) return route.continue();
    const { host, pathname } = new URL(request.url());
    const key = `${method} ${host}${pathname}`;
    const entry = log.get(key) ?? { method, host, path: pathname, count: 0 };
    entry.count++;
    log.set(key, entry);
    return route.abort();
  });
  await context.routeWebSocket(/.*/, (socket) => {
    sockets++;
    return socket.close();
  });
  // A page's service worker makes requests this guard cannot see. The extension's own worker is not affected.
  await context.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('blocked during the live check'));
    }
  });

  return { blocked: () => [...log.values()], socketsClosed: () => sockets };
}

export interface LiveOptions {
  url: string;
  locale: string;
  /** Extra time after the network goes quiet, for pages that hydrate late. */
  settleMs?: number;
  /** Controls to read before and after, when the page is scored against a sample. */
  locators?: Locators;
}

export interface LiveResult {
  page: Page;
  report: FillReport;
  detected: number;
  fabDetected: number;
  blocked: BlockedRequest[];
  socketsClosed: number;
  /** Addresses the page moved to after it loaded. Should be empty: nothing here may leave the page. */
  navigatedTo: string[];
  before: Inspection;
  after: Inspection;
}

export async function runLiveCheck(context: BrowserContext, worker: Worker, guard: WriteGuard, opts: LiveOptions): Promise<LiveResult> {
  const navigatedTo: string[] = [];
  const locators = opts.locators ?? {};
  const run = await fillFixture(context, worker, '', opts.locale, {
    url: opts.url,
    beforeFill: async (page) => {
      // The button has to be there after hydration, which is what removed it on a real page.
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(opts.settleMs ?? 2000);
      const start = page.url();
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url() !== start) navigatedTo.push(frame.url());
      });
      return inspect(page, locators);
    },
  });
  return {
    page: run.page,
    report: run.report,
    detected: run.detected,
    fabDetected: run.fabDetected,
    blocked: guard.blocked(),
    socketsClosed: guard.socketsClosed(),
    navigatedTo,
    before: run.before!,
    after: await inspect(run.page, locators),
  };
}

export interface AdvanceLiveResult {
  /** The FAB card offered "Advance to the last page" after the fill. */
  offered: boolean;
  /** How the run ended; null when it was not offered or did not end in time. */
  state: AdvanceState | null;
  /** Labels of the page's buttons and links that were clicked while it ran. */
  pressed: string[];
  /** Addresses on another site the tab went to. Should be empty. */
  leftOrigin: string[];
}

/**
 * After `runLiveCheck`: press "Advance to the last page" in the FAB card, the second and last click made, and
 * wait for the run to stop. The write guard stays on, so a step that has to save before it moves on stops it.
 */
export async function advanceLive(page: Page, worker: Worker, opts: { timeoutMs?: number } = {}): Promise<AdvanceLiveResult> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const origin = new URL(page.url()).origin;
  const tabId = await tabIdOf(worker, page.url().split('#')[0]!);
  const pressed: string[] = [];
  const leftOrigin: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && new URL(frame.url()).origin !== origin) leftOrigin.push(frame.url());
  });

  // Every click on a page button or link, on this document and on any the run loads.
  await page.exposeBinding('__rafLivePressed', (_source, label: string) => {
    pressed.push(label);
  });
  const listen = () => {
    document.addEventListener(
      'click',
      (e) => {
        const el = (e.target as Element | null)?.closest?.('button, a, input[type=submit], input[type=button], [role=button]') as HTMLElement | null;
        if (!el) return;
        const label = (el.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
        void (window as unknown as { __rafLivePressed: (l: string) => Promise<void> }).__rafLivePressed(label);
      },
      true,
    );
  };
  await page.addInitScript(listen);
  await page.evaluate(listen);

  const offerBy = Date.now() + Math.min(8_000, timeoutMs);
  let start: { x: number; y: number } | null = null;
  while (!(start = await fabPoint(page, 'raf-advance-start')) && Date.now() < offerBy) await page.waitForTimeout(250);
  if (!start) return { offered: false, state: null, pressed, leftOrigin };
  await page.mouse.click(start.x, start.y);

  const deadline = Date.now() + timeoutMs;
  let state: AdvanceState | null = null;
  while (Date.now() < deadline) {
    const run = await worker.evaluate(async (id) => {
      const key = `wizard:${id}`;
      const session = (await chrome.storage.session.get(key))[key] as { advance?: AdvanceState } | undefined;
      return session?.advance ?? null;
    }, tabId);
    if (run && !run.running) {
      state = run;
      break;
    }
    await page.waitForTimeout(500);
  }
  return { offered: true, state, pressed, leftOrigin };
}
