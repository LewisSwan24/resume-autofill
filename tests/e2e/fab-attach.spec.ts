// Server-rendered pages can rebuild the whole document while they hydrate, which removes anything injected into
// it. Seen on a real application page. The button has to come back and still work.
import { expect, test } from './fixtures';
import { accessibleNames, fabBox, fixtureUrl, scanTotal, storedReport, tabIdOf, waitForSeed } from './helpers';

test('the FAB returns after the page removes it, and still fills', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  const url = fixtureUrl('native');
  await page.goto(url);
  await page.locator('raf-fab').waitFor({ state: 'attached' });
  const tabId = await tabIdOf(serviceWorker, url);
  await expect.poll(() => scanTotal(serviceWorker, tabId)).toBeGreaterThan(0);

  await page.evaluate(() => document.querySelector('raf-fab')?.remove());
  await expect(page.locator('raf-fab')).toBeAttached();
  await expect.poll(async () => (await accessibleNames(page)).some((n) => /fields? detected|识别到/.test(n))).toBe(true);

  // Replacing everything in <body> is what a failed hydration amounts to.
  await page.evaluate(() => {
    const keep = [...document.body.children].filter((el) => el.tagName !== 'RAF-FAB');
    document.body.replaceChildren(...keep);
    document.querySelector('raf-fab')?.remove();
  });
  await expect(page.locator('raf-fab')).toBeAttached();

  const box = await fabBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => storedReport(serviceWorker, tabId), { timeout: 60_000 }).not.toBeNull();
});
