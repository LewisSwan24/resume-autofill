/// <reference types="chrome" />
// Visual capture for design review: `pnpm visual` writes light + dark PNGs of the FAB / summary card, the side panel
// and the options page to docs/reviews/ui-screenshots/ (gitignored local output). Not an assertion suite: it only
// fails when a surface cannot be reached.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from '../e2e/fixtures';
import {
  accessibleNames,
  fabBox,
  fabPoint,
  fillFixture,
  fixtureUrl,
  scanTotal,
  setActiveResumeByLocale,
  tabIdOf,
  waitForSeed,
} from '../e2e/helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs', 'reviews', 'ui-screenshots');
const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

/** Colour transitions are 120 ms: let them finish before every capture. */
const SETTLE_MS = 400;
/** `--raf-size-card-width` is 320 px, the card is at most 70vh tall and sits 8 px above the button. */
const CARD_WIDTH = 340;
const CARD_MAX_HEIGHT_RATIO = 0.7;

/**
 * Review tooling (multi-image model requests) rejects images whose long edge exceeds ~3000 px, so every PNG we write
 * keeps its long edge ≤ 1800 px: viewport shots are 1280 px wide at most, and full-page captures are cut into
 * ≤ SEGMENT_HEIGHT slices (`<name>-1.png`, `<name>-2.png`, …).
 */
const SEGMENT_HEIGHT = 1200;

mkdirSync(OUT, { recursive: true });
const out = (name: string): string => path.join(OUT, name);

async function fullPageInSegments(page: Page, name: string): Promise<void> {
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
  }));
  for (let i = 0, y = 0; y < height; i += 1, y += SEGMENT_HEIGHT) {
    const clip = { x: 0, y, width, height: Math.min(SEGMENT_HEIGHT, height - y) };
    await page.screenshot({ path: out(`${name}-${i + 1}.png`), fullPage: true, clip });
  }
}

/** Every page the context opens from now on starts with the requested colour scheme (set before its first navigation). */
function forceScheme(context: BrowserContext, scheme: Scheme): void {
  for (const page of context.pages()) void page.emulateMedia({ colorScheme: scheme });
  context.on('page', (page) => void page.emulateMedia({ colorScheme: scheme }));
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
}

/** Open a page of the extension (or anything else) in the scheme at the given viewport and wait for it to settle. */
async function openPage(context: BrowserContext, scheme: Scheme, url: string, size: { width: number; height: number }): Promise<Page> {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(size);
  await page.goto(url);
  return page;
}

