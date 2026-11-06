// The FAB can be dragged anywhere in the window. A drag never fills; the place is kept per site and is put back
// on the next visit; the window shrinking never pushes the button out of sight; the card opens towards the middle.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fabBox, fixtureUrl, scanTotal, storedReport, tabIdOf, waitForSeed, type FabBox } from './helpers';

const MARGIN = 8;
const FORM = `<!doctype html><html><head><meta charset="utf-8"><title>form</title></head><body style="margin:0">
<form><label>Name <input name="name"></label><label>Email <input type="email" name="email"></label></form>
<div style="height:3000px"></div></body></html>`;

/** Two made-up sites served by the test itself, so "another site" really is another host. */
async function serveSites(context: BrowserContext): Promise<void> {
  await context.route(/^http:\/\/(site-a|site-b)\.test\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FORM }),
  );
}

const centre = (b: FabBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Press on the FAB, move in small steps like a hand would, let go. */
async function drag(page: Page, dx: number, dy: number): Promise<void> {
  const from = centre(await fabBox(page));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}

interface Node {
  nodeId: number;
  attributes?: string[];
  children?: Node[];
  shadowRoots?: Node[];
}

/** An element inside the closed shadow root, found through the DevTools protocol (page scripts cannot reach it). */
async function inShadow<T>(page: Page, cls: string, use: (cdp: any, nodeId: number) => Promise<T>): Promise<T | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: Node };
    const stack: Node[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      const a = n.attributes ?? [];
      const i = a.indexOf('class');
      if (i >= 0 && a[i + 1]!.split(/\s+/).includes(cls)) return await use(cdp, n.nodeId);
      stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []));
    }
    return null;
  } finally {
    await cdp.detach();
  }
}

const shadowBox = (page: Page, cls: string) =>
  inShadow(page, cls, async (cdp, nodeId) => {
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, , , x3, y3] = model.border as number[];
    return { x: x1!, y: y1!, width: x3! - x1!, height: y3! - y1! };
  });

test('a drag moves the FAB without filling; a click afterwards still fills', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  const url = fixtureUrl('native');
  await page.goto(url);
  const tabId = await tabIdOf(serviceWorker, url);
  await expect.poll(() => scanTotal(serviceWorker, tabId)).toBeGreaterThan(0);

  const before = await fabBox(page);
  await drag(page, -400, -300);
  const after = await fabBox(page);
  expect(Math.abs(after.x - (before.x - 400))).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - (before.y - 300))).toBeLessThanOrEqual(2);

  await page.waitForTimeout(1500);
  expect(await storedReport(serviceWorker, tabId)).toBeNull();

  const at = centre(after);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => storedReport(serviceWorker, tabId), { timeout: 60_000 }).not.toBeNull();
  await page.close();
});

test('a small wobble while clicking is still a click', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  const url = fixtureUrl('native');
  await page.goto(url);
  const tabId = await tabIdOf(serviceWorker, url);
  await expect.poll(() => scanTotal(serviceWorker, tabId)).toBeGreaterThan(0);
  const before = await fabBox(page);
  await drag(page, 2, 1);
  // It fills, so the caption (and the width) changes at once: the corner it sits in must not.
  const after = await fabBox(page);
  expect(after.x + after.width).toBe(before.x + before.width);
  expect(after.y + after.height).toBe(before.y + before.height);
  await expect.poll(() => storedReport(serviceWorker, tabId), { timeout: 60_000 }).not.toBeNull();
  await page.close();
});

test('the place is kept for the site and only for that site', async ({ context }) => {
  await serveSites(context);
  const a = await context.newPage();
  await a.goto('http://site-a.test/');
  const home = await fabBox(a);
  await drag(a, -500, -350);
  const moved = await fabBox(a);

  await a.reload();
  await expect.poll(async () => (await fabBox(a)).y, { timeout: 5000 }).toBe(moved.y);
  expect((await fabBox(a)).x).toBe(moved.x);

  const b = await context.newPage();
  await b.goto('http://site-b.test/');
  await b.waitForTimeout(800);
  expect(await fabBox(b)).toEqual(home);
  await a.close();
  await b.close();
});

test('a smaller window never pushes the FAB out of sight', async ({ context }) => {
  await serveSites(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('http://site-a.test/');
  // Into the middle of the window, then the window shrinks past it.
  await drag(page, -300, -200);
  await page.setViewportSize({ width: 700, height: 420 });
  await expect
    .poll(async () => {
      const b = await fabBox(page);
      return b.x >= MARGIN - 1 && b.y >= MARGIN - 1 && b.x + b.width <= 700 - MARGIN + 1 && b.y + b.height <= 420 - MARGIN + 1;
    })
    .toBe(true);
  // Dragging past the edge stops at the margin.
  await drag(page, 2000, 2000);
  const b = await fabBox(page);
  expect(Math.round(b.x + b.width)).toBe(700 - MARGIN);
  expect(Math.round(b.y + b.height)).toBe(420 - MARGIN);
  await page.close();
});

test('the result card opens towards the middle of the window', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const url = fixtureUrl('native');
  await page.goto(url);
  const tabId = await tabIdOf(serviceWorker, url);
  await expect.poll(() => scanTotal(serviceWorker, tabId)).toBeGreaterThan(0);

  // Top left corner.
  const start = await fabBox(page);
  await drag(page, MARGIN + 20 - start.x, MARGIN + 20 - start.y);
  const fab = await fabBox(page);
  expect(fab.x).toBeLessThan(100);
  expect(fab.y).toBeLessThan(100);
  const at = centre(fab);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => shadowBox(page, 'raf-card'), { timeout: 60_000 }).not.toBeNull();
  const card = (await shadowBox(page, 'raf-card'))!;
  // Below the button and lined up with its left edge: inside the window.
  expect(card.y).toBeGreaterThanOrEqual(fab.y + fab.height);
  expect(Math.round(card.x)).toBe(Math.round(fab.x));
  expect(card.x + card.width).toBeLessThanOrEqual(1280);
  await page.close();
});

