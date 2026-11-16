// Where the native 「一键填写」 FAB sits over the page area. Pure; lengths in dp, page-area coordinates.
// The lift rule is the extension's (`liftFor` in entrypoints/fab.content/keepClear.ts), copied here because that file
// is a content-script module; follow-up: share it from a pure module under src/.

export interface Size {
  width: number;
  height: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Anchor {
  side: 'start' | 'end';
  fromBottom: number;
}
export interface PlaceInput {
  /** Page area in dp (pageArea event). */
  area: Size;
  /** Measured by native. */
  fab: Size;
  /** Already in dp, page-area coordinates. */
  obstacles: Box[];
  /** From a drag, this session only. */
  anchor: Anchor | null;
  hidden: { keyboard: boolean; sheet: boolean; error: boolean; loading: boolean };
}
export type Placement =
  | { show: false; docked?: undefined }
  | { show: true; x: number; y: number; side: 'start' | 'end'; docked: false }
  | { show: false; docked: true };

export const MARGIN = 16;
export const GAP = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Touching, with GAP of air around the FAB (keepClear.ts `near`). */
const near = (a: Box, b: Box): boolean =>
  a.left - GAP < b.right && b.left < a.right + GAP && a.top - GAP < b.bottom && b.top < a.bottom + GAP;

/**
 * How far up `fab` must move to leave every obstacle; null when that takes its top above `minTop`.
 * Adapted from keepClear.ts `liftFor` (which answers 0 for "cannot"): each round clears at least one obstacle for
 * good, because the FAB only ever moves up.
 */
function liftFor(fab: Box, obstacles: readonly Box[], minTop: number): number | null {
  let lift = 0;
  for (let round = 0; round <= obstacles.length; round++) {
    const at = { ...fab, top: fab.top - lift, bottom: fab.bottom - lift };
    const hits = obstacles.filter((o) => near(at, o));
    if (hits.length === 0) return at.top < minTop ? null : lift;
    lift = fab.bottom - (Math.min(...hits.map((o) => o.top)) - GAP);
  }
  return null;
}

function trySide(input: PlaceInput, side: 'start' | 'end', fromBottom: number): Placement | null {
  const { area, fab } = input;
  const x = side === 'end' ? area.width - fab.width - MARGIN : MARGIN;
  const y = clamp(area.height - fab.height - fromBottom, MARGIN, area.height - fab.height - MARGIN);
  const lift = liftFor({ left: x, top: y, right: x + fab.width, bottom: y + fab.height }, input.obstacles, MARGIN);
  if (lift === null) return null;
  return { show: true, x, y: y - lift, side, docked: false };
}

export function placeFab(input: PlaceInput): Placement {
  const h = input.hidden;
  if (h.keyboard || h.sheet || h.error || h.loading) return { show: false };
  const anchor = input.anchor ?? { side: 'end', fromBottom: MARGIN };
  const other = anchor.side === 'end' ? 'start' : 'end';
  return trySide(input, anchor.side, anchor.fromBottom) ?? trySide(input, other, anchor.fromBottom) ?? { show: false, docked: true };
}

/** The anchor a drag leaves behind: the nearer side, and the distance from the bottom (clamped into the area). */
export function anchorFromDrop(drop: { x: number; y: number }, fab: Size, area: Size): Anchor {
  const side = drop.x + fab.width / 2 < area.width / 2 ? 'start' : 'end';
  const fromBottom = clamp(area.height - (drop.y + fab.height), MARGIN, area.height - fab.height - MARGIN);
  return { side, fromBottom };
}

/**
 * Page obstacles (visual-viewport CSS px) → page-area dp. `offsetLeft`, `offsetTop` and `scale` travel along for
 * diagnostics only. Boxes fully outside the area are dropped; partly outside ones are clipped.
 */
export function toAreaBoxes(
  boxes: readonly Box[],
  vp: { width: number; offsetLeft: number; offsetTop: number; scale: number },
  area: Size,
): Box[] {
  if (!(vp.width > 0)) return [];
  const k = area.width / vp.width;
  const out: Box[] = [];
  for (const b of boxes) {
    const s = { left: b.left * k, top: b.top * k, right: b.right * k, bottom: b.bottom * k };
    if (s.right <= 0 || s.bottom <= 0 || s.left >= area.width || s.top >= area.height) continue;
    out.push({
      left: clamp(s.left, 0, area.width),
      top: clamp(s.top, 0, area.height),
      right: clamp(s.right, 0, area.width),
      bottom: clamp(s.bottom, 0, area.height),
    });
  }
  return out;
}
