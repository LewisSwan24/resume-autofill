import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import {
  PROFILE_STORAGE_KEY,
  VAULT_META_KEY,
  VaultPasswordError,
  enableProfileVault,
  getVaultStatus,
  isEncryptedVaultBlob,
  loadProfile,
  lockProfileVault,
  resetVaultMemorySessionForTests,
  saveProfile,
  unlockProfileVault,
} from '../../../src/storage';

const WAIT = { timeout: 4000 };
const PASS = 'first-pass-8888';
const FAST = { iterations: 2000, allowFastKdfForTest: true } as const;

const makeProfile = (title = 'Resume r1'): Profile =>
  ProfileSchema.parse({
    schemaVersion: 2,
    resumes: [ResumeSchema.parse({ id: 'r1', title, locale: 'en-AU', basics: { familyName: 'Lee' } })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'en' },
  });

async function withVault(profile = makeProfile()) {
  await saveProfile(profile);
  await enableProfileVault(PASS, FAST);
}

const openTab = (name: string | RegExp) => fireEvent.click(screen.getByRole('tab', { name }));
const type = (label: string | RegExp, value: string, scope: HTMLElement = document.body) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });

beforeEach(() => {
  fakeBrowser.reset();
  resetVaultMemorySessionForTests();
  setLanguage('en');
});
afterEach(() => {
  cleanup();
  resetVaultMemorySessionForTests();
});

describe('Vault: enabling asks for the passphrase twice', () => {
  it('refuses to enable when the two entries differ', async () => {
    await saveProfile(makeProfile());
    render(<App autosaveDelayMs={5} />);
    await screen.findByRole('tab', { name: 'Editor' }, WAIT);
    openTab('Settings');
    type('Master passphrase (min 8 chars)', 'correct-horse-1');
    type('Repeat the passphrase', 'correct-horse-2');
    fireEvent.click(screen.getByRole('button', { name: 'Enable encrypted vault' }));
    expect(await screen.findByText('The two passphrases do not match.')).toBeTruthy();
    expect((await getVaultStatus()).enabled).toBe(false);
    expect(isEncryptedVaultBlob((await fakeBrowser.storage.local.get(PROFILE_STORAGE_KEY))[PROFILE_STORAGE_KEY])).toBe(false);
  });
});

describe('Vault: change passphrase', () => {
  it('changes it for real: the old passphrase stops working, the new one unlocks', async () => {
    await withVault();
    render(<App autosaveDelayMs={5} />);
    await screen.findByRole('tab', { name: 'Editor' }, WAIT);
    openTab('Settings');
    await screen.findByLabelText('Current passphrase', undefined, WAIT);
    type('Current passphrase', PASS);
    type('New passphrase (min 8 chars)', 'second-pass-9999');
    type('Repeat the new passphrase', 'second-pass-9999');
    fireEvent.click(screen.getByRole('button', { name: 'Change passphrase' }));
    expect(await screen.findByText('Passphrase changed', undefined, WAIT)).toBeTruthy();

    await lockProfileVault();
    await expect(unlockProfileVault(PASS)).rejects.toBeInstanceOf(VaultPasswordError);
    await expect(unlockProfileVault('second-pass-9999')).resolves.toMatchObject({ activeResumeId: 'r1' });
  });

  it('does not change anything when the new entries differ', async () => {
    await withVault();
    render(<App autosaveDelayMs={5} />);
    await screen.findByRole('tab', { name: 'Editor' }, WAIT);
    openTab('Settings');
    await screen.findByLabelText('Current passphrase', undefined, WAIT);
    type('Current passphrase', PASS);
    type('New passphrase (min 8 chars)', 'second-pass-9999');
    type('Repeat the new passphrase', 'second-pass-0000');
    fireEvent.click(screen.getByRole('button', { name: 'Change passphrase' }));
    expect(await screen.findByText('The two passphrases do not match.')).toBeTruthy();
    await lockProfileVault();
    await expect(unlockProfileVault(PASS)).resolves.toMatchObject({ activeResumeId: 'r1' });
  });
});

