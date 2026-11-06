// Where the FAB sits once someone has dragged it. The place is kept per site (hostname) in storage.local, as the
// distance to the two nearest window edges, so the button stays in the same corner when the window changes size.
// Pure geometry plus the stored map; the drag itself lives in drag.ts.
import { browser } from 'wxt/browser';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Anchor {
  side: 'left' | 'right';
  /** Distance from that side of the window to the same side of the button. */
  x: number;
  edge: 'top' | 'bottom';
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Places = Record<string, Anchor & { at: number }>;

/** The button never comes closer than this to a window edge. */
export const MARGIN = 8;
/** Sites remembered at most; the one used longest ago goes first. */
export const MAX_SITES = 200;
export const PLACES_KEY = 'fabPlaces';

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

export function anchorOf(box: Box, vw: number, vh: number): Anchor {
  const left = (box.left + box.right) / 2 < vw / 2;
  const top = (box.top + box.bottom) / 2 < vh / 2;
  return {
    side: left ? 'left' : 'right',
    x: left ? box.left : vw - box.right,
    edge: top ? 'top' : 'bottom',
    y: top ? box.top : vh - box.bottom,
  };
}

/** Keep a button of `size` at least MARGIN inside the window; a window too small for it keeps its top-left corner. */
export function clampTo(left: number, top: number, size: Size, vw: number, vh: number): { left: number; top: number } {
  const fit = (at: number, length: number, room: number) => Math.max(MARGIN, Math.min(finite(at), room - MARGIN - length));
  return { left: fit(left, size.width, vw), top: fit(top, size.height, vh) };
}

export function placeOf(anchor: Anchor, size: Size, vw: number, vh: number): { left: number; top: number } {
  const left = anchor.side === 'left' ? anchor.x : vw - finite(anchor.x) - size.width;
  const top = anchor.edge === 'top' ? anchor.y : vh - finite(anchor.y) - size.height;
  return clampTo(left, top, size, vw, vh);
}

/** The card opens towards the middle of the window: lined up with the button's nearer side, above or below it. */
export function cardSides(box: Box, vw: number, vh: number): { x: 'start' | 'end'; y: 'up' | 'down' } {
  return {
    x: (box.left + box.right) / 2 < vw / 2 ? 'start' : 'end',
    y: (box.top + box.bottom) / 2 < vh / 2 ? 'down' : 'up',
  };
}

export function rememberSite(places: Places, site: string, anchor: Anchor, at: number): Places {
  const next: Places = { ...places, [site]: { side: anchor.side, x: anchor.x, edge: anchor.edge, y: anchor.y, at } };
  const sites = Object.keys(next);
  if (sites.length <= MAX_SITES) return next;
  sites.sort((a, b) => next[a]!.at - next[b]!.at);
  for (const old of sites.slice(0, sites.length - MAX_SITES)) delete next[old];
  return next;
}

export function forgetSite(places: Places, site: string): Places {
  const { [site]: _gone, ...rest } = places;
  return rest;
}

function isAnchor(v: unknown): v is Anchor {
  const a = v as Anchor | null;
  return (
    !!a &&
    (a.side === 'left' || a.side === 'right') &&
    (a.edge === 'top' || a.edge === 'bottom') &&
    Number.isFinite(a.x) &&
    Number.isFinite(a.y)
  );
}

async function readPlaces(): Promise<Places> {
  const stored = (await browser.storage.local.get(PLACES_KEY))[PLACES_KEY];
  return stored && typeof stored === 'object' ? (stored as Places) : {};
}

export async function loadPlace(site: string): Promise<Anchor | null> {
  const place = (await readPlaces())[site];
  return isAnchor(place) ? place : null;
}

export async function savePlace(site: string, anchor: Anchor): Promise<void> {
  await browser.storage.local.set({ [PLACES_KEY]: rememberSite(await readPlaces(), site, anchor, Date.now()) });
}

/** Every site's button goes back to its corner. */
export async function forgetAllPlaces(): Promise<void> {
  await browser.storage.local.remove(PLACES_KEY);
}

/** Called with the site's place whenever it changes elsewhere (another tab, the options page). Returns a stop function. */
export function watchPlace(site: string, onChange: (anchor: Anchor | null) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(PLACES_KEY in changes)) return;
    const place = ((changes[PLACES_KEY]!.newValue ?? {}) as Places)[site];
    onChange(isAnchor(place) ? place : null);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
