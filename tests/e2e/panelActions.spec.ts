/// <reference types="chrome" />
// The side panel's own fills with the extension loaded: "fill this one" writes the resume's answer over a box that held
// its own, and "retry" fills again a box the page named only after the fill. ("Use as" a candidate field is covered by
// tests/unit/sidepanel/panelActions.test.tsx: no synthetic page reliably asks a box of two possible fields.)
import { expect, test } from './fixtures';
import { fillFixture, storedReport } from './helpers';

test('side panel: fill this one, and retry a box named late', async ({ context, serviceWorker, extensionId }) => {
  const { page, tabId, report } = await fillFixture(context, serviceWorker, 'questions-zh', 'zh-CN', {
    beforeFill: async (p) => {
      await p.evaluate(() => {
        document.getElementById('application')!.insertAdjacentHTML(
          'beforeend',
          `<div><label for="raf-held">意向岗位</label><input id="raf-held" value="示例岗位"></div>
           <div><label id="raf-late-label" for="raf-late">附加栏目</label><input id="raf-late"></div>`,
        );
      });
      return { snapshot: {}, readings: {}, coverage: {} };
    },
  });

  const heldRow = report.fields.find((f) => f.label === '意向岗位');
  expect(heldRow, 'the box that held its own answer').toMatchObject({ outcome: 'needs_review', note: 'answer_held' });
  const lateRow = report.fields.find((f) => f.label === '附加栏目');
  expect(lateRow?.outcome, 'the box the page had not named yet').toBe('unmatched');
  await expect(page.locator('#raf-held')).toHaveValue('示例岗位');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 460, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);

  // Fill this one: the resume's answer goes over the page's.
  const held = panel.getByRole('listitem').filter({ hasText: '意向岗位' });
  await held.locator('summary').click();
  await held.getByRole('button', { name: /填入这一格|Fill this one/ }).click();
  await expect(page.locator('#raf-held')).toHaveValue(heldRow!.value!);
  await expect.poll(async () => (await storedReport(serviceWorker, tabId))?.fields.find((f) => f.fieldId === heldRow!.fieldId)?.outcome).toBe('filled');

  // Retry: the page names the box now, and only the boxes left over are filled again.
  await page.evaluate(() => {
    document.getElementById('raf-late-label')!.textContent = '邮箱';
  });
  const filledBefore = (await storedReport(serviceWorker, tabId))!.counts.filled;
  await panel.getByRole('button', { name: /重试 \d+ 格|Retry \(\d+\)/ }).click();
  await expect.poll(async () => (await storedReport(serviceWorker, tabId))?.fields.find((f) => f.fieldId === lateRow!.fieldId)?.outcome).toBe('filled');
  await expect(page.locator('#raf-late')).toHaveValue(/@/);
  const after = (await storedReport(serviceWorker, tabId))!;
  expect(after.fields).toHaveLength(report.fields.length);
  expect(after.counts.filled).toBe(filledBefore + 1);
  await expect(page.locator('#raf-held')).toHaveValue(heldRow!.value!);
});
