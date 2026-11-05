import { describe, expect, it } from 'vitest';
import { isPinned, liftFor } from '../../../entrypoints/fab.content/keepClear';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const FAB = box(1264, 570, 1512, 615);

describe('what counts as pinned', () => {
  const mount = (html: string) => {
    document.body.innerHTML = html;
    return document.getElementById('b')!;
  };

  it('a button in a fixed bar, or sticky itself, stays where it is', () => {
    expect(isPinned(mount('<div style="position:fixed"><button id="b"></button></div>'), window)).toBe(true);
    expect(isPinned(mount('<button id="b" style="position:sticky"></button>'), window)).toBe(true);
    expect(isPinned(mount('<div><button id="b"></button></div>'), window)).toBe(false);
  });

  it('a button scrolling inside a fixed dialog moves, so chasing it would make the FAB jump', () => {
    const b = mount('<div id="d" style="position:fixed;overflow-y:auto"><button id="b"></button></div>');
    const dialog = document.getElementById('d')!;
    Object.defineProperty(dialog, 'scrollHeight', { value: 900 });
    Object.defineProperty(dialog, 'clientHeight', { value: 300 });
    expect(isPinned(b, window)).toBe(false);
  });

  it('a fixed dialog with nothing to scroll keeps its button still', () => {
    const b = mount('<div id="d" style="position:fixed;overflow-y:auto"><button id="b"></button></div>');
    const dialog = document.getElementById('d')!;
    Object.defineProperty(dialog, 'scrollHeight', { value: 300 });
    Object.defineProperty(dialog, 'clientHeight', { value: 300 });
    expect(isPinned(b, window)).toBe(true);
  });
});

describe('how far the FAB has to rise', () => {
  it('stays where it is with nothing near', () => {
    expect(liftFor(FAB, [])).toBe(0);
    expect(liftFor(FAB, [box(100, 570, 200, 615)])).toBe(0);
    expect(liftFor(FAB, [box(1264, 100, 1512, 140)])).toBe(0);
  });

  it('rises above a button it covers, with a gap', () => {
    // 提交简历 as measured on the live page: its right edge runs 12px under the FAB.
    expect(liftFor(FAB, [box(1156, 575, 1276, 615)])).toBe(615 - (575 - 8));
  });

  it('treats a button that only nearly touches as in the way', () => {
    expect(liftFor(FAB, [box(1100, 570, 1260, 615)])).toBe(615 - (570 - 8));
    expect(liftFor(FAB, [box(1100, 570, 1250, 615)])).toBe(0);
  });

  it('keeps rising past a second button in the way', () => {
    const second = box(1300, 500, 1400, 560);
    expect(liftFor(FAB, [box(1156, 575, 1276, 615), second])).toBe(615 - (500 - 8));
  });

  it('stays put rather than leave the window', () => {
    expect(liftFor(box(1264, 20, 1512, 65), [box(1156, 25, 1276, 65)])).toBe(0);
  });
});
