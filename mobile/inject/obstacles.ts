// Buttons a page pins to the bottom of the screen (a sticky 「提交」 bar), so the app can keep the native FAB clear
// of them. Top frame only. `isPinned` and the button selector are copied from the extension's
// entrypoints/fab.content/keepClear.ts (a content-script module); follow-up: share them from a pure module in src/.
import { classifyStepButton } from '../../src/fill/nextStep';
import { MAX_OBSTACLES } from '../bridge/protocol';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface ObstacleReport {
  boxes: Box[];
  viewport: { width: number; height: number; offsetLeft: number; offsetTop: number; scale: number };
}

/** keepClear.ts BUTTONS, plus anything that submits. */
const BUTTONS =
  'button, input[type="submit"], input[type="button"], [role="button"], a[class*="btn" i], a[class*="button" i], [type="submit"]';
const THROTTLE_MS = 300;
const RECHECK_MS = 1000;
/** Only the bottom 40% of the visual viewport matters: that is where the FAB lives. */
const BOTTOM_SHARE = 0.4;

/** Fixed or sticky, itself or through something around it, and not scrolling inside that (keepClear.ts). */
export function isPinned(el: Element, win: Window): boolean {
  for (let n: Element | null = el; n && n !== win.document.documentElement; n = n.parentElement) {
    const { position, overflowY } = win.getComputedStyle(n);
    if (n !== el && (overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return false;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

/** Back buttons sit beside Next; classifyStepButton knows only Next and the buttons that send. */
const BACK = /^(?:上一步|返回上一步|back|previous|prev)$/i;

/** A form's own step button (上一步 / 下一步 / 提交): kept clear even where it scrolls with the page. */
export function isStepButton(el: Element): boolean {
  const text = (el instanceof HTMLInputElement ? el.value : el.textContent) ?? '';
  if (classifyStepButton(text) !== 'other') return true;
  return BACK.test(text.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
}

function isShown(el: Element, win: Window): boolean {
  const style = win.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function viewportOf(win: Window): ObstacleReport['viewport'] {
  const vv = win.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    return { width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale || 1 };
  }
  return { width: win.innerWidth || 1, height: win.innerHeight || 1, offsetLeft: 0, offsetTop: 0, scale: 1 };
}

/**
 * Buttons in the bottom 40% of the visual viewport, in its CSS px; the lowest 16. Pinned ones always count; ones that
 * scroll with the page only when they are the form's step buttons, so the FAB does not jump around a long form.
 */
export function findObstacles(win: Window, pinnedSeen?: { count: number }): ObstacleReport | null {
  const viewport = viewportOf(win);
  const boxes: Box[] = [];
  let pinned = 0;
  for (const el of win.document.querySelectorAll(BUTTONS)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (!isShown(el, win)) continue;
    if (isPinned(el, win)) pinned++;
    else if (!isStepButton(el)) continue;
    const box = { left: r.left - viewport.offsetLeft, top: r.top - viewport.offsetTop, right: r.right - viewport.offsetLeft, bottom: r.bottom - viewport.offsetTop };
    if (box.bottom <= viewport.height * (1 - BOTTOM_SHARE) || box.top >= viewport.height) continue;
    if (box.right <= 0 || box.left >= viewport.width) continue;
    boxes.push(box);
  }
  if (pinnedSeen) pinnedSeen.count = pinned;
  boxes.sort((a, b) => b.bottom - a.bottom);
  return { boxes: boxes.slice(0, MAX_OBSTACLES).sort((a, b) => a.top - b.top || a.left - b.left), viewport };
}

export interface ObstacleWatcher {
  /** Recompute soon (e.g. after the scan watcher went idle). */
  schedule(): void;
  stop(): void;
}

/** Posts the obstacles now and whenever their rounded boxes change. */
export function startObstacleWatcher(win: Window, post: (report: ObstacleReport) => void): ObstacleWatcher {
  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const check = () => {
    timer = undefined;
    if (stopped) return;
    let report: ObstacleReport | null = null;
    const seen = { count: 0 };
    try {
      report = findObstacles(win, seen);
    } catch {
      report = null;
    }
    if (seen.count > 0 && interval === undefined) interval = setInterval(check, RECHECK_MS);
    if (seen.count === 0 && interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
    if (!report) return;
    const key = JSON.stringify(report.boxes.map((b) => [b.left, b.top, b.right, b.bottom].map(Math.round)));
    if (key === last) return;
    last = key;
    post(report);
  };
  const schedule = () => {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(check, THROTTLE_MS);
  };

  const vv = win.visualViewport;
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  // Step buttons scroll with the page; capture also hears scrolling inside the page's own containers.
  win.addEventListener('scroll', schedule, { capture: true, passive: true });
  check();

  return {
    schedule,
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (interval !== undefined) clearInterval(interval);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      win.removeEventListener('resize', schedule);
      win.removeEventListener('scroll', schedule, { capture: true });
    },
  };
}
