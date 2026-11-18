import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { setLanguage } from '../../../src/i18n';
import { exportSignedRecipePack } from '../../../src/recipes';
import { createSampleProfile } from '../../../src/schema';
import { loadProfile, resetFileStoreForTests, saveProfile } from '../../../src/storage';
import { loadApplications, recordFillApplication, updateApplication } from '../../../src/tracker';

const WAIT = { timeout: 4000 };

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  setLanguage('en');
  const profile = createSampleProfile();
  profile.settings.uiLanguage = 'en';
  profile.activeResumeId = 'sample-en';
  // Leave email empty on active resume so AuditCard reliably displays a jump-to-fix item.
  profile.resumes[1]!.contact.email = '';
  await saveProfile(profile);
});

afterEach(() => {
  cleanup();
});

describe('Options – M5 Funnel Analytics, 5-Dimension Audit & Signed Recipe Diff', () => {
  it('renders 5-dimension ATS Health Audit card and jumps directly to offending control on Fix click', async () => {
    render(<App autosaveDelayMs={20} />);
    const auditSection = await screen.findByRole('region', { name: '5-Dimension ATS Resume Audit' }, WAIT);
    expect(auditSection.textContent).toContain('Contact & Basics');
    expect(auditSection.textContent).toContain('Email is missing or invalid');

    const fixButtons = screen.getAllByRole('button', { name: 'Fix now' });
    fireEvent.click(fixButtons[0]!);

    await waitFor(() => {
      const el = document.activeElement as HTMLInputElement | null;
      expect(el?.tagName).toBe('INPUT');
    }, WAIT);
  });

  it('renders pure SVG Funnel, Variant attribution, Stale alert, and updates outcomes in Tracker tab', async () => {
    const oldMs = Date.now() - 16 * 86_400_000;
    const rec = (await recordFillApplication({
      url: 'https://jobs.stripe.com/roles/1',
      filled: 5,
      attention: 0,
      skipped: 0,
      variantId: 'sample-en',
      variantTitle: 'Frontend CV',
      now: oldMs,
    }))!;
    await updateApplication(rec.id, { company: 'Stripe', position: 'Staff Frontend', status: 'interview' }, oldMs);

    render(<App autosaveDelayMs={20} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Applications' }));

    await screen.findByRole('img', { name: 'Offline Funnel & Variant A/B Analytics' }, WAIT);
    expect(screen.getByText(/Stale >14 days \(1\): Stripe/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'offer' } });
    await waitFor(async () => {
      const updated = await loadApplications();
      expect(updated[0]?.outcome).toBe('offer');
    }, WAIT);
  });

  it('verifies signed recipe pack SHA-256 and shows diff preview before applying', async () => {
    render(<App autosaveDelayMs={20} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'JD Tailor & Recipes' }));

    const signedJson = await exportSignedRecipePack([
      {
        id: 'signed-m5-demo',
        name: 'Demo ATS',
        hostPattern: '*.demo-ats.test',
        enabled: true,
        updatedAt: 1000,
        rules: [
          {
            id: 'r1',
            fingerprint: { tag: 'input', nameAttr: 'github', labelTokens: ['github'] },
            fieldKey: 'contact.github',
            transformPreset: 'trim',
          },
        ],
      },
    ]);

    const fileInput = document.querySelector('input[type="file"][accept*=".json"]') as HTMLInputElement;
    const file = new File([signedJson], 'recipes.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await screen.findByText(/SHA-256 verified · \+1 new/, undefined, WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Apply diff' }));

    await waitFor(async () => {
      const p = await loadProfile();
      expect(p.recipes?.some((r) => r.id === 'signed-m5-demo')).toBe(true);
    }, WAIT);
  });
});
