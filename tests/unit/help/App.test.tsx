import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/help/App';
import type { Outcome } from '../../../src/engine/types';
import { setLanguage, translate } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { OUTCOME_STATUS } from '../../../src/ui/status';
import { saveProfile } from '../../../src/storage';

const WAIT = { timeout: 4000 };

const makeProfile = (uiLanguage: 'auto' | 'zh' | 'en' = 'en'): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: 'Main', locale: 'en-AU' })],
    activeResumeId: 'r1',
    settings: { uiLanguage },
  });

async function renderHelp(profile: Profile = makeProfile()) {
  await saveProfile(profile);
  const view = render(<App />);
  await screen.findByRole('heading', { level: 1 }, WAIT);
  return view;
}

const SECTIONS = ['How filling works', 'What the statuses mean', 'Supported sites', 'Privacy', 'Troubleshooting'];
const section = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  setLanguage('en');
});

describe('Help page', () => {
  it('has one h1, names the tab, and a contents list that links to every section', async () => {
    await renderHelp();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Help');
    await waitFor(() => expect(document.title).toBe('Help · Resume Autofill'));
    const contents = screen.getByRole('navigation', { name: 'Contents' });
    const links = within(contents).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(SECTIONS);
    for (const [i, link] of links.entries()) {
      const target = document.getElementById(link.getAttribute('href')!.slice(1));
      expect(target, SECTIONS[i]).toBeTruthy();
      expect(within(target!).getByRole('heading', { level: 2 }).textContent).toBe(SECTIONS[i]);
    }
  });

  it('explains every status with the same icon and word as the side panel', async () => {
    await renderHelp();
    const statuses = within(section('What the statuses mean')).getByRole('list');
    const items = within(statuses).getAllByRole('listitem');
    const outcomes = Object.keys(OUTCOME_STATUS) as Outcome[];
    expect(items).toHaveLength(outcomes.length);
    for (const outcome of outcomes) {
      const word = translate('en', OUTCOME_STATUS[outcome].labelKey);
      const item = items.find((li) => li.getAttribute('data-outcome') === outcome);
      expect(item, outcome).toBeTruthy();
      expect(item!.querySelector('svg'), outcome).toBeTruthy();
      expect(within(item!).getByText(word)).toBeTruthy();
      // A meaning beyond the word itself.
      expect(item!.textContent!.length, outcome).toBeGreaterThan(word.length + 20);
    }
  });

  it('names the supported sites and the generic forms', async () => {
    await renderHelp();
    const text = section('Supported sites').textContent!;
    for (const name of ['Moka', 'Beisen', 'Feishu', 'Ant Design', 'Element']) expect(text).toContain(name);
  });

  it('says the data stays local and nothing is submitted', async () => {
    await renderHelp();
    const text = section('Privacy').textContent!;
    expect(text).toMatch(/stays in this browser/);
    expect(text).toMatch(/never presses Submit/);
  });

  it('answers the common problems as question and answer pairs', async () => {
    await renderHelp();
    const questions = within(section('Troubleshooting')).getAllByRole('heading', { level: 3 });
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(questions[0]!.textContent).toBe("I don't see the Autofill button");
  });

  it('opens the profile page from its button', async () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    await renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('follows the stored interface language', async () => {
    await renderHelp(makeProfile('zh'));
    expect(await screen.findByRole('heading', { level: 1, name: '使用说明' }, WAIT)).toBeTruthy();
    expect(screen.getByRole('region', { name: '状态是什么意思' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: '支持的网站' })).getByText(/北森/)).toBeTruthy();
  });
});
