import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_OBSTACLES } from '../../../../mobile/bridge/protocol';
import { findObstacles, startObstacleWatcher } from '../../../../mobile/inject/obstacles';

// jsdom has no layout: positions come from data attributes, boxes from a stubbed getBoundingClientRect.
const H = 800;
const W = 400;

function rect(el: HTMLElement, top: number, height = 48, left = 0, width = W) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el: Element) =>
      ({
        position: (el as HTMLElement).dataset?.pos ?? 'static',
        overflowY: (el as HTMLElement).dataset?.ov ?? 'visible',
        visibility: 'visible',
        display: 'block',
      }) as CSSStyleDeclaration,
  );
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: H });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: W });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('findObstacles', () => {
  it('reports a fixed bottom submit bar', () => {
    document.body.innerHTML = '<div id="bar" data-pos="fixed"><button id="save">保存草稿</button><button id="submit" type="submit">提交</button></div>';
    rect(document.getElementById('save')!, H - 56, 48, 0, 190);
    rect(document.getElementById('submit')!, H - 56, 48, 200, 190);
    const found = findObstacles(window)!;
    expect(found.boxes).toEqual([
      { left: 0, top: H - 56, right: 190, bottom: H - 8 },
      { left: 200, top: H - 56, right: 390, bottom: H - 8 },
    ]);
    expect(found.viewport).toEqual({ width: W, height: H, offsetLeft: 0, offsetTop: 0, scale: 1 });
  });

  it('ignores a button inside a scrolling container', () => {
    document.body.innerHTML = '<div data-pos="fixed"><div id="scroller" data-ov="auto"><button id="b">提交</button></div></div>';
    const scroller = document.getElementById('scroller')!;
    Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    rect(document.getElementById('b')!, H - 56);
    expect(findObstacles(window)!.boxes).toEqual([]);
  });

  it('ignores a sticky bar at the top of the viewport (outside the bottom 40%)', () => {
    document.body.innerHTML = '<div data-pos="sticky"><button id="b">菜单</button></div>';
    rect(document.getElementById('b')!, 0);
    expect(findObstacles(window)!.boxes).toEqual([]);
  });

  it('ignores buttons that scroll with the page', () => {
    document.body.innerHTML = '<button id="b">提交</button>';
    rect(document.getElementById('b')!, H - 56);
    expect(findObstacles(window)!.boxes).toEqual([]);
  });

  it('keeps at most 16 boxes, the lowest ones', () => {
    document.body.innerHTML = `<div data-pos="fixed">${Array.from({ length: 20 }, (_, i) => `<button id="b${i}">按钮</button>`).join('')}</div>`;
    for (let i = 0; i < 20; i++) rect(document.getElementById(`b${i}`)!, H - 300 + i * 10, 10);
    const boxes = findObstacles(window)!.boxes;
    expect(boxes).toHaveLength(MAX_OBSTACLES);
    expect(Math.max(...boxes.map((b) => b.bottom))).toBe(H - 300 + 19 * 10 + 10);
    expect(Math.min(...boxes.map((b) => b.top))).toBe(H - 300 + 4 * 10);
  });
});

describe('startObstacleWatcher', () => {
  it('posts on start and only when the rounded boxes change', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div data-pos="fixed"><button id="b" type="submit">提交</button></div>';
      const b = document.getElementById('b')!;
      rect(b, H - 56);
      const post = vi.fn();
      const watcher = startObstacleWatcher(window, post);
      expect(post).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000);
      expect(post).toHaveBeenCalledTimes(1);
      rect(b, H - 100);
      vi.advanceTimersByTime(1_000);
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1]![0].boxes[0].top).toBe(H - 100);
      watcher.stop();
      rect(b, H - 200);
      vi.advanceTimersByTime(3_000);
      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
