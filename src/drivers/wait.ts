// Polling / observing helpers. No fixed sleeps: callers wait for a condition, not for time.

export interface WaitOptions {
  /** Give up after this many ms and resolve null. Default 2500. */
  timeout?: number;
  /** Subtree whose mutations re-run the probe. Default: the global document. */
  root?: Node;
  /** Interval fallback for state changes MutationObserver cannot see (layout, focus, ...). Default 50. */
  interval?: number;
  /** Abort early: resolves null as soon as the signal fires (or at once when it already has). */
  signal?: AbortSignal | undefined;
}
type Win = Window & typeof globalThis;

function windowOf(node: Node): Win {
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  return (doc?.defaultView ?? window) as Win;
}

const isMiss = (v: unknown): boolean => v === null || v === undefined || v === false;

/**
 * Resolve with the first truthy-ish probe result (anything but null / undefined / false),
 * or null on timeout. The probe runs immediately, on every DOM mutation under `root`
 * (subtree, attributes, childList, characterData) and on a 50 ms interval.
 * A throwing probe counts as "not ready yet".
 */
export function waitFor<T>(probe: () => T | null | false | undefined, opts: WaitOptions = {}): Promise<T | null> {
  const timeout = opts.timeout ?? 2500;
  const interval = opts.interval ?? 50;
  const root: Node = opts.root ?? document;

  return new Promise<T | null>((resolve) => {
    let finished = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const signal = opts.signal;
    const onAbort = (): void => finish(null);

    const finish = (value: T | null): void => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      observer?.disconnect();
      if (timer !== undefined) clearInterval(timer);
      if (deadline !== undefined) clearTimeout(deadline);
      resolve(value);
    };

    const check = (): void => {
      if (finished) return;
      let value: T | null | false | undefined;
      try {
        value = probe();
      } catch {
        value = null;
      }
      if (!isMiss(value)) finish(value as T);
    };

    if (signal?.aborted) {
      resolve(null);
      return;
    }
    check();
    if (finished) return;
    signal?.addEventListener('abort', onAbort, { once: true });

    const win = windowOf(root);
    if (typeof win.MutationObserver === 'function') {
      observer = new win.MutationObserver(check);
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    timer = setInterval(check, interval);
    deadline = setTimeout(() => {
      check();
      finish(null);
    }, timeout);
  });
}

/** Resolve after the next animation frame (or 50 ms, for background tabs where rAF is paused). */
export function nextFrame(win: Window = window): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => finish());
    setTimeout(finish, 50);
  });
}

/** After a search's answer has come back, time for the page to draw its options. */
export const ANSWER_SETTLE_MS = 400;

/** Requests that only count what a page does: they say nothing about a search. */
const TELEMETRY = /collect|track|log|report|monitor|beacon|metric|analytic|stat/i;
const DATA_REQUESTS: ReadonlySet<string> = new Set(['xmlhttprequest', 'fetch']);

export interface AnswerWatch {
  /** The page's own request has come back, at least `settleMs` ago (time for the page to draw what it got). */
  answered(settleMs: number): boolean;
  stop(): void;
}

/**
 * Watch for the page's answer to what was just typed into a search box: a data request of the page's own origin that
 * finishes from now on. Watched with an observer, which a full resource buffer does not stop. Where requests cannot
 * be watched, it never says answered, and the caller waits as long as it would have.
 */
export function watchAnswers(doc: Document): AnswerWatch {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const Observer = win?.PerformanceObserver;
  if (!win || typeof Observer !== 'function') return { answered: () => false, stop: () => undefined };
  const origin = win.location.origin;
  let answeredAt: number | null = null;
  const own = (name: string): boolean => {
    try {
      const url = new URL(name);
      return url.origin === origin && !TELEMETRY.test(url.pathname);
    } catch {
      return false;
    }
  };
  let observer: PerformanceObserver | null = null;
  try {
    observer = new Observer((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (answeredAt === null && DATA_REQUESTS.has(e.initiatorType) && own(e.name)) answeredAt = e.responseEnd;
      }
    });
    observer.observe({ type: 'resource' });
  } catch {
    observer = null;
  }
  return {
    answered: (settleMs) => answeredAt !== null && win.performance.now() - answeredAt >= settleMs,
    stop: () => observer?.disconnect(),
  };
}

/**
 * Once what `el` and its insides animate (a drawer sliding in) has run its course: at once where nothing does, and
 * never longer than `timeout`. An animation that loops for ever (a spinner) is not waited for.
 */
export async function animationsDone(el: Element, timeout: number, signal?: AbortSignal): Promise<void> {
  if (typeof el.getAnimations !== 'function') return;
  const running = el
    .getAnimations({ subtree: true })
    .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity);
  if (running.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(running.map((a) => a.finished.catch(() => undefined))),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeout);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    }),
  ]);
  clearTimeout(timer);
}
