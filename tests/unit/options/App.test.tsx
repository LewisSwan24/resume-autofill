import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { getFile, loadProfile, resetFileStoreForTests, saveProfile, setUiLanguage } from '../../../src/storage';

const DELAY = 20;
const WAIT = { timeout: 4000 };

function makeProfile(uiLanguage: 'auto' | 'zh' | 'en' = 'en', ids: string[] = ['r1']): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: ids.map((id, i) =>
      ResumeSchema.parse({ id, title: `Resume ${id}`, locale: i % 2 === 0 ? 'en-AU' : 'zh-CN' }),
    ),
    activeResumeId: ids[0],
    settings: { uiLanguage },
  });
}

async function renderApp(profile: Profile = makeProfile()) {
  await saveProfile(profile);
  const view = render(<App autosaveDelayMs={DELAY} />);
  await screen.findByRole('tab', { name: /Editor|编辑/ });
  return view;
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
/** Top-level tab (Editor / Attachments / Settings / Import / Export). */
const openTab = (name: string | RegExp) => fireEvent.click(screen.getByRole('tab', { name }));
/** Accordion section of the editor; expands it when it is folded. */
const openSection = (name: string | RegExp) => {
  const head = screen.getByRole('button', { name });
  if (head.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
};
const saveStatus = () => document.querySelector<HTMLElement>('.raf-status')!;
const savedResume = async (index = 0) => (await loadProfile()).resumes[index]!;
/** Row menu of a resume in the list, then one of its items. */
const chooseFromRowMenu = (resumeTitle: string, item: string) => {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${resumeTitle}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

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

describe('Options page – shell', () => {
  it('has one h1 page title and the privacy caption', async () => {
    await renderApp();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Resume Library');
    expect(screen.getByText('All data stays in this browser')).toBeTruthy();
  });

  it('has a Help button in the header that opens the help page in a tab', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    await renderApp();
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    const help = within(header).getByRole('button', { name: 'Help' });
    expect(help.textContent).toContain('Help');
    fireEvent.click(help);
    expect(create).toHaveBeenCalledWith({ url: fakeBrowser.runtime.getURL('/help.html') });
  });

  it('switches top-level tabs; the resume list belongs to Editor and Attachments only', async () => {
    await renderApp();
    expect(screen.getByRole('tab', { name: 'Editor' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: 'Resumes' })).toBeTruthy();
    openTab('Settings');
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Resumes' })).toBeNull();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Settings' }).id);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Settings' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Import / Export' }).getAttribute('aria-selected')).toBe('true');
  });

  it('every tab carries its word as the accessible name and in its DOM', async () => {
    await renderApp();
    const names = screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'));
    expect(names).toEqual([
      'Editor',
      'Attachments',
      'JD Tailor & Recipes',
      'Settings',
      'Import / Export',
      'Applications',
      'Templates',
    ]);
    // The word is in the DOM of every tab (CSS shows it from 768px up), not only on the selected one.
    for (const tab of screen.getAllByRole('tab')) expect(tab.textContent!.trim()).toBe(tab.getAttribute('aria-label'));
  });

  it('shows the Active badge once: in the resume list, not again under the title input', async () => {
    await renderApp();
    expect(screen.getAllByText('Active')).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Resumes' })).getByText('Active')).toBeTruthy();
  });

  it('gives truncated resume names a title tooltip', async () => {
    const profile = makeProfile();
    profile.resumes[0]!.title = 'Zhiyuan (Leo) Lin (English resume for the Perth graduate roles)';
    await renderApp(profile);
    const list = screen.getByRole('region', { name: 'Resumes' });
    expect(within(list).getByText(profile.resumes[0]!.title).getAttribute('title')).toBe(profile.resumes[0]!.title);
  });

  it('Basics, Contact, Education and Work start open; other modules start folded and toggle', async () => {
    await renderApp();
    for (const name of [/^Basics/, /^Contact/, /^Education/, /^Work \/ Internship/]) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('true');
    }
    const head = screen.getByRole('button', { name: /^Job intention/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Target cities')).toBeNull();
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Target cities')).toBeTruthy();
  });
});

