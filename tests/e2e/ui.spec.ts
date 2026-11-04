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

  // One ListItem per field (`<ul role="list">` > `<li>`; the status badge sits in the collapsed `<details>` body).
  const rows = panel.getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(20);
  // Some filled rows with the status word "Filled", in either UI language.
  const filled = rows.filter({ hasText: /已填写|Filled/ });
  expect(await filled.count()).toBeGreaterThan(10);
  // The foreign-language row is reported with "no matching option" (status vocabulary, DESIGN-SYSTEM §6.3).
  const foreign = rows.filter({ hasText: '外语语种' });
  await expect(foreign).toHaveCount(1);
  await expect(foreign).toContainText(/没有匹配的选项|No matching option/);
  // That status word is on the collapsed row itself (outlined badge), and the row has no confidence badge.
  await expect(foreign.locator('summary .raf-badge[data-outcome="no_option"]')).toContainText(/没有匹配的选项|No matching option/);
  expect(await foreign.locator('summary .raf-badge-confidence').count()).toBe(0);
  // No collapsed row leaks an internal resume path (`basics.familyName+givenName`, `education[0].school`, ...).
  const leaked = await panel.locator('.raf-item-head').evaluateAll((heads) =>
    heads.map((h) => h.textContent ?? '').filter((text) => /\b(basics|contact|education|work|languages|projects)[.[]/.test(text)),
  );
  expect(leaked).toEqual([]);
  // Filter chips are grouped by tone and stay on one row (no wrapping).
  const chips = panel.getByRole('group', { name: /Filter by status|按状态筛选/ }).getByRole('button');
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
  const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);

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

  // Edit 微信号 of the active (zh) resume; Contact is an accordion section that starts open (no tab any more).
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




