// DOM watcher: debounced rescans on mutations. Our own highlight writes are discarded
// (`discardOwnWrites`), and nothing is scanned while a fill / apply is running.

export interface ScanWatcherOptions {
  doc: Document;
  /** Runs one scan (and reports it). Must not throw. */
  scan: () => void;
  /** True while a fill / apply is driving the page. */
  isBusy?: () => boolean;
  /** Quiet period after the last mutation. Default 800 ms. */
  debounceMs?: number;
  /** Upper bound for a scan under constant mutation noise (animations). Default 5000 ms. */
  maxWaitMs?: number;
}

export interface ScanWatcher {
  start(): void;
  stop(): void;
  /** Schedule a (debounced) scan, e.g. after a fill finished. */
  schedule(): void;
  /**
   * Drop mutation records produced by our own synchronous writes (highlight outlines). Call
   * right after the write, before yielding to the event loop.
   */
  discardOwnWrites(): void;
}

// Attributes that can change what is visible / enabled; plain `style` covers display toggles.
const WATCHED_ATTRIBUTES = ['style', 'class', 'hidden', 'disabled', 'aria-hidden', 'open'];

export function createScanWatcher(opts: ScanWatcherOptions): ScanWatcher {
  const debounceMs = opts.debounceMs ?? 800;
  const maxWaitMs = opts.maxWaitMs ?? 5000;
  const isBusy = opts.isBusy ?? (() => false);
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstPendingAt = 0;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    firstPendingAt = 0;
  };

  const fire = () => {
    clear();
    if (isBusy()) return; // the end of the fill reschedules via `schedule()`
    opts.scan();
  };

  const schedule = () => {
    const now = Date.now();
    if (!firstPendingAt) firstPendingAt = now;
    if (timer !== undefined) clearTimeout(timer);
    const wait = Math.max(0, Math.min(debounceMs, firstPendingAt + maxWaitMs - now));
    timer = setTimeout(fire, wait);
  };

  return {
    start() {
      if (observer) return;
      const Ctor = opts.doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      observer = new Ctor(() => {
        if (isBusy()) return;
        schedule();
      });
      const root = opts.doc.documentElement ?? opts.doc;
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES,
      });
    },
    stop() {
      observer?.disconnect();
      observer = null;
      clear();
    },
    schedule,
    discardOwnWrites() {
      observer?.takeRecords();
    },
  };
}
