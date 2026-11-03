import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { setLanguage } from '../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { getFile, loadProfile, resetFileStoreForTests, saveProfile } from '../../../src/storage';

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
  await screen.findByRole('tab', { name: /Basics|基本信息/ });
  return view;
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openTab = (name: string | RegExp) => fireEvent.click(screen.getByRole('tab', { name }));
const savedResume = async (index = 0) => (await loadProfile()).resumes[index]!;

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

describe('Options page – editing and autosave', () => {
  it('editing a field autosaves it and shows the Saved indicator', async () => {
    await renderApp();
    type('Family name', 'Lin');
    expect(screen.getByLabelText('Family name')).toHaveProperty('value', 'Lin');
    await waitFor(async () => expect((await savedResume()).basics.familyName).toBe('Lin'), WAIT);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/), WAIT);
  });

  it('renders Chinese labels and the 已保存 indicator when the UI language is zh', async () => {
    await renderApp(makeProfile('zh'));
    expect(screen.getByLabelText('姓')).toBeTruthy();
    type('姓', '林');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/已保存/), WAIT);
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
    const zhSelect = screen.getByLabelText('性别') as HTMLSelectElement;
    expect([...zhSelect.options].map((o) => o.textContent)).toContain('男');
  });

  it('shows validation errors inline and does not save invalid values', async () => {
    await renderApp();
    openTab('Education');
    fireEvent.click(screen.getByRole('button', { name: /Add Education/ }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2020-09' } });
    await waitFor(async () => expect((await savedResume()).education[0]?.startDate).toBe('2020-09'), WAIT);
    openTab('Basics');
    fireEvent.change(screen.getByLabelText('Height (cm)'), { target: { value: '-5' } });
    await waitFor(() => expect(screen.getByRole('status').getAttribute('data-status')).toBe('invalid'), WAIT);
    expect(document.querySelector('.raf-invalid .raf-error')).not.toBeNull();
    await new Promise((r) => setTimeout(r, DELAY * 4));
    expect((await savedResume()).basics.height).toBeNull();
  });
});

describe('Options page – repeatable modules', () => {
  it('adds, edits and removes an entry', async () => {
    await renderApp();
    openTab('Education');
    fireEvent.click(screen.getByRole('button', { name: /Add Education/ }));
    type('School', 'ZJU');
    await waitFor(async () => expect((await savedResume()).education.map((e) => e.school)).toEqual(['ZJU']), WAIT);

    fireEvent.click(screen.getByRole('button', { name: /Add Education/ }));
    expect(screen.getAllByRole('region', { name: /Education \d/ })).toHaveLength(2);
    await waitFor(async () => expect((await savedResume()).education).toHaveLength(2), WAIT);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove entry' })[0]!);
    await waitFor(async () => expect((await savedResume()).education).toHaveLength(1), WAIT);
    expect((await savedResume()).education[0]!.school).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Remove entry' }));
    await waitFor(async () => expect((await savedResume()).education).toEqual([]), WAIT);
  });

  it('reorders entries', async () => {
    await renderApp();
    openTab('Skills');
    for (const name of ['First', 'Second']) {
      fireEvent.click(screen.getByRole('button', { name: /Add Skills/ }));
      const inputs = screen.getAllByLabelText('Skill');
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: name } });
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!);
    await waitFor(async () => expect((await savedResume()).skills.map((s) => s.name)).toEqual(['Second', 'First']), WAIT);
  });

  it('"Present" sets endDate=null and current=true, and an end date clears it', async () => {
    await renderApp();
    openTab('Education');
    fireEvent.click(screen.getByRole('button', { name: /Add Education/ }));
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

  it('list fields accept comma-separated values', async () => {
    await renderApp();
    openTab('Job intention');
    type('Target cities', 'Perth, Sydney');
    await waitFor(async () => expect((await savedResume()).jobIntention.cities).toEqual(['Perth', 'Sydney']), WAIT);
  });
});