describe('Options page – editing and autosave', () => {
  it('editing a field autosaves it and shows "All saved"', async () => {
    await renderApp();
    type('Family name', 'Lin');
    expect(screen.getByLabelText('Family name')).toHaveProperty('value', 'Lin');
    await waitFor(() => expect(saveStatus().textContent).toMatch(/Saving/), WAIT);
    await waitFor(async () => expect((await savedResume()).basics.familyName).toBe('Lin'), WAIT);
    await waitFor(() => expect(saveStatus().textContent).toMatch(/All saved/), WAIT);
  });

  it('renders Chinese labels and the 保存好啦 indicator when the UI language is zh', async () => {
    await renderApp(makeProfile('zh'));
    expect(await screen.findByLabelText('姓', {}, WAIT)).toBeTruthy();
    type('姓', '林');
    await waitFor(() => expect(saveStatus().textContent).toMatch(/保存好啦/), WAIT);
    expect((await savedResume()).basics.familyName).toBe('林');
  });

  it('region input is three text boxes that edit province / city / district', async () => {
    await renderApp();
    const group = screen.getByRole('group', { name: 'Native place' });
    expect(within(group).getAllByRole('textbox')).toHaveLength(3);
    type('Native place – Province / State', 'Zhejiang');
    type('Native place – City', 'Hangzhou');
    type('Native place – District', 'Xihu');
    await waitFor(async () => {
      expect((await savedResume()).basics.nativePlace).toEqual({ province: 'Zhejiang', city: 'Hangzhou', district: 'Xihu' });
    }, WAIT);
  });

  it('enum selects use dictionary labels in the UI language and store codes', async () => {
    await renderApp();
    const select = screen.getByLabelText('Gender') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toContain('Male');
    fireEvent.change(select, { target: { value: 'male' } });
    await waitFor(async () => expect((await savedResume()).basics.gender).toBe('male'), WAIT);
    cleanup();
    setLanguage('en');
    await renderApp(makeProfile('zh'));
    const zhSelect = (await screen.findByLabelText('性别', {}, WAIT)) as HTMLSelectElement;
    expect([...zhSelect.options].map((o) => o.textContent)).toContain('男');
  });

  it('shows validation errors under the field and in a danger Notice, and does not save invalid values', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Add education' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2020-09' } });
    await waitFor(async () => expect((await savedResume()).education[0]?.startDate).toBe('2020-09'), WAIT);
    fireEvent.change(screen.getByLabelText('Height (cm)'), { target: { value: '-5' } });
    await waitFor(() => expect(saveStatus().getAttribute('data-status')).toBe('invalid'), WAIT);
    const height = screen.getByLabelText('Height (cm)');
    expect(height.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(height.getAttribute('aria-describedby')!)?.className).toContain('raf-field__help--error');
    expect(screen.getByRole('alert').textContent).toMatch(/need another look/);
    await new Promise((r) => setTimeout(r, DELAY * 4));
    expect((await savedResume()).basics.height).toBeNull();
  });

  it('booleans are switches that autosave and can be cleared back to "Not set"', async () => {
    await renderApp();
    openSection(/^Work rights/);
    const sw = screen.getByRole('switch', { name: 'Requires sponsorship' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(async () => expect((await savedResume()).workRights.requiresSponsorship).toBe(true), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Requires sponsorship' }));
    await waitFor(async () => expect((await savedResume()).workRights.requiresSponsorship ?? null).toBeNull(), WAIT);
  });
});

describe('Options page – repeatable modules', () => {
  it('adds, edits and removes an entry', async () => {
    await renderApp();
    expect(screen.getByText(/No education yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add education' }));
    expect(screen.queryByText(/No education yet/)).toBeNull();
    type('School', 'ZJU');
    await waitFor(async () => expect((await savedResume()).education.map((e) => e.school)).toEqual(['ZJU']), WAIT);

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }));
    expect(screen.getAllByRole('group', { name: /^Education \d$/ })).toHaveLength(2);
    await waitFor(async () => expect((await savedResume()).education).toHaveLength(2), WAIT);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete entry' })[0]!);
    await waitFor(async () => expect((await savedResume()).education).toHaveLength(1), WAIT);
    expect((await savedResume()).education[0]!.school).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    await waitFor(async () => expect((await savedResume()).education).toEqual([]), WAIT);
    expect(screen.getByText(/No education yet/)).toBeTruthy();
  });

  it('deleting an entry shows a Toast with Undo that puts it back in place', async () => {
    await renderApp();
    for (const school of ['First', 'Second', 'Third']) {
      fireEvent.click(screen.getByRole('button', { name: 'Add education' }));
      const inputs = screen.getAllByLabelText('School');
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: school } });
    }
    await waitFor(async () => expect((await savedResume()).education.map((e) => e.school)).toEqual(['First', 'Second', 'Third']), WAIT);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete entry' })[1]!);
    // No confirmation dialog: it is gone at once, and the toast says so.
    expect(screen.queryByRole('dialog')).toBeNull();
    const toast = await screen.findByText('Education 2 removed');
    expect(screen.getAllByLabelText('School')).toHaveLength(2);
    await waitFor(async () => expect((await savedResume()).education.map((e) => e.school)).toEqual(['First', 'Third']), WAIT);

    // An edit made after deleting stays when the entry is restored.
    fireEvent.change(screen.getAllByLabelText('School')[0]!, { target: { value: 'First!' } });
    fireEvent.click(within(toast.closest('.raf-toast') as HTMLElement).getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await savedResume()).education.map((e) => e.school)).toEqual(['First!', 'Second', 'Third']), WAIT);
    await waitFor(() => expect(screen.queryByText('Education 2 removed')).toBeNull(), WAIT);
  });

  it('reorders entries', async () => {
    await renderApp();
    openSection(/^Skills/);
    for (const name of ['First', 'Second']) {
      fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));
      const inputs = screen.getAllByLabelText('Skill');
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: name } });
    }
    expect((screen.getAllByRole('button', { name: 'Move up' })[0] as HTMLButtonElement).disabled).toBe(true);
    // The disabled buttons say why in their tooltip; the enabled ones keep their plain name.
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]!.getAttribute('data-tip')).toBe('Already the first one');
    expect(screen.getAllByRole('button', { name: 'Move up' })[1]!.getAttribute('data-tip')).toBe('Move up');
    expect(screen.getAllByRole('button', { name: 'Move down' }).at(-1)!.getAttribute('data-tip')).toBe('Already the last one');
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!);
    await waitFor(async () => expect((await savedResume()).skills.map((s) => s.name)).toEqual(['Second', 'First']), WAIT);
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);
    await waitFor(async () => expect((await savedResume()).skills.map((s) => s.name)).toEqual(['First', 'Second']), WAIT);
  });

  it('"Present" sets endDate=null and current=true, and an end date clears it', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Add education' }));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2024-06' } });
    await waitFor(async () => expect((await savedResume()).education[0]!.endDate).toBe('2024-06'), WAIT);

    fireEvent.click(screen.getByLabelText('Present'));
    expect((screen.getByLabelText('End date') as HTMLInputElement).disabled).toBe(true);
    await waitFor(async () => {
      expect((await savedResume()).education[0]).toMatchObject({ endDate: null, current: true });
    }, WAIT);

    fireEvent.click(screen.getByLabelText('Present'));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2025-01' } });
    await waitFor(async () => {
      expect((await savedResume()).education[0]).toMatchObject({ endDate: '2025-01', current: false });
    }, WAIT);
  });

  it('list fields are tag inputs: a comma or Enter adds a tag, the tag button removes it', async () => {
    await renderApp();
    openSection(/^Job intention/);
    const cities = screen.getByLabelText('Target cities');
    fireEvent.change(cities, { target: { value: 'Perth,' } });
    expect(screen.getByRole('button', { name: 'Remove Perth' })).toBeTruthy();
    fireEvent.change(cities, { target: { value: 'Sydney' } });
    fireEvent.keyDown(cities, { key: 'Enter' });
    await waitFor(async () => expect((await savedResume()).jobIntention.cities).toEqual(['Perth', 'Sydney']), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Perth' }));
    await waitFor(async () => expect((await savedResume()).jobIntention.cities).toEqual(['Sydney']), WAIT);
  });
});

