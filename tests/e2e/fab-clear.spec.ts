// A form can pin its own submit button to the bottom of the window, right where the FAB sits, and the FAB grows
// once it has a result. Seen on a real application page: the FAB covered the edge of 提交简历. It must never do that.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fabBox, fixtureUrl } from './helpers';

const GAP = 8;

/** A pinned bar with one button, placed under where the FAB sits. */
async function pinSubmit(page: Page, position: 'fixed' | 'sticky', fabX: number): Promise<void> {
  await page.evaluate(([pos, x]) => {
    // A sticky bar only sticks with the page running on past the bottom of the window.
    const tall = document.createElement('div');
    tall.style.height = '3000px';
    const bar = document.createElement('div');
    bar.id = 'bar';
    bar.style.cssText = `position:${pos};left:0;right:0;bottom:0;height:60px;background:#eee;z-index:5`;
    const button = document.createElement('button');
    button.id = 'submit';
    button.type = 'button';
    button.textContent = '提交简历';
    button.style.cssText = 'position:absolute;bottom:10px;width:120px;height:40px';
    bar.append(button);
    const page = document.createElement('div');
    page.append(tall, bar);
    document.body.prepend(page);
    // The right edge of the button runs 20px under the left edge of the FAB, whatever the page's own margins are.
    button.style.left = `${(x as number) + 20 - 120 - bar.getBoundingClientRect().left}px`;
  }, [position, fabX] as const);
}

const clearOf = async (page: Page): Promise<boolean> => {
  const fab = await fabBox(page);
  const b = (await page.locator('#submit').boundingBox())!;
  return (
    fab.x + fab.width + GAP <= b.x ||
    b.x + b.width + GAP <= fab.x ||
    fab.y + fab.height + GAP <= b.y ||
    b.y + b.height + GAP <= fab.y
  );
};

for (const position of ['fixed', 'sticky'] as const) {
  test(`the FAB moves off a ${position} button at the bottom of the window`, async ({ context }) => {
    const page = await context.newPage();
    await page.goto(fixtureUrl('native'));
    const before = await fabBox(page);
    await pinSubmit(page, position, before.x);
    // The button has to be under where the FAB was for this to prove anything.
    const b = (await page.locator('#submit').boundingBox())!;
    expect(b.x + b.width).toBe(before.x + 20);
    expect(b.y).toBeLessThan(before.y + before.height);
    await expect.poll(() => clearOf(page), { timeout: 5000 }).toBe(true);
    const after = await fabBox(page);
    expect(after.y).toBeLessThan(before.y);
    expect(after.x + after.width).toBe(before.x + before.width);
    await page.close();
  });
}

test('the FAB goes back down when the button is gone', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl('native'));
  const before = await fabBox(page);
  await pinSubmit(page, 'fixed', before.x);
  await expect.poll(() => clearOf(page), { timeout: 5000 }).toBe(true);
  await page.evaluate(() => document.getElementById('bar')!.remove());
  await expect.poll(async () => (await fabBox(page)).y, { timeout: 5000 }).toBe(before.y);
  await page.close();
});

test('a button that scrolls with the page does not move the FAB', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl('native'));
  const before = await fabBox(page);
  await page.evaluate(({ x, y, w, h }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Add another';
    button.style.cssText = `position:absolute;left:${x}px;top:${y + scrollY}px;width:${w}px;height:${h}px`;
    document.body.append(button);
  }, { x: before.x, y: before.y, w: before.width, h: before.height });
  await page.waitForTimeout(1500);
  expect((await fabBox(page)).y).toBe(before.y);
  await page.close();
});
