/// <reference types="chrome" />
// Auto-advance through multi-step applications, end to end: fill the first step with the FAB, press "Advance to
// the last page" in its card, and check where it stopped, that each step was filled, and that no send button
// was ever pressed (the fixture pages count every press in sessionStorage under `wizard.sent`).
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { FIXTURE_ORIGIN, accessibleNames, fabPoint, fillFixture } from './helpers';
import type { WizardSessionState } from '../../src/background/wizardSession';

const wizardOf = (worker: Worker, tabId: number): Promise<WizardSessionState | null> =>
  worker.evaluate(async (id) => {
    const key = `wizard:${id}`;
    return ((await chrome.storage.session.get(key))[key] as WizardSessionState | undefined) ?? null;
  }, tabId);

async function startAdvance(page: Page): Promise<void> {
  let point: { x: number; y: number } | null = null;
  await expect.poll(async () => (point = await fabPoint(page, 'raf-advance-start')) !== null, { timeout: 15_000 }).toBe(true);
  await page.mouse.click(point!.x, point!.y);
}

const sends = (page: Page) => page.evaluate(() => sessionStorage.getItem('wizard.sent'));

test('advances through a form that loads a new page per step and stops at the send page without pressing it', async ({
  context,
  serviceWorker,
}) => {
  const { page, tabId, report } = await fillFixture(context, serviceWorker, 'wizard', 'en-AU', {
    url: `${FIXTURE_ORIGIN}/wizard/step-1.html`,
  });
  expect(report.counts.filled, 'step 1 filled by the FAB').toBeGreaterThan(0);
  await startAdvance(page);

  await expect
    .poll(async () => (await wizardOf(serviceWorker, tabId))?.advance, { timeout: 60_000 })
    .toEqual({ running: false, steps: 2, stopReason: 'final_step' });
  expect(page.url()).toMatch(/\/wizard\/step-3\.html$/);
  expect(await page.evaluate(() => sessionStorage.getItem('wizard.email')), 'step 2 was filled before Next').toBeTruthy();
  expect(await page.locator('#email-again').inputValue(), 'step 3 was filled').not.toBe('');
  expect(await sends(page), 'the send button was never pressed').toBeNull();

  // The FAB on the last page says why it stopped.
  await expect
    .poll(async () => (await accessibleNames(page)).some((n) => /This is the last page/.test(n)), { timeout: 15_000 })
    .toBe(true);
});

test('advances a single-page form and stops at a step that needs the user', async ({ context, serviceWorker }) => {
  const { page, tabId } = await fillFixture(context, serviceWorker, 'wizard', 'en-AU', {
    url: `${FIXTURE_ORIGIN}/wizard/spa.html`,
  });
  await startAdvance(page);

  await expect
    .poll(async () => (await wizardOf(serviceWorker, tabId))?.advance, { timeout: 60_000 })
    .toEqual({ running: false, steps: 1, stopReason: 'needs_you' });
  await expect(page.locator('section[data-step="2"]')).toBeVisible();
  await expect(page.locator('section[data-step="3"]')).toBeHidden();
  expect(await page.locator('input[name="confirm_true"]').isChecked(), 'a declaration is never ticked for the user').toBe(false);
  expect(await sends(page)).toBeNull();
});

test("on a step with nothing to fill, the card does not show the last step's numbers", async ({ context, serviceWorker }) => {
  const { page, tabId } = await fillFixture(context, serviceWorker, 'wizard', 'en-AU', {
    url: `${FIXTURE_ORIGIN}/wizard/spa-questions.html`,
  });
  await startAdvance(page);

  await expect
    .poll(async () => (await wizardOf(serviceWorker, tabId))?.advance, { timeout: 60_000 })
    .toEqual({ running: false, steps: 1, stopReason: 'needs_you' });
  await expect(page.locator('section[data-step="2"]')).toBeVisible();
  await expect
    .poll(async () => (await accessibleNames(page)).some((n) => /Nothing on this page could be filled from your resume/.test(n)), { timeout: 15_000 })
    .toBe(true);
  const names = await accessibleNames(page);
  expect(names.some((n) => /This page needs you/.test(n)), 'says why it stopped').toBe(true);
  expect(names.some((n) => /\d+ filled/.test(n)), "step 1's numbers are gone").toBe(false);
  expect(await sends(page)).toBeNull();
});

test('advances a form whose steps sit in an iframe, pressing Next inside it', async ({ context, serviceWorker }) => {
  const { page, tabId } = await fillFixture(context, serviceWorker, 'wizard', 'en-AU', {
    url: `${FIXTURE_ORIGIN}/wizard/framed.html`,
  });
  const form = page.frameLocator('iframe[title="Application form"]');
  await expect(form.locator('#s-first')).not.toHaveValue('');
  await startAdvance(page);

  await expect
    .poll(async () => (await wizardOf(serviceWorker, tabId))?.advance, { timeout: 60_000 })
    .toEqual({ running: false, steps: 1, stopReason: 'needs_you' });
  await expect(form.locator('section[data-step="2"]')).toBeVisible();
  await expect(form.locator('#s-phone'), 'step 2 was filled').not.toHaveValue('');
  expect(await form.locator('input[name="confirm_true"]').isChecked()).toBe(false);
  expect(await sends(page)).toBeNull();
});

test('advances a form drawn in an open shadow root', async ({ context, serviceWorker }) => {
  const { page, tabId } = await fillFixture(context, serviceWorker, 'wizard', 'en-AU', {
    url: `${FIXTURE_ORIGIN}/wizard/shadow.html`,
  });
  await expect(page.locator('#s-first')).not.toHaveValue('');
  await startAdvance(page);

  await expect
    .poll(async () => (await wizardOf(serviceWorker, tabId))?.advance, { timeout: 60_000 })
    .toEqual({ running: false, steps: 1, stopReason: 'needs_you' });
  // Playwright's CSS locators pierce open shadow roots.
  await expect(page.locator('section[data-step="2"]')).toBeVisible();
  await expect(page.locator('#s-phone'), 'step 2 was filled').not.toHaveValue('');
  expect(await sends(page)).toBeNull();
});
