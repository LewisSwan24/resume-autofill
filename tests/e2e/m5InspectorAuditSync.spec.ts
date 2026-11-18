/// <reference types="chrome" />
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { fabBox, fixtureUrl, tabIdOf, waitForSeed } from './helpers';

test('M5 E2E: Inspector pick & record, Options 5D Audit + Funnel SVG, and .raf v3 Delta round-trip', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await waitForSeed(serviceWorker);

  // 1. Point-and-Record Visual Field Inspector from SidePanel to Content Page
  const page = await context.newPage();
  await page.goto(fixtureUrl('native'));
  await fabBox(page);
  const tabId = await tabIdOf(serviceWorker, fixtureUrl('native'));

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 860 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);

  const pickBtn = panel.getByRole('button', { name: /Pick field|点选学习字段/ });
  await expect(pickBtn).toBeVisible();
  await pickBtn.click();

  await page.bringToFront();
  const targetInput = page.locator('input[type="email"], input[type="text"]').first();
  const beforeStyle = await targetInput.getAttribute('style');
  const box = await targetInput.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  expect(await targetInput.getAttribute('style')).toBe(beforeStyle);

  await panel.bringToFront();
  await expect(panel.getByText(/Captured:|已捕获字段/)).toBeVisible();
  await panel.getByLabel(/Resume field key|映射简历字段 Key/).selectOption('contact.linkedin');
  await panel.getByRole('button', { name: /Save site rule|保存站点规则/ }).click();

  await expect
    .poll(async () => {
      const { profile } = (await serviceWorker.evaluate(() => chrome.storage.local.get('profile'))) as {
        profile?: { recipes?: Array<{ rules?: Array<{ fieldKey?: string }> }> };
      };
      return profile?.recipes?.some((r) => r.rules?.some((ru) => ru.fieldKey === 'contact.linkedin')) ?? false;
    })
    .toBe(true);

  await panel.close();
  await page.close();

  // 2. Options: 5-Dimension Audit Jump, SVG Funnel Analytics, and .raf v3 Delta Sync round-trip
  // Clear email on active resume so Audit card reliably surfaces an actionable Jump-Fix item, and seed 1 tracker row.
  await serviceWorker.evaluate(async () => {
    const res = (await chrome.storage.local.get('profile')) as { profile?: any };
    const profile = res.profile;
    const active = profile.resumes.find((r: any) => r.id === profile.activeResumeId) ?? profile.resumes[0];
    if (active) active.contact.email = '';
    const oldTs = Date.now() - 16 * 86_400_000;
    await chrome.storage.local.set({
      profile,
      extensionTracker: [
        {
          id: 'app-e2e-1',
          url: 'https://careers.example.test/job/9',
          host: 'careers.example.test',
          company: 'Acme Cloud',
          companyGuessed: false,
          position: 'Platform Engineer',
          status: 'interview',
          outcome: 'pending',
          variantId: active?.id,
          variantTitle: active?.title,
          statusAt: oldTs,
          remind: false,
          notes: '',
          createdAt: oldTs,
          openedAt: oldTs,
          updatedAt: oldTs,
          history: [],
        },
      ],
    });
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const auditRegion = options.getByRole('region', { name: /5-Dimension ATS Resume Audit|简历 ATS 健康度 5 维体检/ });
  await expect(auditRegion).toBeVisible();
  const fixBtns = auditRegion.getByRole('button', { name: /Fix now|去完善/ });
  expect(await fixBtns.count()).toBeGreaterThan(0);
  await fixBtns.first().click();

  // Switch to Applications tab: SVG Funnel + Stale >14 days + Outcome selector
  await options.getByRole('tab', { name: /Applications|投递记录/ }).click();
  await expect(options.getByRole('img', { name: /Offline Funnel & Variant|离线投递漏斗/ })).toBeVisible();
  await expect(options.getByText(/Stale >14 days|超 14 天未推进/)).toBeVisible();
  await options.getByLabel(/Outcome|投递结果/).selectOption('offer');

  await expect
    .poll(async () => {
      const { extensionTracker } = (await serviceWorker.evaluate(() => chrome.storage.local.get('extensionTracker'))) as {
        extensionTracker?: Array<{ outcome?: string }>;
      };
      return extensionTracker?.[0]?.outcome;
    })
    .toBe('offer');

  // Switch to Data & Sync: enable .raf v3 Delta mode -> Export -> Import back & verify delta badge
  await options.getByRole('tab', { name: /Import \/ Export|导入 \/ 导出/ }).click();
  await options.getByLabel(/\.raf v3 delta|启用 \.raf v3 增量容器/).check();
  const pwInput = options.getByLabel(/Encryption passphrase|加密口令/).first();
  await pwInput.fill('m5-e2e-delta-pass');

  const [download] = await Promise.all([
    options.waitForEvent('download'),
    options.getByRole('button', { name: /Export encrypted \.raf|导出加密 \.raf/ }).click(),
  ]);
  const dlPath = await download.path();
  expect(dlPath).toBeTruthy();
  const rafBytes = await readFile(dlPath!);

  const importInput = options.locator('input[type="file"][accept*=".raf"]');
  await importInput.setInputFiles({
    name: 'backup.raf',
    mimeType: 'application/octet-stream',
    buffer: rafBytes,
  });

  const unlockPw = options.getByLabel(/Encryption passphrase|加密口令/).last();
  await unlockPw.fill('m5-e2e-delta-pass');
  await options.getByRole('button', { name: /^Unlock$|^解锁$/ }).click();
  await expect(options.getByText(/\.raf v3 delta|\.raf v3 增量包/)).toBeVisible();
  await options.close();
});
