// The profile page jumps to one input when the side panel asks (a "No data in resume" row → "Add it to your profile").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import type { ProfileTarget } from '../../../src/editor';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { resetFileStoreForTests, saveProfile } from '../../../src/storage';
import { PROFILE_FOCUS_KEY } from '../../../src/ui/pages';

const WAIT = { timeout: 4000 };

function makeProfile(active = 'r1'): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [
      ResumeSchema.parse({ id: 'r1', title: 'Resume r1', locale: 'en-AU', education: [{ school: 'First' }, { school: 'Second' }] }),
      ResumeSchema.parse({ id: 'r2', title: 'Resume r2', locale: 'zh-CN' }),
    ],
    activeResumeId: active,
    settings: { uiLanguage: 'en' },
  });
}

const ask = (target: ProfileTarget, at = Date.now()) => fakeBrowser.storage.session.set({ [PROFILE_FOCUS_KEY]: { target, at } });

async function renderApp(profile: Profile = makeProfile()) {
  await saveProfile(profile);
  const view = render(<App autosaveDelayMs={20} />);
  await screen.findByRole('tab', { name: 'Editor' });
  return view;
}

/** The `data-field-path` of the input that has focus. */
const focusedPath = () => (document.activeElement as HTMLElement | null)?.closest('[data-field-path]')?.getAttribute('data-field-path');

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  setLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLanguage('en');
});

describe('Options page – jump to an input on request', () => {
  it('a request waiting when the page opens expands a folded section and focuses the input, once', async () => {
    await ask({ module: 'jobIntention', field: 'cities' });
    await renderApp();
    await waitFor(() => expect(focusedPath()).toBe('jobIntention.cities'), WAIT);
    expect(screen.getByRole('button', { name: /^Job intention/ }).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement!.matches('input, select, textarea')).toBe(true);
    // Done with: the request is gone, so reopening the page does not jump again.
    await waitFor(async () => expect(await fakeBrowser.storage.session.get(PROFILE_FOCUS_KEY)).toEqual({}), WAIT);
  });

  it('in a list of tags, lands in the text box, never on a remove button of a tag', async () => {
    const profile = makeProfile();
    profile.resumes[0] = { ...profile.resumes[0]!, jobIntention: { ...profile.resumes[0]!.jobIntention, cities: ['Shenzhen', 'Hangzhou'] } };
    await ask({ module: 'jobIntention', field: 'cities' });
    await renderApp(profile);
    await waitFor(() => expect(focusedPath()).toBe('jobIntention.cities'), WAIT);
    expect(document.activeElement!.tagName).toBe('INPUT');
  });

  it('marks the input it jumped to', async () => {
    await ask({ module: 'contact', field: 'address.city' });
    await renderApp();
    await waitFor(() => expect(focusedPath()).toBe('contact.address.city'), WAIT);
    expect((document.activeElement as HTMLElement).classList.contains('raf-jump-target')).toBe(true);
  });

  it('jumps when the page is already open, to the right entry of a list', async () => {
    await renderApp();
    await ask({ module: 'education', entry: 1, field: 'school' });
    await waitFor(() => expect(focusedPath()).toBe('education.1.school'), WAIT);
    expect((document.activeElement as HTMLInputElement).value).toBe('Second');
  });

  it('a second request for the same input jumps again', async () => {
    await renderApp();
    await ask({ module: 'contact', field: 'email' }, 1);
    await waitFor(() => expect(focusedPath()).toBe('contact.email'), WAIT);
    (document.activeElement as HTMLElement).blur();
    await ask({ module: 'contact', field: 'email' }, 2);
    await waitFor(() => expect(focusedPath()).toBe('contact.email'), WAIT);
  });

  it('a list with no entries focuses its Add button', async () => {
    await ask({ module: 'languages', entry: 0, field: 'language' });
    await renderApp();
    await waitFor(() => expect(document.activeElement?.getAttribute('data-add-module')).toBe('languages'), WAIT);
  });

  it('shows the active resume, the one that filled the form, even when another was open', async () => {
    await renderApp(makeProfile('r1'));
    fireEvent.click(screen.getByRole('button', { name: /^Resume r2/ }));
    await waitFor(() => expect((screen.getByLabelText('Resume title') as HTMLInputElement).value).toBe('Resume r2'));
    await ask({ module: 'contact', field: 'email' });
    await waitFor(() => expect(focusedPath()).toBe('contact.email'), WAIT);
    expect((screen.getByLabelText('Resume title') as HTMLInputElement).value).toBe('Resume r1');
  });

  it('an attachment switches to the Attachments tab and its upload slot', async () => {
    await ask({ module: 'attachments', field: 'transcriptFileId' });
    await renderApp();
    await waitFor(() => expect(document.activeElement?.closest('[data-slot]')?.getAttribute('data-slot')).toBe('transcriptFileId'), WAIT);
    expect(screen.getByRole('tab', { name: 'Attachments' }).getAttribute('aria-selected')).toBe('true');
  });
});