describe('Options page – resume library', () => {
  it('creates, duplicates and activates resumes through the list and its row menu', async () => {
    await renderApp();
    const list = screen.getByRole('region', { name: 'Resumes' });
    fireEvent.click(within(list).getByRole('radio', { name: 'en-AU' }));
    fireEvent.click(within(list).getByRole('button', { name: 'New' }));
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(2), WAIT);
    const created = (await savedResume(1))!;
    expect(created.locale).toBe('en-AU');
    expect(created.contact.phoneCountryCode).toBe('+61');
    // The new resume is selected (aria-current) and the first one still carries the Active badge.
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[1]!).getByRole('button', { name: /^New resume/ }).getAttribute('aria-current')).toBe('true');
    expect(within(rows[0]!).getByText('Active')).toBeTruthy();
    expect(within(rows[1]!).queryByText('Active')).toBeNull();

    chooseFromRowMenu('New resume', 'Set active');
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe(created.id), WAIT);
    expect(within(within(list).getAllByRole('listitem')[1]!).getByText('Active')).toBeTruthy();

    chooseFromRowMenu('New resume', 'Duplicate');
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(3), WAIT);
    expect((await savedResume(2)).title).toBe('New resume (copy)');
  });

  it('row menu: arrow keys move through the items and Esc closes it', async () => {
    await renderApp(makeProfile('en', ['a', 'b']));
    const trigger = screen.getByRole('button', { name: 'More actions for Resume a' });
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent!.trim())).toEqual(['Set active', 'Duplicate', 'Link resume', 'Delete']);
    // "Set active" is disabled for the resume that is already active, so focus starts on Duplicate.
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('deleting asks first in a Dialog; "Delete resume" removes it', async () => {
    await renderApp(makeProfile('en', ['a', 'b']));
    chooseFromRowMenu('Resume b', 'Delete');
    const dialog = screen.getByRole('dialog', { name: 'Delete this resume?' });
    expect(dialog.textContent).toMatch(/"Resume b" will be removed from this browser/);
    // Nothing is deleted yet, and the safe button has focus.
    expect((await loadProfile()).resumes).toHaveLength(2);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Not now' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete resume' }));
    await waitFor(async () => expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['a']), WAIT);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not delete when the Dialog is dismissed with "Not now" or Esc', async () => {
    await renderApp();
    chooseFromRowMenu('Resume r1', 'Delete');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Focus goes back to the menu button that started it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions for Resume r1' }));

    chooseFromRowMenu('Resume r1', 'Delete');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await loadProfile()).resumes).toHaveLength(1);
  });

  it('links a resume to another one from the row menu', async () => {
    await renderApp(makeProfile('en', ['a', 'b']));
    chooseFromRowMenu('Resume a', 'Link resume');
    const dialog = screen.getByRole('dialog', { name: 'Link this resume' });
    fireEvent.change(within(dialog).getByLabelText('Linked resume'), { target: { value: 'b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save link' }));
    await waitFor(async () => expect((await savedResume(0)).linkedResumeId).toBe('b'), WAIT);
    await screen.findByText('Linked to Resume b');
  });

  it('edits the resume title', async () => {
    await renderApp();
    type('Resume title', 'My CV');
    await waitFor(async () => expect((await savedResume()).title).toBe('My CV'), WAIT);
  });
});

