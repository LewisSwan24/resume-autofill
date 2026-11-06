// Lets the FAB be moved: press and drag (mouse, pen or touch), or Alt + arrow keys while it has focus. A press that
// moves less than DRAG_PX is a click and fills as before; a drag never fills. Where it is let go is kept per site
// (placement.ts) and put back on the next visit. Once placed, the button stays there: keepClear no longer lifts it.
import {
  anchorOf,
  cardSides,
  clampTo,
  loadPlace,
  MARGIN,
  placeOf,
  savePlace,
  watchPlace,
  type Anchor,
} from './placement';

/** Movement under this is a shaky click, not a drag. */
export const DRAG_PX = 4;
/** One Alt + arrow press. */
const NUDGE_PX = 10;
const BUTTON = '.raf-fab';
export const PLACED = 'data-placed';
const LEFT = '--resume-autofill-fab-left';
const TOP = '--resume-autofill-fab-top';
/** How tall the card may be where the button is now: the room between the button and the window edge it opens to. */
const ROOM = '--resume-autofill-card-room';
/** The card's distance from the button (--raf-space-2) and from the window edge. */
const CARD_GAP = 8;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const fromButton = (e: Event): boolean =>
  e.composedPath().some((n) => n instanceof Element && n.matches(BUTTON));

/** Returns a function that stops it. */
export function makeDraggable(host: HTMLElement, shadow: ShadowRoot, site: string, win: Window = window): () => void {
  let anchor: Anchor | null = null;
  let press: { id: number; x: number; y: number; left: number; top: number } | null = null;
  let dragging = false;
  let swallowClick = false;
  let stopped = false;

  const size = () => {
    const r = host.getBoundingClientRect();
    return { width: r.width, height: r.height };
  };

  const setAt = (left: number, top: number) => {
    host.style.setProperty(LEFT, `${Math.round(left)}px`);
    host.style.setProperty(TOP, `${Math.round(top)}px`);
    host.setAttribute(PLACED, '');
    const s = size();
    const sides = cardSides({ left, top, right: left + s.width, bottom: top + s.height }, win.innerWidth, win.innerHeight);
    host.setAttribute('data-card-x', sides.x);
    host.setAttribute('data-card-y', sides.y);
    const room = sides.y === 'down' ? win.innerHeight - (top + s.height) : top;
    host.style.setProperty(ROOM, `${Math.max(0, Math.floor(room - CARD_GAP - MARGIN))}px`);
  };

  const apply = () => {
    if (!anchor) {
      for (const name of [PLACED, 'data-card-x', 'data-card-y']) host.removeAttribute(name);
      host.style.removeProperty(LEFT);
      host.style.removeProperty(TOP);
      host.style.removeProperty(ROOM);
      return;
    }
    const at = placeOf(anchor, size(), win.innerWidth, win.innerHeight);
    setAt(at.left, at.top);
  };

  /** Keep where the button is now, for this page and the next visit. */
  const keep = () => {
    const r = host.getBoundingClientRect();
    anchor = anchorOf(r, win.innerWidth, win.innerHeight);
    void savePlace(site, anchor).catch(() => {
      /* storage can fail while the extension reloads; the button still stays put on this page */
    });
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary || !fromButton(e)) return;
    const r = host.getBoundingClientRect();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    dragging = false;
    // Keep receiving the moves even when a fast hand leaves the button; the click still lands on it.
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      dragging = true;
      host.setAttribute('data-dragging', '');
    }
    e.preventDefault();
    const at = clampTo(press.left + dx, press.top + dy, size(), win.innerWidth, win.innerHeight);
    setAt(at.left, at.top);
  };

  const onUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    if (!dragging) return;
    dragging = false;
    host.removeAttribute('data-dragging');
    // The click that follows this release belongs to the drag.
    swallowClick = e.type === 'pointerup';
    keep();
  };

  const onClick = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKey = (e: KeyboardEvent) => {
    const step = ARROWS[e.key];
    if (!step || !e.altKey || e.ctrlKey || e.metaKey || !fromButton(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = host.getBoundingClientRect();
    const by = e.shiftKey ? NUDGE_PX * 4 : NUDGE_PX;
    const at = clampTo(r.left + step[0] * by, r.top + step[1] * by, size(), win.innerWidth, win.innerHeight);
    setAt(at.left, at.top);
    keep();
  };

  // A press that never reaches pointerup (the button is pressed, then a key moves focus) must not leave a stale swallow.
  const onDownReset = () => {
    swallowClick = false;
  };

  const reapply = () => {
    if (anchor && !dragging) apply();
  };

  shadow.addEventListener('pointerdown', onDownReset, true);
  shadow.addEventListener('pointerdown', onDown as EventListener);
  shadow.addEventListener('pointermove', onMove as EventListener);
  shadow.addEventListener('pointerup', onUp as EventListener);
  shadow.addEventListener('pointercancel', onUp as EventListener);
  // Capture on the shadow root runs before React's own listeners on its container inside it.
  shadow.addEventListener('click', onClick as EventListener, true);
  shadow.addEventListener('keydown', onKey as EventListener, true);
  win.addEventListener('resize', reapply, { passive: true });
  // The button grows once a result arrives: keep the edge it is anchored to.
  const grows = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reapply);
  grows?.observe(host);
  const stopWatch = watchPlace(site, (next) => {
    if (dragging) return;
    anchor = next;
    apply();
  });

  void loadPlace(site)
    .then((stored) => {
      if (stopped || !stored || press) return;
      anchor = stored;
      apply();
    })
    .catch(() => {
      /* no stored place: the button stays in its corner */
    });

  return () => {
    stopped = true;
    shadow.removeEventListener('pointerdown', onDownReset, true);
    shadow.removeEventListener('pointerdown', onDown as EventListener);
    shadow.removeEventListener('pointermove', onMove as EventListener);
    shadow.removeEventListener('pointerup', onUp as EventListener);
    shadow.removeEventListener('pointercancel', onUp as EventListener);
    shadow.removeEventListener('click', onClick as EventListener, true);
    shadow.removeEventListener('keydown', onKey as EventListener, true);
    win.removeEventListener('resize', reapply);
    grows?.disconnect();
    stopWatch();
  };
}
