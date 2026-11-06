/// <reference types="chrome" />
// One-click bilingual switches with the extension loaded: the interface language ("中 | EN" in the options header and
// the side panel toolbar) and the resume used for filling (the chip on the FAB's corner, the side panel button).
// Every open surface follows at once, and the choice is kept.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { accessibleNames, fabBox, fixtureUrl, scanTotal, setActiveResumeByLocale, storedReport, tabIdOf, waitForSeed } from './helpers';

const CHIP_ZH_EN = 'Filling with the Chinese resume. Switch to English';
const CHIP_EN_EN = 'Filling with the English resume. Switch to Chinese';
const CHIP_ZH_ZH = '填写用简历：中文版，点一下换成英文版';

async function storeUiLanguage(worker: Worker, language: 'auto' | 'zh' | 'en'): Promise<void> {
  await worker.evaluate(async (lang) => {
    const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
    profile.settings = { ...profile.settings, uiLanguage: lang };
    await chrome.storage.local.set({ profile });
  }, language);
}

const stored = (worker: Worker) =>
  worker.evaluate(async () => {
    const { profile } = (await chrome.storage.local.get('profile')) as { profile: any };
    const active = profile.resumes.find((r: { id: string }) => r.id === profile.activeResumeId);
    return { uiLanguage: profile.settings.uiLanguage as string, activeId: profile.activeResumeId as string, locale: active.locale as string };
  });

/** A fixture form with the FAB on it, once the scan has counted its fields. */
async function openForm(context: BrowserContext, worker: Worker): Promise<{ page: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(fixtureUrl('antd'));
  const tabId = await tabIdOf(worker, page.url().split('#')[0]!);
  await expect.poll(() => scanTotal(worker, tabId), { timeout: 20_000 }).toBeGreaterThan(0);
  return { page, tabId };
}

/** Box of an element in the FAB's closed shadow root, through the DevTools protocol (page scripts cannot reach it). */
async function shadowBox(page: Page, cls: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  interface Node {
    nodeId: number;
    attributes?: string[];
    children?: Node[];
    shadowRoots?: Node[];
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: Node };
    const stack: Node[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      const a = n.attributes ?? [];
      const i = a.indexOf('class');
      if (i >= 0 && a[i + 1]!.split(/\s+/).includes(cls)) {
        const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: n.nodeId })) as { model: { border: number[] } };
        const [x1, y1, , , x3, y3] = model.border;
        return { x: x1!, y: y1!, width: x3! - x1!, height: y3! - y1! };
      }
      stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []));
    }
    return null;
  } finally {
    await cdp.detach();
  }
}

test('one click on the side panel language toggle switches the options page and the FAB at once, and it is kept', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await waitForSeed(serviceWorker);
  await setActiveResumeByLocale(serviceWorker, 'zh-CN');
  await storeUiLanguage(serviceWorker, 'en');

  const { page, tabId } = await openForm(context, serviceWorker);
  await expect.poll(() => accessibleNames(page)).toContain(CHIP_ZH_EN);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole('tab', { name: 'Editor' })).toBeVisible();

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 800 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  await panel.getByRole('group', { name: 'Interface language' }).getByRole('button', { name: '中文' }).click();

  // Every surface, without a reload.
  await expect(panel.getByRole('heading', { name: '填写报告' })).toBeVisible();
  await expect(options.getByRole('tab', { name: '编辑' })).toBeVisible();
  await expect.poll(() => accessibleNames(page)).toContain(CHIP_ZH_ZH);
  expect((await stored(serviceWorker)).uiLanguage).toBe('zh');

  // Kept: a fresh options page opens in Chinese; its own toggle goes back in one click.
  await options.reload();
  await expect(options.getByRole('tab', { name: '编辑' })).toBeVisible();
  await options.getByRole('group', { name: '界面语言' }).getByRole('button', { name: 'English' }).click();
  await expect(panel.getByRole('heading', { name: 'Fill report' })).toBeVisible();
  await expect.poll(() => accessibleNames(page)).toContain(CHIP_ZH_EN);

  // The side panel toolbar keeps both rows inside a narrow panel (nothing pushed out sideways).
  const overflow = await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the chip on the FAB switches the filling resume in one click, without filling or moving the FAB', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await waitForSeed(serviceWorker);
  await setActiveResumeByLocale(serviceWorker, 'zh-CN');
  await storeUiLanguage(serviceWorker, 'en');

  const { page, tabId } = await openForm(context, serviceWorker);
  await expect.poll(() => accessibleNames(page)).toContain(CHIP_ZH_EN);
  const before = await fabBox(page);
  const chip = await shadowBox(page, 'raf-resume-chip');
  expect(chip, 'chip rendered').not.toBeNull();
  // Fully on screen, and at least a 24px target.
  expect(chip!.width).toBeGreaterThanOrEqual(24);
  expect(chip!.height).toBeGreaterThanOrEqual(24);
  expect(chip!.y).toBeGreaterThanOrEqual(0);
  expect(chip!.x + chip!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  await page.bringToFront();
  await page.mouse.click(chip!.x + chip!.width / 2, chip!.y + chip!.height / 2);

  await expect.poll(async () => (await stored(serviceWorker)).locale).toBe('en-AU');
  await expect.poll(() => accessibleNames(page)).toContain(CHIP_EN_EN);
  // The side panel's select follows.
  const activeId = (await stored(serviceWorker)).activeId;
  await expect(panel.getByLabel('Active resume')).toHaveValue(activeId);
  // No fill started, and the host box (== the FAB button) did not move or grow.
  await page.waitForTimeout(500);
  expect(await storedReport(serviceWorker, tabId)).toBeNull();
  expect(await fabBox(page)).toEqual(before);

  // And back from the side panel in one click; the chip follows.
  await panel.getByRole('button', { name: 'Switch to Chinese' }).click();
  await expect.poll(async () => (await stored(serviceWorker)).locale).toBe('zh-CN');
  await expect.poll(() => accessibleNames(page)).toContain(CHIP_ZH_EN);
});
