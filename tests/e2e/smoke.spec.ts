import { expect, test } from './fixtures';

test('service worker starts', async ({ serviceWorker, extensionId }) => {
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\//);
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

for (const pageName of ['options', 'sidepanel']) {
  test(`${pageName}.html loads without console errors`, async ({ context, extensionId }) => {
    const errors: string[] = [];
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`chrome-extension://${extensionId}/${pageName}.html`);
    await page.waitForLoadState('load');
    // The React app must actually mount, not just the empty shell.
    await expect(page.locator('#root')).not.toBeEmpty();

    expect(errors).toEqual([]);
  });
}