describe('Vault: locked out, restore from a backup', () => {
  it('deletes nothing without the confirmation, then restores a JSON backup after it', async () => {
    await withVault();
    await lockProfileVault();
    render(<App autosaveDelayMs={5} />);
    const forget = await screen.findByRole('button', { name: 'Forgot the passphrase? Restore from a backup' }, WAIT);

    // First the warning; "Not now" leaves everything in place.
    fireEvent.click(forget);
    const warning = await screen.findByRole('dialog');
    expect(warning.textContent).toMatch(/permanently deletes the encrypted resumes stored in this browser/);
    fireEvent.click(within(warning).getByRole('button', { name: 'Not now' }));
    let stored = await fakeBrowser.storage.local.get([PROFILE_STORAGE_KEY, VAULT_META_KEY]);
    expect(stored[VAULT_META_KEY]).toBeTruthy();
    expect(isEncryptedVaultBlob(stored[PROFILE_STORAGE_KEY])).toBe(true);

    // Confirmed: vault meta and the encrypted blob are gone, and the import is offered.
    fireEvent.click(screen.getByRole('button', { name: 'Forgot the passphrase? Restore from a backup' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete and restore from backup' }));
    const importInput = await screen.findByLabelText('Import JSON', undefined, WAIT);
    stored = await fakeBrowser.storage.local.get([PROFILE_STORAGE_KEY, VAULT_META_KEY]);
    expect(stored[VAULT_META_KEY]).toBeUndefined();
    expect(stored[PROFILE_STORAGE_KEY]).toBeUndefined();

    const backup = JSON.stringify(makeProfile('From backup'));
    fireEvent.change(importInput, { target: { files: [new File([backup], 'backup.json', { type: 'application/json' })] } });
    fireEvent.click(within(await screen.findByRole('dialog', undefined, WAIT)).getByRole('button', { name: 'Import and replace' }));
    await waitFor(async () => expect((await loadProfile()).resumes.map((r) => r.title)).toEqual(['From backup']), WAIT);
    expect((await getVaultStatus()).enabled).toBe(false);
    expect(await screen.findByRole('tab', { name: 'Editor' }, WAIT)).toBeTruthy();
  });
});

describe('Vault: edits made after the vault locked are kept', () => {
  it('an edit after an idle lock is saved once the vault is unlocked', async () => {
    await withVault();
    render(<App autosaveDelayMs={5} />);
    await screen.findByRole('tab', { name: 'Editor' }, WAIT);
    // The session key goes away (idle timeout) while the page is open.
    await lockProfileVault();
    type('Family name', 'Lin');

    const prompt = await screen.findByRole('region', { name: 'Profile Vault is Locked' }, WAIT);
    expect(prompt.textContent).toMatch(/latest changes are not saved yet/);
    // Locked means the resume is off the screen, even with an edit waiting.
    expect(screen.queryByLabelText('Family name')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Editor' })).toBeNull();
    type('Master passphrase (min 8 chars)', PASS, prompt);
    fireEvent.click(within(prompt).getByRole('button', { name: 'Unlock vault' }));

    await waitFor(async () => expect((await loadProfile()).resumes[0]?.basics.familyName).toBe('Lin'), WAIT);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Profile Vault is Locked' })).toBeNull(), WAIT);
    expect((screen.getByLabelText('Family name') as HTMLInputElement).value).toBe('Lin');
  });

  it('"Lock now" takes the resume off the screen until the vault is unlocked', async () => {
    await withVault(makeProfile('Secret title'));
    render(<App autosaveDelayMs={5} />);
    await screen.findByRole('tab', { name: 'Editor' }, WAIT);
    openTab('Settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Lock now' }, WAIT));
    const prompt = await screen.findByRole('region', { name: 'Profile Vault is Locked' }, WAIT);

    expect(screen.queryByRole('tab', { name: 'Editor' })).toBeNull();
    expect(screen.queryByDisplayValue('Lee')).toBeNull();
    expect(document.body.textContent).not.toContain('Secret title');
    expect(prompt.textContent).not.toMatch(/latest changes are not saved yet/);

    type('Master passphrase (min 8 chars)', PASS, prompt);
    fireEvent.click(within(prompt).getByRole('button', { name: 'Unlock vault' }));
    await screen.findByRole('tab', { name: 'Editor' }, WAIT);
    openTab('Editor');
    expect((await screen.findByLabelText('Family name', undefined, WAIT) as HTMLInputElement).value).toBe('Lee');
  });
});
