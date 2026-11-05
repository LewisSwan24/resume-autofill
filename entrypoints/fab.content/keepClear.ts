// A form can pin its own submit button to the bottom of the window, right where the FAB sits, and the FAB grows once
// it has a result. A click meant for one must never be able to land on the other, so the FAB rises above such a
// button. Buttons that scroll with the page do not count: they move out of the way, and chasing them would make the
// FAB jump about as the page scrolls.
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 8;
const RECHECK_MS = 1000;
const BOTTOM = '--resume-autofill-fab-bottom';
const BUTTONS =
  'button, input[type="submit"], input[type="button"], [role="button"], a[class*="btn" i], a[class*="button" i]';

const near = (a: Box, b: Box): boolean =>
  a.left - GAP < b.right && b.left < a.right + GAP && a.top - GAP < b.bottom && b.top < a.bottom + GAP;

/** How far up `fab` must move to leave every one of `obstacles`; 0 when that would take it out of the window. */
export function liftFor(fab: Box, obstacles: Box[]): number {
  let lift = 0;
  // Each round clears at least one obstacle for good, because the FAB only ever moves up.
  for (let round = 0; round <= obstacles.length; round++) {
    const at = { ...fab, top: fab.top - lift, bottom: fab.bottom - lift };
    const hits = obstacles.filter((o) => near(at, o));
    if (hits.length === 0) return at.top < 0 ? 0 : lift;
    lift = fab.bottom - (Math.min(...hits.map((o) => o.top)) - GAP);
  }
  return 0;
}

/** Fixed or sticky, itself or through something around it, and not scrolling inside that. */
export function isPinned(el: Element, win: Window): boolean {
  for (let n: Element | null = el; n && n !== win.document.documentElement; n = n.parentElement) {
    const { position, overflowY } = win.getComputedStyle(n);
    if (n !== el && (overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return false;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

function isShown(el: Element, win: Window): boolean {
  const style = win.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** Returns a function that stops watching. */
export function keepClear(host: HTMLElement, win: Window = window): () => void {
  let lift = 0;
  let queued = false;

  const check = () => {
    queued = false;
    if (!host.isConnected) return;
    const now = host.getBoundingClientRect();
    if (now.width === 0 || now.height === 0) return;
    const fab: Box = { left: now.left, right: now.right, top: now.top + lift, bottom: now.bottom + lift };
    const obstacles: Box[] = [];
    for (const el of win.document.querySelectorAll(BUTTONS)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.left >= fab.right + GAP || r.right <= fab.left - GAP) continue;
      if (r.bottom <= 0 || r.top >= win.innerHeight) continue;
      if (isShown(el, win) && isPinned(el, win)) obstacles.push(r);
    }
    const next = liftFor(fab, obstacles);
    if (next === lift) return;
    lift = next;
    if (lift === 0) host.style.removeProperty(BOTTOM);
    else host.style.setProperty(BOTTOM, `calc(var(--raf-size-fab-offset-y) + ${lift}px)`);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(check);
  };

  // The FAB grows when a result arrives; a bar can show up at any moment, and nothing announces that.
  const grows = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue);
  grows?.observe(host);
  win.addEventListener('resize', queue, { passive: true });
  win.addEventListener('scroll', queue, { passive: true, capture: true });
  const timer = win.setInterval(queue, RECHECK_MS);
  queue();

  return () => {
    grows?.disconnect();
    win.removeEventListener('resize', queue);
    win.removeEventListener('scroll', queue, { capture: true });
    win.clearInterval(timer);
  };
}
