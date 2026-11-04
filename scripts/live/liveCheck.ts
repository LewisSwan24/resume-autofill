// One real run on a real page: the extension fills it with the fictional sample resume, started by a click on
// its own button, the only click made. Sites save drafts and upload files on their own while a form is being
// filled, so everything that could write to them is stopped at the browser and listed.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { FillReport } from '../../src/engine/types.ts';
import type { Inspection } from '../../tests/shared/capturedExpectations.ts';
import { fillFixture } from '../../tests/e2e/helpers.ts';
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

const COMMENTS = /#[^\n]*/g;

/** A JSON body holding one GraphQL query and no mutation. Some forms load their questions this way. */
function isGraphqlRead(body: string | null): boolean {
  if (!body) return false;
  let query: unknown;
  try {
    query = (JSON.parse(body) as { query?: unknown }).query;
  } catch {
    return false;
  }
  if (typeof query !== 'string') return false;
  const text = query.replace(COMMENTS, '').trim();
  return /^(?:query\b|\{)/.test(text) && !/\b(?:mutation|subscription)\b/.test(text);
}

/** Call before opening any page. Lets reads through; stops writes, sockets and service workers. */
export async function guardWrites(context: BrowserContext): Promise<WriteGuard> {
  const log = new Map<string, BlockedRequest>();
  let sockets = 0;

  await context.route(/^https?:\/\//, (route) => {
    const request = route.request();
    const method = request.method();
    if (READ_METHODS.has(method) || isGraphqlRead(request.postData())) return route.continue();
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
