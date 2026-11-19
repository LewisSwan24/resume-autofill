import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { createSampleProfile } from '../../../src/schema';
import { loadProfile, resetVaultMemorySessionForTests, saveProfile } from '../../../src/storage';
import { setLanguage } from '../../../src/i18n';

describe('Options – JD Tailor & Variant Studio', () => {
  beforeEach(() => {
    cleanup();
    fakeBrowser.reset();
    resetVaultMemorySessionForTests();
    setLanguage('en');
  });

  it('runs offline JD match analysis and saves a non-destructive derived variant', async () => {
    await saveProfile(createSampleProfile());
    render(<App autosaveDelayMs={5} />);

    const tailorTab = await screen.findByRole('tab', { name: 'JD Tailor & Recipes' });
    fireEvent.click(tailorTab);

    const jdInput = await screen.findByPlaceholderText(/Paste role responsibilities/i);
    fireEvent.change(jdInput, {
      target: { value: 'Senior Backend Engineer\nRequired: TypeScript, SQL, Docker, Kubernetes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze JD match offline' }));

    expect(await screen.findByText(/Offline match score:/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save as derived resume variant' }));

    await waitFor(async () => {
      const updated = await loadProfile();
      expect(updated.resumes.length).toBe(3);
      const variant = updated.resumes.find((r) => r.id === updated.activeResumeId);
      expect(variant?.variantOf).toBe('sample-zh');
      expect(variant?.variantMeta?.targetRole).toContain('Senior Backend Engineer');
    });
  });

  it('labels a template summary as not AI output and says a fallback was used', async () => {
    await saveProfile(createSampleProfile());
    render(<App autosaveDelayMs={5} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'JD Tailor & Recipes' }));
    const jdInput = await screen.findByPlaceholderText(/Paste role responsibilities/i);
    fireEvent.change(jdInput, { target: { value: 'Senior Backend Engineer\nRequired: TypeScript, SQL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze JD match offline' }));
    await screen.findByText(/Offline match score:/);

    fireEvent.click(screen.getByRole('button', { name: 'Draft tailored summary (Fact Guard checked)' }));
    expect(await screen.findByText(/Not AI output/)).toBeTruthy();
    expect(screen.getByText(/No local model answered, so this draft is a template/)).toBeTruthy();
  });
});