describe('Options page – resume library', () => {
  it('creates, duplicates, activates and deletes resumes', async () => {
    await renderApp();
    const list = screen.getByRole('region', { name: 'Resumes' });
    fireEvent.change(within(list).getByLabelText('Locale of the new resume'), { target: { value: 'en-AU' } });
    fireEvent.click(within(list).getByRole('button', { name: /New/ }));
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(2), WAIT);
    const created = (await savedResume(1))!;
    expect(created.locale).toBe('en-AU');
    expect(created.contact.phoneCountryCode).toBe('+61');

    fireEvent.click(screen.getByRole('button', { name: 'Set active' }));
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe(created.id), WAIT);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(3), WAIT);
    expect((await savedResume(2)).title).toBe('New resume (copy)');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(2), WAIT);
  });

  it('does not delete when the confirmation is declined', async () => {
    await renderApp();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await loadProfile()).resumes).toHaveLength(1);
  });

  it('links a resume to another one', async () => {
    await renderApp(makeProfile('en', ['a', 'b']));
    fireEvent.change(screen.getByLabelText('Linked resume'), { target: { value: 'b' } });
    await waitFor(async () => expect((await savedResume(0)).linkedResumeId).toBe('b'), WAIT);
  });
});

describe('Options page – attachments', () => {
  it('uploads to the file store, shows the name, and removes it', async () => {
    await renderApp();
    openTab('Attachments');
    const file = new File(['%PDF-1.4 test'], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Resume file (PDF) – Upload'), { target: { files: [file] } });
    await screen.findByText(/cv\.pdf/, undefined, WAIT);
    const fileId = (await savedResume()).attachments.resumeFileId;
    expect(fileId).toBeTruthy();
    expect((await getFile(fileId!))?.name).toBe('cv.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Resume file (PDF) – Remove' }));
    await waitFor(async () => expect((await savedResume()).attachments.resumeFileId).toBeUndefined(), WAIT);
    await waitFor(async () => expect(await getFile(fileId!)).toBeUndefined(), WAIT);
  });
});

describe('Options page – settings', () => {
  it('stores previewBeforeFill and switches the UI language immediately', async () => {
    await renderApp();
    fireEvent.click(screen.getByLabelText('Preview before fill'));
    await waitFor(async () => expect((await loadProfile()).settings.previewBeforeFill).toBe(true), WAIT);

    fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'zh' } });
    await screen.findByLabelText('界面语言');
    await waitFor(async () => expect((await loadProfile()).settings.uiLanguage).toBe('zh'), WAIT);
  });
});

describe('Options page – import / export', () => {
  const importFile = (text: string) =>
    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [new File([text], 'p.json', { type: 'application/json' })] } });

  it('rejects invalid JSON with a clear message and leaves data untouched', async () => {
    await renderApp();
    const confirm = vi.spyOn(window, 'confirm');
    importFile('{ not json');
    const alert = await screen.findByRole('alert', undefined, WAIT);
    expect(alert.textContent).toMatch(/Import failed.*not valid JSON/);
    expect(confirm).not.toHaveBeenCalled();
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
  });

  it('rejects JSON that is not a valid profile', async () => {
    await renderApp();
    importFile(JSON.stringify({ schemaVersion: 1, resumes: [{ id: '', title: 1, locale: 'xx' }] }));
    const alert = await screen.findByRole('alert', undefined, WAIT);
    expect(alert.textContent).toMatch(/Import failed/);
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
  });

  it('imports a valid profile after confirmation and drops attachment ids whose files do not exist', async () => {
    await renderApp();
    const incoming = makeProfile('en', ['x', 'y']);
    incoming.resumes[0]!.attachments = { resumeFileId: 'ghost-file' };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    importFile(JSON.stringify(incoming));
    await waitFor(async () => expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['x', 'y']), WAIT);
    expect((await savedResume(0)).attachments).toEqual({});
    await screen.findByText(/Imported 2 resume/, undefined, WAIT);
  });

  it('keeps the current profile when the import confirmation is declined', async () => {
    await renderApp();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    importFile(JSON.stringify(makeProfile('en', ['x'])));
    await new Promise((r) => setTimeout(r, 100));
    expect((await loadProfile()).resumes.map((r) => r.id)).toEqual(['r1']);
  });

  it('says the export excludes attachment files', async () => {
    await renderApp();
    expect(screen.getByText(/not the attachment files/)).toBeTruthy();
  });
});
