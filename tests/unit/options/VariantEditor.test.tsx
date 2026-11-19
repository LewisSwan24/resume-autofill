import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, createSampleProfile } from '../../../src/schema';
import { loadProfile, putFile, resetFileStoreForTests, resetVaultMemorySessionForTests, saveProfile } from '../../../src/storage';

const WAIT = { timeout: 4000 };

async function renderVariant() {
  const cv = await putFile({ name: 'base-cv.pdf', type: 'application/pdf', blob: new Blob(['%PDF-1.4']) });
  await saveProfile(
    ProfileSchema.parse({
      schemaVersion: 2,
      activeResumeId: 'v',
      settings: { uiLanguage: 'en' },
      resumes: [
        ResumeSchema.parse({
          id: 'base',
          title: 'Base',
          locale: 'en-AU',
          basics: { familyName: 'Lee' },
          work: [{ company: 'First Co' }],
          attachments: { resumeFileId: cv },
        }),
        ResumeSchema.parse({ id: 'v', title: 'Variant', locale: 'en-AU', variantOf: 'base' }),
      ],
    }),
  );
  render(<App autosaveDelayMs={5} />);
  await screen.findByRole('tab', { name: 'Editor' }, WAIT);
}

const variantOf = async () => (await loadProfile()).resumes.find((r) => r.id === 'v')!;
const baseOf = async () => (await loadProfile()).resumes.find((r) => r.id === 'base')!;

beforeEach(async () => {
  fakeBrowser.reset();
  resetVaultMemorySessionForTests();
  await resetFileStoreForTests();
  setLanguage('en');
});
afterEach(() => cleanup());

describe('Editing a variant', () => {
  it("shows the base's value where the variant has none, marked as inherited; typing overrides, clearing goes back", async () => {
    await renderVariant();
    const family = (await screen.findByLabelText('Family name', undefined, WAIT)) as HTMLInputElement;
    expect(family.value).toBe('');
    expect(family.placeholder).toBe('Lee');
    expect(screen.getByText('From the base resume: Lee')).toBeTruthy();

    fireEvent.change(family, { target: { value: 'Wu' } });
    await waitFor(async () => expect((await variantOf()).basics.familyName).toBe('Wu'), WAIT);
    expect((await baseOf()).basics.familyName).toBe('Lee');

    fireEvent.click(screen.getByRole('button', { name: 'Use the base value for Family name' }));
    await waitFor(async () => expect((await variantOf()).basics.familyName).toBe(''), WAIT);
    expect((screen.getByLabelText('Family name') as HTMLInputElement).placeholder).toBe('Lee');
  });

  it('shows inherited entries of a section and can copy them into the variant, then go back to the base', async () => {
    await renderVariant();
    const work = await screen.findByTestId('inherited-work', undefined, WAIT);
    expect(work.textContent).toContain('First Co');
    fireEvent.click(within(work).getByRole('button', { name: 'Copy into this variant to edit' }));
    await waitFor(async () => expect((await variantOf()).work.map((w) => w.company)).toEqual(['First Co']), WAIT);

    fireEvent.click(await screen.findByRole('button', { name: 'Go back to the base entries' }, WAIT));
    await waitFor(async () => expect((await variantOf()).work).toEqual([]), WAIT);
    expect((await baseOf()).work.map((w) => w.company)).toEqual(['First Co']);
  });

  it("shows the base's attachment as inherited on the Attachments tab", async () => {
    await renderVariant();
    fireEvent.click(screen.getByRole('tab', { name: 'Attachments' }));
    const slot = document.querySelector<HTMLElement>('[data-slot="resumeFileId"]')!;
    await waitFor(() => expect(slot.textContent).toContain('base-cv.pdf'), WAIT);
    expect(slot.textContent).toContain('From the base resume');
  });
});

describe('TailorPanel variants', () => {
  it('start with no overrides and hide entries by id, not by position', async () => {
    await saveProfile(createSampleProfile());
    render(<App autosaveDelayMs={5} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'JD Tailor & Recipes' }, WAIT));
    fireEvent.change(await screen.findByPlaceholderText(/Paste role responsibilities/i), {
      target: { value: 'Senior Backend Engineer\nRequired: TypeScript, SQL, Docker, Kubernetes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze JD match offline' }));
    await screen.findByText(/Offline match score:/);
    fireEvent.click(screen.getByRole('button', { name: 'Save as derived resume variant' }));

    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(3), WAIT);
    const profile = await loadProfile();
    const variant = profile.resumes.find((r) => r.id === profile.activeResumeId)!;
    const empty = ResumeSchema.parse({ id: variant.id, title: variant.title, locale: variant.locale });
    expect(variant.basics).toEqual(empty.basics);
    expect(variant.contact).toEqual(empty.contact);
    expect(variant.work).toEqual([]);
    expect(variant.attachments).toEqual({});
    expect(variant.variantMeta?.hiddenIndices).toBeUndefined();
  });
});
