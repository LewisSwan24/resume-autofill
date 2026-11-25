// rmc-picker, the wheel that mobile forms put in a drawer (Feishu's atsx, antd-mobile 2). It turns only for a
// finger: a drag of touch events measured by screenY. A mouse drag does nothing (measured on Android 13, WebView 156),
// and a click on a row does not choose it either. A finger let go exactly on a row moves the picture but, on Feishu's
// end-month wheel, not the value: the value follows only when the wheel settles onto a row by itself. So the drag
// stops short and lets it settle.
import { winOf } from './events';
import { waitFor } from './wait';

const ITEM = '.rmc-picker-item';
const SELECTED = 'rmc-picker-item-selected';
/**
 * Steps of the drag, the time between them, and the stand-still before lifting so the wheel gets no speed. The wheel
 * takes its speed from the moves of the last 100 ms before the finger lifts, so a stand-still longer than that leaves it
 * none, however quick the drag before it (checked on the Feishu phone replays: same answers, a third less time).
 */
const STEPS = 3;
const STEP_MS = 25;
const STILL_MS = 120;
/** Drags to land on the row: the wheel can stop one short, and the next drag puts it right. */
const TRIES = 3;
/** What a row measured on the phone, for when the page cannot say. */
const FALLBACK_ROW = 34;
/** How far short of the row the finger lets go, in rows: under half, so the wheel settles onto the right one. */
const SHORT = 0.3;

export const wheelItems = (picker: Element): HTMLElement[] => Array.from(picker.querySelectorAll<HTMLElement>(ITEM));
export const wheelTexts = (picker: Element): string[] => wheelItems(picker).map((i) => (i.textContent ?? '').replace(/\s+/g, ' ').trim());
export const wheelIndex = (picker: Element): number => wheelItems(picker).findIndex((i) => i.classList.contains(SELECTED));

/** Height of one row: as laid out, or as the indicator is placed (it sits one row down). */
function rowHeight(picker: Element): number {
  const laid = wheelItems(picker)[0]?.getBoundingClientRect().height ?? 0;
  if (laid > 0) return laid;
  const indicator = picker.querySelector<HTMLElement>('.rmc-picker-indicator')?.style.top ?? '';
  const styled = parseFloat(indicator);
  return styled > 0 ? styled : FALLBACK_ROW;
}

/** The row the wheel shows, from where it has been moved to; the chosen row when the page says nothing of that. */
function shownIndex(picker: Element, row: number): number {
  const moved = /translate3d\(\s*[-\d.]+px,\s*([-\d.]+)px/.exec(picker.querySelector<HTMLElement>('.rmc-picker-content')?.style.transform ?? '');
  return moved ? Math.round(-Number(moved[1]) / row) : wheelIndex(picker);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** A touch event the way a browser makes one; where Touch cannot be built, the same points on a plain event. */
export function touchEvent(target: Element, type: string, x: number, y: number, lifted: boolean): Event {
  const win = winOf(target) as unknown as Record<string, unknown> & Window;
  const point = { identifier: 1, target, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x + win.scrollX, pageY: y + win.scrollY, radiusX: 1, radiusY: 1, force: 1 };
  const lists = (touch: unknown) => ({ touches: lifted ? [] : [touch], targetTouches: lifted ? [] : [touch], changedTouches: [touch] });
  const init = { bubbles: true, cancelable: true, composed: true };
  try {
    const Touch = win.Touch as new (p: typeof point) => unknown;
    const TouchEvent = win.TouchEvent as new (t: string, i: object) => Event;
    return new TouchEvent(type, { ...init, view: win, ...lists(new Touch(point)) });
  } catch {
    const event = new (win.Event as typeof Event)(type, init);
    for (const [name, list] of Object.entries(lists(point))) Object.defineProperty(event, name, { value: list });
    return event;
  }
}

async function drag(picker: HTMLElement, dy: number, signal?: AbortSignal): Promise<void> {
  const r = picker.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  picker.dispatchEvent(touchEvent(picker, 'touchstart', x, y0, false));
  for (let i = 1; i <= STEPS; i++) {
    await sleep(STEP_MS, signal);
    picker.dispatchEvent(touchEvent(picker, 'touchmove', x, y0 + (dy * i) / STEPS, false));
  }
  await sleep(STILL_MS, signal);
  picker.dispatchEvent(touchEvent(picker, 'touchmove', x, y0 + dy, false));
  picker.dispatchEvent(touchEvent(picker, 'touchend', x, y0 + dy, true));
}

/** Turn the wheel until row `target` is the chosen one. False when it would not get there. */
export async function turnWheel(
  picker: HTMLElement,
  target: number,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (wheelIndex(picker) === target) return true;
    const row = rowHeight(picker);
    // From where the wheel stands, which a let-go the page ignored may have left apart from the chosen row.
    const rows = Math.max(0, shownIndex(picker, row)) - target;
    // Later rows are further down: the finger goes up to bring them to the middle, and stops a little short. Drawn on
    // the row already but not taken, a touch that does not move is a tap: a short nudge instead, which the wheel
    // settles back from by itself, and settling is what the page hears.
    await drag(picker, rows === 0 ? SHORT * row : (rows - Math.sign(rows) * SHORT) * row, opts.signal);
    if (opts.signal?.aborted) return false;
    const landed = await waitFor(() => wheelIndex(picker) === target, { timeout: opts.timeoutMs ?? 1200, signal: opts.signal, root: picker });
    if (landed) return true;
  }
  return wheelIndex(picker) === target;
}
