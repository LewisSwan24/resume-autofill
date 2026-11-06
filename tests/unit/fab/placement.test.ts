import { describe, expect, it } from 'vitest';
import {
  MARGIN,
  MAX_SITES,
  anchorOf,
  cardSides,
  forgetSite,
  placeOf,
  rememberSite,
  type Anchor,
} from '../../../entrypoints/fab.content/placement';

const VW = 1000;
const VH = 800;

describe('anchorOf', () => {
  it('keeps the distance to the nearest edges', () => {
    // Right half, bottom half: measured from the right and bottom.
    expect(anchorOf({ left: 700, top: 600, right: 900, bottom: 660 }, VW, VH)).toEqual({
      side: 'right',
      x: 100,
      edge: 'bottom',
      y: 140,
    });
    // Left half, top half: measured from the left and top.
    expect(anchorOf({ left: 40, top: 30, right: 240, bottom: 90 }, VW, VH)).toEqual({
      side: 'left',
      x: 40,
      edge: 'top',
      y: 30,
    });
  });
});

describe('placeOf', () => {
  const size = { width: 200, height: 60 };

  it('puts the button back where it was let go', () => {
    const box = { left: 700, top: 600, right: 900, bottom: 660 };
    expect(placeOf(anchorOf(box, VW, VH), size, VW, VH)).toEqual({ left: 700, top: 600 });
  });

  it('follows the nearest edges when the window changes size', () => {
    const anchor: Anchor = { side: 'right', x: 100, edge: 'bottom', y: 140 };
    expect(placeOf(anchor, size, 600, 500)).toEqual({ left: 300, top: 300 });
  });

  it('keeps the right edge when the button grows', () => {
    const anchor: Anchor = { side: 'right', x: 100, edge: 'bottom', y: 140 };
    expect(placeOf(anchor, { width: 320, height: 60 }, VW, VH)).toEqual({ left: 580, top: 600 });
  });

  it('never leaves the window, whatever was stored', () => {
    const far: Anchor = { side: 'left', x: 5000, edge: 'top', y: -300 };
    expect(placeOf(far, size, VW, VH)).toEqual({ left: VW - MARGIN - 200, top: MARGIN });
    const tiny = placeOf({ side: 'right', x: 0, edge: 'bottom', y: 0 }, size, 150, 40);
    // A window smaller than the button: the top-left corner stays reachable.
    expect(tiny).toEqual({ left: MARGIN, top: MARGIN });
  });

  it('ignores a stored place that is not numbers', () => {
    const bad = { side: 'right', x: Number.NaN, edge: 'bottom', y: Infinity } as Anchor;
    const at = placeOf(bad, size, VW, VH);
    expect(Number.isFinite(at.left) && Number.isFinite(at.top)).toBe(true);
  });
});

describe('cardSides', () => {
  it('opens the card towards the middle of the window', () => {
    expect(cardSides({ left: 700, top: 600, right: 900, bottom: 660 }, VW, VH)).toEqual({ x: 'end', y: 'up' });
    expect(cardSides({ left: 40, top: 30, right: 240, bottom: 90 }, VW, VH)).toEqual({ x: 'start', y: 'down' });
    expect(cardSides({ left: 40, top: 600, right: 240, bottom: 660 }, VW, VH)).toEqual({ x: 'start', y: 'up' });
  });
});

describe('per-site memory', () => {
  const at: Anchor = { side: 'left', x: 20, edge: 'top', y: 30 };

  it('keeps one place per site and forgets on request', () => {
    let places = rememberSite({}, 'a.example', at, 1);
    places = rememberSite(places, 'b.example', { ...at, x: 50 }, 2);
    expect(places['a.example']).toMatchObject(at);
    expect(places['b.example']).toMatchObject({ x: 50 });
    expect(forgetSite(places, 'a.example')).not.toHaveProperty('a.example');
  });

  it('drops the sites used longest ago past the limit', () => {
    let places = {};
    for (let i = 0; i <= MAX_SITES; i++) places = rememberSite(places, `s${i}.example`, at, i);
    expect(Object.keys(places)).toHaveLength(MAX_SITES);
    expect(places).not.toHaveProperty('s0.example');
    expect(places).toHaveProperty(`s${MAX_SITES}.example`);
  });
});
