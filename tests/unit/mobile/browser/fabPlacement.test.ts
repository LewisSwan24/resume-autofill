import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, anchorFromDrop, placeFab, toAreaBoxes, type PlaceInput } from '../../../../mobile/app/src/browser/model/fabPlacement';

const area = { width: 360, height: 600 };
const fab = { width: 120, height: 56 };
const hidden = { keyboard: false, sheet: false, error: false, loading: false };
const input = (over: Partial<PlaceInput> = {}): PlaceInput => ({ area, fab, obstacles: [], anchor: null, hidden, ...over });

describe('placeFab', () => {
  it('defaults to bottom-end with 16dp margins', () => {
    expect(placeFab(input())).toEqual({ show: true, x: 360 - 120 - MARGIN, y: 600 - 56 - MARGIN, side: 'end', docked: false });
  });

  it('a pinned submit bar across the bottom 64dp lifts it above the bar with an 8dp gap', () => {
    const p = placeFab(input({ obstacles: [{ left: 0, top: 536, right: 360, bottom: 600 }] }));
    expect(p).toMatchObject({ show: true, side: 'end' });
    if (p.show) expect(p.y + fab.height).toBe(536 - GAP);
  });

  it('obstacles over the whole right half move it to the start side', () => {
    const p = placeFab(input({ obstacles: [{ left: 180, top: 0, right: 360, bottom: 600 }] }));
    expect(p).toEqual({ show: true, x: MARGIN, y: 600 - 56 - MARGIN, side: 'start', docked: false });
  });

  it('no room on either side docks it into the toolbar', () => {
    expect(placeFab(input({ obstacles: [{ left: 0, top: 0, right: 360, bottom: 600 }] }))).toEqual({ show: false, docked: true });
  });

  it.each(['keyboard', 'sheet', 'error', 'loading'] as const)('%s hides it', (flag) => {
    expect(placeFab(input({ hidden: { ...hidden, [flag]: true } }))).toEqual({ show: false });
  });

  it('follows a dragged anchor and clamps it inside the area', () => {
    expect(placeFab(input({ anchor: { side: 'start', fromBottom: 200 } }))).toMatchObject({ x: MARGIN, y: 600 - 56 - 200, side: 'start' });
    expect(placeFab(input({ anchor: { side: 'end', fromBottom: 5000 } }))).toMatchObject({ y: MARGIN });
  });
});

describe('anchorFromDrop', () => {
  it('snaps to the nearer side and keeps the distance from the bottom', () => {
    expect(anchorFromDrop({ x: 10, y: 300 }, fab, area)).toEqual({ side: 'start', fromBottom: 600 - 356 });
    expect(anchorFromDrop({ x: 250, y: 100 }, fab, area)).toEqual({ side: 'end', fromBottom: 600 - 156 });
  });
  it('a drop below the area clamps', () => {
    expect(anchorFromDrop({ x: 250, y: 590 }, fab, area)).toEqual({ side: 'end', fromBottom: MARGIN });
    expect(anchorFromDrop({ x: 250, y: -100 }, fab, area)).toEqual({ side: 'end', fromBottom: 600 - 56 - MARGIN });
  });
});

describe('toAreaBoxes', () => {
  const b = { left: 0, top: 500, right: 360, bottom: 560 };
  it('is the identity at scale 1 and width 360 in a 360dp area', () => {
    expect(toAreaBoxes([b], { width: 360, offsetLeft: 0, offsetTop: 0, scale: 1 }, area)).toEqual([b]);
  });
  it('scales a 980px desktop page into 360dp', () => {
    const k = 360 / 980;
    const [out] = toAreaBoxes([{ left: 0, top: 980, right: 980, bottom: 1000 }], { width: 980, offsetLeft: 0, offsetTop: 0, scale: k }, { width: 360, height: 600 });
    expect(out!.right).toBeCloseTo(360);
    expect(out!.top).toBeCloseTo(980 * k);
    expect(out!.bottom).toBeCloseTo(1000 * k);
  });
  it('drops boxes outside the area and clips partly outside ones', () => {
    const out = toAreaBoxes(
      [
        { left: 0, top: 700, right: 100, bottom: 800 },
        { left: -50, top: 580, right: 100, bottom: 640 },
      ],
      { width: 360, offsetLeft: 0, offsetTop: 0, scale: 1 },
      area,
    );
    expect(out).toEqual([{ left: 0, top: 580, right: 100, bottom: 600 }]);
  });
});