describe('Options page – attachments', () => {
  it('uploads to the file store, lists name · size, and removes it', async () => {
    await renderApp();
    openTab('Attachments');
    expect(screen.getByText('Accepts PDF, up to 10 MB')).toBeTruthy();
    // Plain-language privacy note (no jargon), and no second "Attachments" heading under the tab of the same name.
    expect(screen.getByText('Files stay in this browser and are only used when you fill a form.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/IndexedDB/);
    expect(screen.queryByRole('heading', { name: 'Attachments' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Attachments' })).toBeTruthy();
    const file = new File(['%PDF-1.4 test'], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Resume file (PDF) – Upload'), { target: { files: [file] } });
    await screen.findByText('cv.pdf', undefined, WAIT);
    expect(screen.getByText(/^1 KB · /)).toBeTruthy();
    const fileId = (await savedResume()).attachments.resumeFileId;
    expect(fileId).toBeTruthy();
    expect((await getFile(fileId!))?.name).toBe('cv.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Resume file (PDF) – Remove' }));
    await waitFor(async () => expect((await savedResume()).attachments.resumeFileId).toBeUndefined(), WAIT);
    await waitFor(async () => expect(await getFile(fileId!)).toBeUndefined(), WAIT);
  });

  it('rejects the wrong type and oversized files with an aria-invalid error under the drop zone', async () => {
    await renderApp();
    openTab('Attachments');
    const input = screen.getByLabelText('Resume file (PDF) – Upload');
    fireEvent.change(input, { target: { files: [new File(['hi'], 'notes.txt', { type: 'text/plain' })] } });
    await screen.findByText(/That file type isn't accepted/);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    await screen.findByText("That file's over 10 MB. Try a smaller one.");
    expect((await savedResume()).attachments.resumeFileId).toBeUndefined();
  });
});

describe('Options page – settings', () => {
  it('stores previewBeforeFill and switches the UI language immediately', async () => {
    await renderApp();
    openTab('Settings');
    fireEvent.click(screen.getByRole('switch', { name: 'Preview before fill' }));
    await waitFor(async () => expect((await loadProfile()).settings.previewBeforeFill).toBe(true), WAIT);

    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: '中文' }));
    await screen.findByRole('radiogroup', { name: '界面语言' });
    await waitFor(async () => expect((await loadProfile()).settings.uiLanguage).toBe('zh'), WAIT);
  });
});

describe('Options page – one-click interface language', () => {
  const toggle = (name = 'Interface language') => screen.getByRole('group', { name });

  it('the header toggle shows the language in use and switches the whole page in one click', async () => {
    await renderApp(makeProfile('en'));
    expect(within(toggle()).getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(toggle()).getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(toggle()).getByRole('button', { name: '中文' }));
    await screen.findByRole('tab', { name: '编辑' });
    expect(within(toggle('界面语言')).getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(async () => expect((await loadProfile()).settings.uiLanguage).toBe('zh'), WAIT);
  });

  it('on "follow the browser" it marks the language actually shown, and a click pins the other one', async () => {
    await renderApp(makeProfile('auto')); // jsdom's navigator.language is en-US
    expect(within(toggle()).getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(toggle()).getByRole('button', { name: '中文' }));
    await waitFor(async () => expect((await loadProfile()).settings.uiLanguage).toBe('zh'), WAIT);
  });

  it('follows a switch made in another surface (side panel)', async () => {
    await renderApp(makeProfile('en'));
    await setUiLanguage('zh');
    await screen.findByRole('tab', { name: '编辑' }, WAIT);
  });
});

describe('Options page – import / export', () => {
  const importFile = (text: string) =>
    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [new File([text], 'p.json', { type: 'application/json' })] } });

  it('rejects invalid JSON with a clear message and leaves data untouched', async () => {
    await renderApp();
    openTab('Import / Export');
    importFile('{ not json');
    const alert = await screen.findByRole('alert', undefined, WAIT);
    expect(alert.textContent).toMatch(/Couldn't import that file.*isn't JSON we can read/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
  });

  it('rejects JSON that is not a valid profile', async () => {
    await renderApp();
    openTab('Import / Export');
    importFile(JSON.stringify({ schemaVersion: 1, resumes: [{ id: '', title: 1, locale: 'xx' }] }));
    const alert = await screen.findByRole('alert', undefined, WAIT);
    expect(alert.textContent).toMatch(/Couldn't import that file/);
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
  });

  it('imports a valid profile after confirming in a Dialog and drops attachment ids whose files do not exist', async () => {
    await renderApp();
    openTab('Import / Export');
    const incoming = makeProfile('en', ['x', 'y']);
    incoming.resumes[0]!.attachments = { resumeFileId: 'ghost-file' };
    importFile(JSON.stringify(incoming));
    const dialog = await screen.findByRole('dialog', { name: 'Replace your resumes?' }, WAIT);
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import and replace' }));
    await waitFor(async () => expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['x', 'y']), WAIT);
    expect((await savedResume(0)).attachments).toEqual({});
    await screen.findByText(/Imported 2 resume/, undefined, WAIT);
  });

  it('keeps the current profile when the import Dialog is declined', async () => {
    await renderApp();
    openTab('Import / Export');
    importFile(JSON.stringify(makeProfile('en', ['x'])));
    const dialog = await screen.findByRole('dialog', undefined, WAIT);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
  });

  it('says the export excludes attachment files', async () => {
    await renderApp();
    openTab('Import / Export');
    expect(screen.getByText(/not the attachment files/)).toBeTruthy();
  });
});

describe('Options page – narrow window', () => {
  /** jsdom has no matchMedia: pretend the window is below 768px. */
  const narrowWindow = () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    window.matchMedia = globalThis.matchMedia;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error restore jsdom's lack of matchMedia
    delete window.matchMedia;
  });

  it('folds the resume list behind its heading, shows the open resume, and unfolds on demand', async () => {
    narrowWindow();
    await renderApp(makeProfile('en', ['r1', 'r2']));
    const toggle = screen.getByRole('button', { name: /^Resumes/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Resume r1');
    expect(screen.queryByRole('listitem')).toBeNull(); // hidden: not exposed

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    // Choosing a resume folds the list again and the toggle names the new choice.
    fireEvent.click(screen.getByRole('button', { name: /^Resume r2/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Resumes/ }).getAttribute('aria-expanded')).toBe('false'));
    expect(screen.getByRole('button', { name: /^Resumes/ }).textContent).toContain('Resume r2');
  });
});