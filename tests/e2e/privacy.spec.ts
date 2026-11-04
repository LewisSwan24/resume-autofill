import { expect, test } from './fixtures';
import { fabBox, fixtureUrl } from './helpers';

// The extension must not announce itself to the page: no window.postMessage carrying the
// WXT "content-script-started" signal or the extension id.
test('content scripts post no messages to the page window', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __rafSeen: string[] }).__rafSeen = seen;
    window.addEventListener('message', (e) => {
      try {
        seen.push(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
      } catch {
        seen.push(String(e.data));
      }
    });
  });
  await page.goto(fixtureUrl('native'));
  await fabBox(page); // FAB mounted → both content scripts have started in the top frame
  await page.waitForTimeout(500); // allow any late postMessage to be delivered (test-only wait)
  const seen = await page.evaluate(() => (window as unknown as { __rafSeen: string[] }).__rafSeen);
  const leaks = seen.filter((s) => s.includes(extensionId) || s.includes('content-script-started'));
  expect(leaks).toEqual([]);
});