/** Region of the FAB corner: host box expanded upwards by the card's max height and left to the card width. */
async function fabClip(page: Page, withCard: boolean): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await fabBox(page);
  const vp = page.viewportSize() ?? { width: 1280, height: 900 };
  const pad = 16;
  const right = Math.min(vp.width, box.x + box.width + pad);
  const bottom = Math.min(vp.height, box.y + box.height + pad);
  const left = withCard ? Math.max(0, box.x + box.width - CARD_WIDTH - pad) : Math.max(0, box.x - pad);
  const top = withCard ? Math.max(0, box.y - vp.height * CARD_MAX_HEIGHT_RATIO - 8 - pad) : Math.max(0, box.y - pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Wait until the closed-shadow card is in the accessibility tree (role=dialog named after the card title). */
async function waitForCard(page: Page): Promise<void> {
  await expect
    .poll(async () => (await accessibleNames(page)).some((n) => /^(Autofill result|填写结果)$/.test(n)), {
      message: 'summary card open',
      timeout: 15_000,
    })
    .toBe(true);
}

/** The FAB with its detected count, before any fill: the page is opened by us, so it never gets clicked. */
async function openIdleFab(context: BrowserContext, worker: Worker, scheme: Scheme, name: string, locale: string): Promise<Page> {
  await waitForSeed(worker);
  await setActiveResumeByLocale(worker, locale);
  const url = fixtureUrl(name);
  const page = await openPage(context, scheme, url, { width: 1280, height: 900 });
  const tabId = await tabIdOf(worker, url);
  await expect.poll(() => scanTotal(worker, tabId), { message: 'fields detected', timeout: 20_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await accessibleNames(page)).some((n) => /^\d+ fields? detected$|^识别到 \d+ 个字段$/.test(n)), {
      message: 'FAB shows the count',
      timeout: 20_000,
    })
    .toBe(true);
  return page;
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} scheme`, () => {
    test(`FAB and summary card (${scheme})`, async ({ context, serviceWorker }) => {
      forceScheme(context, scheme);

      // Idle FAB on the antd fixture (zh resume), then close that page so the filled run owns the tab.
      const idle = await openIdleFab(context, serviceWorker, scheme, 'antd', 'zh-CN');
      await idle.mouse.move(5, 5); // keep the button out of its hover state
      await settle(idle);
      await idle.screenshot({ path: out(`fab-idle-${scheme}.png`), clip: await fabClip(idle, false) });
      await idle.close();

      // antd: fill, card open.
      const antd = await fillFixture(context, serviceWorker, 'antd', 'zh-CN');
      await antd.page.emulateMedia({ colorScheme: scheme });
      await antd.page.setViewportSize({ width: 1280, height: 900 });
      await waitForCard(antd.page);
      await antd.page.mouse.move(5, 5);
      await settle(antd.page);
      await antd.page.screenshot({ path: out(`fab-card-antd-${scheme}.png`), clip: await fabClip(antd.page, true) });
      await antd.page.screenshot({ path: out(`page-antd-filled-${scheme}.png`) });
      // One group of rows opened, and its first row pointed at.
      for (const group of ['nodata', 'review', 'no_option', 'failed']) {
        const head = await fabPoint(antd.page, `raf-group-head-${group}`);
        if (!head) continue;
        await antd.page.mouse.click(head.x, head.y);
        const row = await fabPoint(antd.page, 'raf-item');
        if (row) await antd.page.mouse.click(row.x - 40, row.y);
        break;
      }
      await antd.page.mouse.move(5, 5);
      await settle(antd.page);
      await antd.page.screenshot({ path: out(`fab-card-antd-open-${scheme}.png`), clip: await fabClip(antd.page, true) });
      await antd.page.close();

      // native fixture card.
      const native = await fillFixture(context, serviceWorker, 'native', 'zh-CN');
      await native.page.emulateMedia({ colorScheme: scheme });
      await native.page.setViewportSize({ width: 1280, height: 900 });
      await waitForCard(native.page);
      await native.page.mouse.move(5, 5);
      await settle(native.page);
      await native.page.screenshot({ path: out(`fab-card-native-${scheme}.png`), clip: await fabClip(native.page, true) });
    });

    test(`side panel (${scheme})`, async ({ context, serviceWorker, extensionId }) => {
      forceScheme(context, scheme);
      const { tabId, page: fixturePage } = await fillFixture(context, serviceWorker, 'antd', 'zh-CN');
      const base = `chrome-extension://${extensionId}/sidepanel.html`;

      const panel = await openPage(context, scheme, `${base}?tabId=${tabId}`, { width: 400, height: 900 });
      const rows = panel.getByRole('listitem');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThan(20);
      await panel.mouse.move(399, 899);
      await settle(panel);
      await panel.screenshot({ path: out(`sidepanel-${scheme}.png`) });

      // One row that asks for attention (needs_review, else no_option) opened.
      const attention = panel.locator('details.raf-item[data-outcome="needs_review"], details.raf-item[data-outcome="no_option"]');
      await expect(attention.first()).toBeVisible();
      await attention.first().locator('summary').click();
      await expect(attention.first()).toHaveJSProperty('open', true);
      await attention.first().scrollIntoViewIfNeeded();
      await panel.mouse.move(399, 899);
      await settle(panel);
      await panel.screenshot({ path: out(`sidepanel-expanded-${scheme}.png`) });
      await fullPageInSegments(panel, `sidepanel-full-${scheme}`);

      // Empty state: a tab that never had a report.
      const empty = await openPage(context, scheme, `${base}?tabId=999999`, { width: 400, height: 900 });
      await expect(empty.locator('.raf-list')).toHaveCount(0);
      await expect(empty.getByText(/Nothing here yet|这里还空着/)).toBeVisible();
      await settle(empty);
      await empty.screenshot({ path: out(`sidepanel-empty-${scheme}.png`) });
      await fixturePage.close();
    });

    test(`options page (${scheme})`, async ({ context, serviceWorker, extensionId }) => {
      forceScheme(context, scheme);
      await waitForSeed(serviceWorker);
      const url = `chrome-extension://${extensionId}/options.html`;

      const page = await openPage(context, scheme, url, { width: 1280, height: 900 });
      await expect(page.locator('#root')).toContainText('林知远');
      const education = page.getByRole('button', { name: /Education|教育经历/ });
      await expect(education).toBeVisible();
      if ((await education.getAttribute('aria-expanded')) !== 'true') await education.click();
      await expect(education).toHaveAttribute('aria-expanded', 'true');
      // Page top (header, tabs, resume list, default-open sections), then Education scrolled to the top edge.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(1279, 899);
      await settle(page);
      await page.screenshot({ path: out(`options-editor-top-${scheme}.png`) });
      await education.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 24));
      await page.mouse.move(1279, 899);
      await settle(page);
      await page.screenshot({ path: out(`options-editor-${scheme}.png`) });

      await page.getByRole('tab', { name: /Attachments|附件/ }).click();
      await expect(page.getByRole('region', { name: /Attachments|附件/ }).or(page.locator('section.raf-card').first())).toBeVisible();
      await page.mouse.move(1279, 899);
      await settle(page);
      await page.screenshot({ path: out(`options-attachments-${scheme}.png`) });

      await page.getByRole('tab', { name: /Settings|设置/ }).click();
      await expect(page.getByRole('heading', { name: /Settings|设置/ })).toBeVisible();
      await page.mouse.move(1279, 899);
      await settle(page);
      await page.screenshot({ path: out(`options-settings-${scheme}.png`) });

      // Narrow window, back on the editor tab.
      await page.getByRole('tab', { name: /Editor|编辑/ }).click();
      await page.setViewportSize({ width: 420, height: 900 });
      await expect(page.getByRole('tab', { name: /Editor|编辑/ })).toHaveAttribute('aria-selected', 'true');
      await page.mouse.move(419, 899);
      await settle(page);
      await page.screenshot({ path: out(`options-narrow-${scheme}.png`) });
    });
  });
}