// Seen live on a real form: the button left a little above the middle, and the card ran past the bottom of the window.
test('the card stays inside the window wherever the button is', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  // A short window: whichever way the card opens, it has less room than its own height.
  await page.setViewportSize({ width: 1280, height: 420 });
  const url = fixtureUrl('native');
  await page.goto(url);
  const tabId = await tabIdOf(serviceWorker, url);
  await expect.poll(() => scanTotal(serviceWorker, tabId)).toBeGreaterThan(0);

  const start = await fabBox(page);
  await drag(page, 120 - start.x, 140 - start.y);
  const fab = await fabBox(page);
  const at = centre(fab);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => shadowBox(page, 'raf-card'), { timeout: 60_000 }).not.toBeNull();
  // Let the opening animation finish before measuring.
  await page.waitForTimeout(600);
  const card = (await shadowBox(page, 'raf-card'))!;
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y + card.height).toBeLessThanOrEqual(420);
  await page.close();
});

test('a dragged FAB stays where it was put, even over a pinned button', async ({ context }) => {
  await serveSites(context);
  const page = await context.newPage();
  await page.goto('http://site-a.test/');
  await drag(page, -200, 0);
  const put = await fabBox(page);
  await page.evaluate(({ x, y, w, h }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '提交';
    b.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    document.body.append(b);
  }, { x: put.x, y: put.y, w: put.width, h: put.height });
  await page.waitForTimeout(1500);
  expect(await fabBox(page)).toEqual(put);
  await page.close();
});

test('a drag cut short when the page takes the button away does not stick to the pointer', async ({ context }) => {
  await serveSites(context);
  const page = await context.newPage();
  await page.goto('http://site-a.test/');
  const from = centre(await fabBox(page));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 60, from.y - 40, { steps: 6 });
  // A page that rebuilds its body takes the button with it; it is put straight back.
  await page.evaluate(() => {
    const host = document.querySelector('raf-fab')!;
    host.remove();
    document.body.append(host);
  });
  await page.mouse.move(200, 200, { steps: 4 });
  await page.mouse.up();
  const let_go = await fabBox(page);
  // No button held: passing over the FAB and away again must not carry it along.
  const over = centre(let_go);
  await page.mouse.move(over.x, over.y, { steps: 4 });
  await page.mouse.move(over.x - 300, over.y - 200, { steps: 8 });
  expect(await fabBox(page)).toEqual(let_go);
  await page.close();
});

test('after a drag by touch, Enter on the focused FAB still fills', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  const url = fixtureUrl('native');
  await page.goto(url);
  const tabId = await tabIdOf(serviceWorker, url);
  await expect.poll(() => scanTotal(serviceWorker, tabId)).toBeGreaterThan(0);
  const from = centre(await fabBox(page));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', from.x, from.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', from.x - i * 30, from.y - i * 20);
  await touch('touchEnd', from.x - 240, from.y - 160);
  await cdp.detach();
  const moved = await fabBox(page);
  expect(moved.x).toBeLessThan(from.x - 150);
  expect(await storedReport(serviceWorker, tabId)).toBeNull();

  await inShadow(page, 'raf-fab', (c, nodeId) => c.send('DOM.focus', { nodeId }));
  await page.keyboard.press('Enter');
  await expect.poll(() => storedReport(serviceWorker, tabId), { timeout: 60_000 }).not.toBeNull();
  await page.close();
});

test('Alt and the arrow keys move a focused FAB', async ({ context }) => {
  await serveSites(context);
  const page = await context.newPage();
  await page.goto('http://site-a.test/');
  const before = await fabBox(page);
  await inShadow(page, 'raf-fab', (cdp, nodeId) => cdp.send('DOM.focus', { nodeId }));
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowUp');
  const after = await fabBox(page);
  expect(after.x).toBeLessThan(before.x);
  expect(after.y).toBeLessThan(before.y);
  await page.reload();
  await expect.poll(async () => (await fabBox(page)).x, { timeout: 5000 }).toBe(after.x);
  await page.close();
});

test('the options page puts every FAB back in its corner', async ({ context, extensionId }) => {
  await serveSites(context);
  const page = await context.newPage();
  await page.goto('http://site-a.test/');
  const home = await fabBox(page);
  await drag(page, -400, -300);
  expect(await fabBox(page)).not.toEqual(home);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('tab', { name: /settings|设置/i }).click();
  await options.getByRole('button', { name: /reset (the )?button position|按钮位置复位/i }).click();

  // The open page follows at once, and so does the next visit.
  await expect.poll(() => fabBox(page), { timeout: 5000 }).toEqual(home);
  await page.reload();
  await page.waitForTimeout(800);
  expect(await fabBox(page)).toEqual(home);
  await options.close();
  await page.close();
});
