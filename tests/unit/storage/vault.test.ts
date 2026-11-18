import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createSampleProfile } from '../../../src/schema';
import {
  PROFILE_STORAGE_KEY,
  VAULT_META_KEY,
  VaultLockedError,
  VaultPasswordError,
  changeProfileVaultPassphrase,
  deleteResume,
  disableProfileVault,
  enableProfileVault,
  getMaterializedActiveResume,
  getVaultStatus,
  isEncryptedVaultBlob,
  loadProfile,
  lockProfileVault,
  resetVaultMemorySessionForTests,
  saveProfile,
  unlockProfileVault,
  upsertResume,
} from '../../../src/storage';

const T0 = Date.UTC(2026, 6, 1);

describe('Storage Vault (KEK/DEK encryption at rest + lazy idle timeout)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    resetVaultMemorySessionForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    resetVaultMemorySessionForTests();
    vi.useRealTimers();
  });

  it('encrypts profile in local storage, blocks reads/writes when locked, and unlocks with passphrase', async () => {
    await saveProfile(createSampleProfile());

    const status = await enableProfileVault('super-secret-pass-99', {
      iterations: 2000,
      idleTimeoutMs: 5 * 60 * 1000,
      allowFastKdfForTest: true,
    });
    expect(status.enabled).toBe(true);
    expect(status.unlocked).toBe(true);

    // Raw local storage must hold opaque ciphertext, zero plaintext names/emails.
    const rawLocal = await fakeBrowser.storage.local.get([PROFILE_STORAGE_KEY, VAULT_META_KEY]);
    expect(isEncryptedVaultBlob(rawLocal[PROFILE_STORAGE_KEY])).toBe(true);
    expect(JSON.stringify(rawLocal[PROFILE_STORAGE_KEY])).not.toContain('sample-zh');
    expect(rawLocal[VAULT_META_KEY]).toBeTruthy();

    // Locking prevents both reads and accidental plaintext overwrites.
    await lockProfileVault();
    expect((await getVaultStatus()).unlocked).toBe(false);
    await expect(loadProfile()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(upsertResume({ id: 'extra', title: 'Extra', locale: 'zh-CN' })).rejects.toBeInstanceOf(VaultLockedError);

    // Wrong passphrase rejects with typed error.
    await expect(unlockProfileVault('wrong-pass-123')).rejects.toBeInstanceOf(VaultPasswordError);

    // Correct passphrase restores full profile cleanly.
    const unlocked = await unlockProfileVault('super-secret-pass-99');
    expect(unlocked.activeResumeId).toBe('sample-zh');
    expect(unlocked.resumes).toHaveLength(2);
  });

  it('locks automatically after idle timeout without needing alarms permission', async () => {
    await saveProfile(createSampleProfile());
    await enableProfileVault('idle-pass-1234', {
      iterations: 2000,
      idleTimeoutMs: 60_000,
      allowFastKdfForTest: true,
    });

    // Touch within timeout extends session.
    vi.setSystemTime(T0 + 30_000);
    await expect(loadProfile()).resolves.toMatchObject({ activeResumeId: 'sample-zh' });

    // Exceeding idleTimeoutMs triggers locked_idle.
    vi.setSystemTime(T0 + 30_000 + 60_001);
    await expect(loadProfile()).rejects.toMatchObject({ name: 'VaultLockedError', reason: 'locked_idle' });
  });

  it('supports changing passphrase and disabling vault back to plaintext cleanly', async () => {
    const sample = createSampleProfile();
    await saveProfile(sample);
    await enableProfileVault('first-pass-8888', { iterations: 2000, allowFastKdfForTest: true });

    await changeProfileVaultPassphrase('first-pass-8888', 'second-pass-9999', {
      iterations: 2000,
      allowFastKdfForTest: true,
    });
    await lockProfileVault();
    await expect(unlockProfileVault('first-pass-8888')).rejects.toBeInstanceOf(VaultPasswordError);
    await expect(unlockProfileVault('second-pass-9999')).resolves.toMatchObject({ activeResumeId: 'sample-zh' });

    const disabled = await disableProfileVault('second-pass-9999');
    expect(disabled.activeResumeId).toBe('sample-zh');
    expect((await getVaultStatus()).enabled).toBe(false);
    const rawAfter = await fakeBrowser.storage.local.get([PROFILE_STORAGE_KEY, VAULT_META_KEY]);
    expect(isEncryptedVaultBlob(rawAfter[PROFILE_STORAGE_KEY])).toBe(false);
    expect(rawAfter[VAULT_META_KEY]).toBeUndefined();
  });

  it('materializes active variant and promotes child variant on base deletion', async () => {
    const sample = createSampleProfile();
    await saveProfile(sample);
    await upsertResume({
      id: 'child-1',
      title: 'Child Variant',
      locale: 'zh-CN',
      variantOf: 'sample-zh',
      variantMeta: { customSummary: 'Customized child summary' },
    });
    const saved = await loadProfile();
    saved.activeResumeId = 'child-1';
    await saveProfile(saved);

    const active = await getMaterializedActiveResume();
    expect(active?.selfIntroduction).toBe('Customized child summary');
    expect(active?.basics.familyName).toBe(sample.resumes[0]!.basics.familyName);

    // Deleting base resume promotes child to standalone without losing inherited basics.
    await deleteResume('sample-zh');
    const afterDelete = await getMaterializedActiveResume();
    expect(afterDelete?.variantOf).toBeUndefined();
    expect(afterDelete?.basics.familyName).toBe(sample.resumes[0]!.basics.familyName);
  });
});
