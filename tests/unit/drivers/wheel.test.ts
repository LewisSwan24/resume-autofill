// turnWheel against a stand-in for rmc-picker that keeps where the wheel is drawn apart from the row the page holds,
// as measured on the phone: a finger let go exactly on a row moves the picture and not the value, the value follows
// only when the wheel settles onto a row by itself, and a touch that does not move is a tap that changes nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { turnWheel, wheelIndex } from '../../../src/drivers/wheel';

const ROW = 34;

function picker(items: string[], selected: number, drawnAt = selected): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rmc-picker';
  el.innerHTML =
    `<div class="rmc-picker-indicator" style="top: ${ROW}px;"></div>` +
    `<div class="rmc-picker-content">${items.map((t) => `<div class="rmc-picker-item">${t}</div>`).join('')}</div>`;
  const content = el.querySelector<HTMLElement>('.rmc-picker-content')!;
  const draw = (row: number) => (content.style.transform = `translate3d(0px, ${-row * ROW}px, 0px)`);
  const drawn = () => Math.round(-Number(/,\s*([-\d.]+)px/.exec(content.style.transform)![1]) / ROW);
  const hold = (row: number) => {
    const i = Math.max(0, Math.min(items.length - 1, row));
    el.querySelectorAll('.rmc-picker-item').forEach((it, k) => it.classList.toggle('rmc-picker-item-selected', k === i));
    draw(i);
  };
  hold(selected);
  draw(drawnAt);
  let startY: number | null = null;
  let from = 0;
  const y = (e: Event, list: string) => (e as unknown as Record<string, ArrayLike<{ screenY: number }>>)[list]?.[0]?.screenY;
  el.addEventListener('touchstart', (e) => {
    startY = y(e, 'touches') ?? null;
    from = drawn();
  });
  el.addEventListener('touchend', (e) => {
    const end = y(e, 'changedTouches');
    if (startY === null || end === undefined) return;
    const rows = (startY - end) / ROW;
    startY = null;
    if (Math.abs(rows) < 0.05) return;
    if (Math.abs(rows - Math.round(rows)) < 0.05) return draw(from + Math.round(rows));
    hold(from + Math.round(rows));
  });
  document.body.append(el);
  return el;
}

afterEach(() => document.body.replaceChildren());

describe('turnWheel', () => {
  it('turns to a row further down', async () => {
    const p = picker(['2019', '2020', '2021', '2022'], 0);
    expect(await turnWheel(p, 2, { timeoutMs: 100 })).toBe(true);
    expect(wheelIndex(p)).toBe(2);
  });

  it('settles a wheel already drawn on the answer that the page has not taken', async () => {
    // A let-go the page ignored: the picture shows 2021, the page still holds 2019.
    const p = picker(['2019', '2020', '2021', '2022'], 0, 2);
    expect(await turnWheel(p, 2, { timeoutMs: 100 })).toBe(true);
    expect(wheelIndex(p)).toBe(2);
  });
});
