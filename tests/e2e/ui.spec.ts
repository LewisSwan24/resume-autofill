/// <reference types="chrome" />
// UI regression with the extension loaded: side panel (after a real fill) and options page.
import path from 'node:path';
import { expect, test } from './fixtures';
import { RESULTS_DIR, fillFixture, waitForSeed } from './helpers';

test('side panel lists the report rows of the filled antd fixture', async ({ context, serviceWorker, extensionId }) => {
  const { tabId } = await fillFixture(context, serviceWorker, 'antd', 'zh-CN');

  // `?tabId=` is the test override: a normal page has no "active tab" of its own.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 460, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);

  const rows = panel.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(20);
  // Some filled rows with a Filled chip, in either UI language.
  const filled = panel.locator('tbody tr', { hasText: /已填写|Filled/ });
  expect(await filled.count()).toBeGreaterThan(10);
  // The foreign-language row is reported with "no option".
  const foreign = panel.locator('tbody tr', { hasText: '外语语种' });
  await expect(foreign).toHaveCount(1);
  await expect(foreign).toContainText(/无选项|No option/);

  await panel.screenshot({ path: path.join(RESULTS_DIR, 'sidepanel-antd.png'), fullPage: true });
});

test('options page lists the sample resumes and persists an edit', async ({ context, serviceWorker, extensionId }) => {
  await waitForSeed(serviceWorker);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  const list = page.locator('#root');
  await expect(list).toContainText('林知远');
  const titles = await serviceWorker.evaluate(async () => {
    const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
    return (profile.resumes as Array<{ id: string; title: string }>).map((r) => r.title);
  });
  expect(titles).toHaveLength(2);
  for (const title of titles) await expect(list).toContainText(title);

  // Edit 微信号 of the active (zh) resume; it lives on the Contact tab.
  await page.getByRole('tab', { name: /^(Contact|联系方式)/ }).click();
  const wechat = page.getByLabel(/微信号|WeChat/).first();
  await expect(wechat).toBeVisible();
  await wechat.fill('e2e_wechat_42');
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async () => {
          const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
          const active = profile.resumes.find((r: { id: string }) => r.id === profile.activeResumeId);
          return active?.contact?.wechat ?? null;
        }),
      { message: '微信号 persisted to chrome.storage.local', timeout: 10_000 },
    )
    .toBe('e2e_wechat_42');

  await page.screenshot({ path: path.join(RESULTS_DIR, 'options.png'), fullPage: true });
});




