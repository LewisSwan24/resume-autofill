import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { createSampleProfile } from '../../../src/schema';
import { loadProfile, resetFileStoreForTests, saveProfile } from '../../../src/storage';
import { addManualApplication, loadApplications } from '../../../src/tracker';

const WAIT = { timeout: 4000 };

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  const profile = createSampleProfile();
  profile.settings.uiLanguage = 'en';
  profile.activeResumeId = 'sample-en';
  await saveProfile(profile);
});

afterEach(() => {
  cleanup();
});

describe('Options page – Applications, Templates & Presets', () => {
  it('adds and filters applications inside the Applications tab', async () => {
    render(<App autosaveDelayMs={20} />);
    await screen.findByRole('tab', { name: 'Applications' });
    fireEvent.click(screen.getByRole('tab', { name: 'Applications' }));
    await screen.findByText(/No applications tracked yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Add application' }));
    fireEvent.change(screen.getByLabelText('Application URL'), { target: { value: 'https://careers.canva.com/job/1' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Canva' } });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Frontend Grad' } });
    const addButtons = screen.getAllByRole('button', { name: 'Add application' });
    fireEvent.click(addButtons[addButtons.length - 1]!);

    await screen.findByText('Canva', undefined, WAIT);
    expect((await loadApplications())).toHaveLength(1);
  });

  it('switches template styles and renders live preview inside Templates tab', async () => {
    render(<App autosaveDelayMs={20} />);
    await screen.findByRole('tab', { name: 'Templates' });
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));

    const auBtn = screen.getByRole('radio', { name: /AU \/ NZ Graduate CV/ });
    fireEvent.click(auBtn);
    expect(auBtn.getAttribute('aria-checked')).toBe('true');

    const frame = screen.getByTitle('Live layout preview') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('Work rights:');
  });

  it('saves mappingPresetId in Settings and merges mobileTracker on JSON import', async () => {
    render(<App autosaveDelayMs={20} />);
    await screen.findByRole('tab', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Autofill text preset'), { target: { value: 'au_grad' } });
    await waitFor(async () => expect((await loadProfile()).settings.mappingPresetId).toBe('au_grad'), WAIT);

    // Prepare one tracker record inside an exported profile payload and import it
    const existing = await addManualApplication({ url: 'https://a.example/job', company: 'CoA', position: 'SDE', now: 100 });
    const payload = {
      ...createSampleProfile(),
      mobileTracker: [{ ...existing!, status: 'interview', updatedAt: 500 }],
    };
    fireEvent.click(screen.getByRole('tab', { name: 'Import / Export' }));
    fireEvent.change(screen.getByLabelText('Import JSON'), {
      target: { files: [new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })] },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Replace your resumes?' }, WAIT);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import and replace' }));
    await waitFor(async () => expect((await loadApplications())[0]?.status).toBe('interview'), WAIT);
  });
});
