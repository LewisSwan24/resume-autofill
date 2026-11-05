/// <reference types="chrome" />
// Reading a resume file in the real extension: the parsers, their worker and the font tables all load from the package.
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { RESULTS_DIR, fillFixture, waitForSeed } from './helpers';

const sample = (name: string): string => path.resolve('fixtures', 'resume-samples', name);

/** Everything the extension asks the network for from now on. */
function watchRequests(context: BrowserContext): string[] {
  const out: string[] = [];
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) out.push(request.url());
  });
  return out;
}

const stored = (worker: Worker): Promise<string> =>
  worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get('profile')));

async function openOptions(context: BrowserContext, worker: Worker, extensionId: string): Promise<Page> {
  await waitForSeed(worker);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('input[type=file][accept*=".pdf"]').first()).toBeAttached();
  return page;
}

const upload = (page: Page, name: string): Promise<void> => page.locator('.raf-upload-resume input[type=file]').setInputFiles(sample(name));
const row = (page: Page, field: string) => page.locator(`[data-path="${field}"]`).locator('input, textarea, select');

test('a PDF with Chinese text reads, and cancelling leaves nothing behind', async ({ context, serviceWorker, extensionId }) => {
  const requests = watchRequests(context);
  const page = await openOptions(context, serviceWorker, extensionId);
  const before = await stored(serviceWorker);

  await upload(page, 'zh-single.pdf');
  await expect(row(page, 'basics.givenName')).toHaveValue('知远', { timeout: 60_000 });
  await expect(row(page, 'contact.email')).toHaveValue('zhiyuan.lin@example.com');
  await expect(page.locator('.raf-review__lines')).toContainText('华东示例大学');
  await expect(page.locator('.raf-review__field.is-check').first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(RESULTS_DIR, 'import-review.png') });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.screenshot({ path: path.join(RESULTS_DIR, 'import-review-narrow.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone width').toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(RESULTS_DIR, 'import-review-dark.png') });
  expect(await stored(serviceWorker)).toBe(before);

  await page.locator('.raf-review').getByRole('button', { name: /取消|Cancel/ }).click();
  await expect(page.locator('.raf-review')).toHaveCount(0);
  expect(await stored(serviceWorker)).toBe(before);
  expect(requests).toEqual([]);
});

test('a file checked and saved becomes the resume that fills a form', async ({ context, serviceWorker, extensionId }) => {
  const requests = watchRequests(context);
  const page = await openOptions(context, serviceWorker, extensionId);
  await upload(page, 'en-two-columns.pdf');
  await expect(row(page, 'contact.email')).toHaveValue('mia.harper@example.com', { timeout: 60_000 });
  // What is changed on this page is what gets stored.
  await row(page, 'contact.email').fill('mia.checked@example.com');
  await page.locator('.raf-review').getByRole('button', { name: /保存为新简历|Save as a new resume/ }).click();
  await expect(page.locator('.raf-review')).toHaveCount(0);
  expect(requests, 'nothing was asked of the network before the form').toEqual([]);

  const saved = await serviceWorker.evaluate(async () => {
    const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
    const active = profile.resumes.find((r: { id: string }) => r.id === profile.activeResumeId);
    return { count: profile.resumes.length, email: active.contact.email, file: active.attachments.resumeFileId, title: active.title };
  });
  expect(saved.count).toBe(3);
  expect(saved.email).toBe('mia.checked@example.com');
  expect(saved.file).toBeTruthy();
  expect(saved.title).toBe('en-two-columns');

  const { page: form } = await fillFixture(context, serviceWorker, 'native', '', { keepActive: true });
  await expect(form.locator('input[name="contact_email"]')).toHaveValue('mia.checked@example.com');
});

test('a Word file reads too', async ({ context, serviceWorker, extensionId }) => {
  const requests = watchRequests(context);
  const page = await openOptions(context, serviceWorker, extensionId);
  await upload(page, 'zh-table.docx');
  await expect(page.locator('.raf-review__lines li').first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('[data-path]').count()).toBeGreaterThan(5);
  expect(requests).toEqual([]);
});

for (const [name, message] of [
  ['encrypted.pdf', /密码|password/],
  ['image-only.pdf', /没有可读的文字|no text/],
  ['old-format.doc', /.docx/],
] as const) {
  test(`${name} says why it cannot be read and stores nothing`, async ({ context, serviceWorker, extensionId }) => {
    const page = await openOptions(context, serviceWorker, extensionId);
    const before = await stored(serviceWorker);
    await upload(page, name);
    await expect(page.locator('.raf-notice--danger')).toContainText(message, { timeout: 60_000 });
    expect(await stored(serviceWorker)).toBe(before);
  });
}
