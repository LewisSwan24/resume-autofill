/// <reference types="chrome" />
import { expect, test } from './fixtures';
import { waitForSeed } from './helpers';

test('M4 E2E: Options creates derived Variant from JD Tailor and Storage Vault encrypts/locks/unlocks local profile', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await waitForSeed(serviceWorker);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  // 1. Open JD Tailor & Recipes tab and create a derived non-destructive Variant
  const tailorTab = page.getByRole('tab', { name: /JD Tailor|JD 剪裁/ });
  await expect(tailorTab).toBeVisible();
  await tailorTab.click();

  const jdBox = page.getByRole('textbox').first();
  await jdBox.fill('Backend Systems Engineer\nRequired: TypeScript, Rust, SQL');
  await page.getByRole('button', { name: /Analyze JD|运行离线 JD/ }).click();
  await expect(page.getByText(/Offline match score|离线匹配度/)).toBeVisible();

  await page.getByRole('button', { name: /Save as derived|保存为当前简历的派生变体/ }).click();

  // Switch back to Editor and verify the newly active Variant badge shows up
  await page.getByRole('tab', { name: /Editor|编辑/ }).click();
  await expect(page.getByText(/Derived variant|派生变体/)).toBeVisible();

  // 2. Enable Storage Vault, lock, verify ciphertext in chrome.storage.local & unlock UI
  await page.getByRole('tab', { name: /Settings|设置/ }).click();
  const vaultPassInput = page.getByLabel(/Master passphrase|主口令/);
  await vaultPassInput.fill('e2e-vault-pass-2026');
  await page.getByRole('button', { name: /Enable encrypted vault|开启静态加密保险箱/ }).click();

  await expect(page.getByText(/Unlocked|已解锁/).first()).toBeVisible();

  // Verify raw chrome.storage.local stores opaque AES-GCM vault blob rather than plaintext resumes
  const storedRaw = await serviceWorker.evaluate(async () => {
    const res = await chrome.storage.local.get(['profile', 'vault_meta']);
    return res;
  });
  expect(storedRaw.vault_meta).toBeTruthy();
  expect((storedRaw.profile as { __rafVault?: number })?.__rafVault).toBe(1);
  expect(JSON.stringify(storedRaw.profile)).not.toContain('sample-zh');

  // Lock now -> reload options -> unlock screen appears -> unlock restores profile
  await page.getByRole('button', { name: /Lock now|立即锁定/ }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Locked|已锁定/ })).toBeVisible();

  await page.getByLabel(/Master passphrase|主口令/).fill('e2e-vault-pass-2026');
  await page.getByRole('button', { name: /Unlock vault|解锁保险箱/ }).click();
  await expect(page.getByRole('tab', { name: /Editor|编辑/ })).toBeVisible();
});
