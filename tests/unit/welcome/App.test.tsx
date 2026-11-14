import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/welcome/App';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { loadProfile, saveProfile } from '../../../src/storage';

const WAIT = { timeout: 4000 };

const makeProfile = (uiLanguage: 'auto' | 'zh' | 'en' = 'en'): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: 'Main', locale: 'en-AU' })],
    activeResumeId: 'r1',
    settings: { uiLanguage },
  });

async function renderWelcome(profile: Profile = makeProfile()) {
  await saveProfile(profile);
  const view = render(<App />);
  await screen.findByRole('heading', { level: 1 }, WAIT);
  return view;
}

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  setLanguage('en');
});

describe('Welcome page', () => {
  it('says what the extension does under one h1, and names the tab', async () => {
    await renderWelcome();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Resume Autofill');
    expect(screen.getByText(/open an application form, and fill it in with one click/)).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Welcome to Resume Autofill'));
  });

  it('lists the three steps in order: profile, form, Autofill', async () => {
    await renderWelcome();
    const steps = screen.getByRole('list', { name: 'Three steps' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Fill in your profile',
      'Open an application form',
      'Press Autofill',
    ]);
  });

  it('says plainly that nothing is ever submitted, and that the data stays local', async () => {
    await renderWelcome();
    expect(screen.getByText('It fills in. It never submits.')).toBeTruthy();
    expect(screen.getByText(/never presses Submit for you/)).toBeTruthy();
    expect(screen.getByText(/stays in this browser/)).toBeTruthy();
  });

  it('the main button opens the profile page; Help opens the help page', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    await renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: 'Fill in your profile' }));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(create).toHaveBeenCalledWith({ url: fakeBrowser.runtime.getURL('/help.html') });
  });

  it('follows the stored interface language, and the toggle switches and stores it', async () => {
    await renderWelcome(makeProfile('zh'));
    expect(await screen.findByRole('heading', { level: 1, name: '网申简历一键填写助手' }, WAIT)).toBeTruthy();
    expect(screen.getByRole('button', { name: '去填写简历资料' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Resume Autofill' }, WAIT)).toBeTruthy();
    await waitFor(async () => expect((await loadProfile()).settings.uiLanguage).toBe('en'));
  });
});
