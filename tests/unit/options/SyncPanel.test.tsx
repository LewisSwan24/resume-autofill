import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { createSampleProfile } from '../../../src/schema';
import { loadProfile, putFile, resetFileStoreForTests, saveProfile } from '../../../src/storage';
import { buildRafArchive } from '../../../src/sync';

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  const profile = createSampleProfile();
  profile.settings.uiLanguage = 'en';
  await saveProfile(profile);
});

afterEach(() => {
  cleanup();
});

describe('Options page – encrypted .raf sync & merge preview', () => {
  it('unlocks a `.raf` archive with passphrase, shows diff badges, and merges attachments & resumes', async () => {
    render(<App autosaveDelayMs={20} />);
    await screen.findByRole('tab', { name: 'Import / Export' });
    fireEvent.click(screen.getByRole('tab', { name: 'Import / Export' }));

    const incoming = createSampleProfile();
    incoming.resumes[1]!.updatedAt = Date.now() + 60_000;
    incoming.resumes[1]!.title = 'Synced EN Version';
    incoming.resumes[1]!.attachments.resumeFileId = 'remote-pdf';

    await putFile({
      id: 'local-seed',
      name: 'seed.pdf',
      type: 'application/pdf',
      blob: new Blob(['seed']),
    });

    const rafBytes = await buildRafArchive({
      profile: incoming,
      mode: 'full',
      password: 'ext-sync-password',
      attachments: [
        {
          id: 'remote-pdf',
          name: 'en-cv.pdf',
          type: 'application/pdf',
          bytes: new TextEncoder().encode('%PDF-1.4 remote bytes'),
        },
      ],
    });

    const input = screen.getByLabelText('Import .raf / encrypted');
    fireEvent.change(input, {
      target: { files: [new File([rafBytes], 'backup.raf', { type: 'application/octet-stream' })] },
    });

    await screen.findByText('Unlock encrypted sync package', undefined, { timeout: 5000 });
    const passInputs = screen.getAllByLabelText(/Encryption passphrase/);
    fireEvent.change(passInputs[passInputs.length - 1]!, { target: { value: 'ext-sync-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByRole('region', { name: 'Sync merge preview' }, { timeout: 5000 });
    expect(screen.getByText('Incoming newer')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
    await waitFor(
      async () => {
        const p = await loadProfile();
        expect(p.resumes.some((r) => r.title === 'Synced EN Version')).toBe(true);
      },
      { timeout: 6000 },
    );
  });
});
