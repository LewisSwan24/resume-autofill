import { readFileSync } from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/options/App';
import { ImportReview } from '../../../entrypoints/options/ImportReview';
import { setLanguage } from '../../../src/i18n';
import { draftToResume } from '../../../src/import/draft';
import { extractDocx } from '../../../src/import/extract/docx';
import { extractPdf, type PdfLoader } from '../../../src/import/extract/pdf';
import type { TextLine } from '../../../src/import/extract/types';
import { parseResume, type Draft } from '../../../src/import/parse';
import { ProfileSchema, ResumeSchema } from '../../../src/schema';
import { getFile, listFiles, loadProfile, resetFileStoreForTests, saveProfile } from '../../../src/storage';

const read = vi.hoisted(() => ({ result: { ok: false, reason: 'failed' } as unknown }));
vi.mock('../../../src/import/read', () => ({ readResumeFile: async () => read.result }));
const disk = vi.hoisted(() => ({ fail: false, hold: null as Promise<void> | null }));
vi.mock('../../../src/storage', async (original) => {
  const real = await original<typeof import('../../../src/storage')>();
  return {
    ...real,
    putFile: async (...args: Parameters<typeof real.putFile>) => {
      if (disk.hold) await disk.hold;
      if (disk.fail) throw new Error('The disk is full');
      return real.putFile(...args);
    },
  };
});

const LINES: TextLine[] = ['Mia Harper', 'mia.harper@example.com', 'Experience', 'Fictional Studio'].map((text) => ({ text, cells: [text], page: 1, fontSize: 0 }));
const DRAFT: Draft = {
  locale: 'en-AU',
  fields: [
    { path: 'basics.givenName', value: 'Mia', certainty: 'check', line: 0 },
    { path: 'contact.email', value: 'mia.harper@example.com', certainty: 'high', line: 1 },
    { path: 'work.0.company', value: 'Fictional Studio', certainty: 'check', line: 3 },
    { path: 'work.0.startDate', value: '2020-02', certainty: 'high', line: 3 },
    { path: 'work.0.current', value: 'true', certainty: 'high', line: 3 },
    { path: 'education.0.degree', value: 'bachelor', certainty: 'check', line: 3 },
  ],
};

beforeEach(() => {
  disk.fail = false;
  disk.hold = null;
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(async () => {
  cleanup();
  await resetFileStoreForTests();
});

describe('the check page', () => {
  it('marks what was inferred and counts it, and leaves what is proven plain', () => {
    render(<ImportReview fileName="mine.pdf" lines={LINES} draft={DRAFT} onCancel={() => undefined} onSave={() => undefined} />);
    const row = (path: string) => document.querySelector(`[data-path="${path}"]`)!;
    expect(row('basics.givenName').className).toContain('is-check');
    expect(row('contact.email').className).not.toContain('is-check');
    expect(screen.getByText(/3 fields? to check/i)).toBeTruthy();
  });

  it('shows the line a field came from', () => {
    render(<ImportReview fileName="mine.pdf" lines={LINES} draft={DRAFT} onCancel={() => undefined} onSave={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /show the file text/i }));
    fireEvent.focus(within(document.querySelector('[data-path="contact.email"]')!).getByRole('textbox'));
    expect(document.getElementById('raf-source-1')!.className).toContain('is-active');
  });

  it('gives what was edited to the save, and shows file text as text', () => {
    const onSave = vi.fn();
    const hostile = [{ text: '<img src=x onerror=alert(1)>', cells: ['x'], page: 1, fontSize: 0 }];
    render(<ImportReview fileName="mine.pdf" lines={hostile} draft={DRAFT} onCancel={() => undefined} onSave={onSave} />);
    expect(document.querySelector('.raf-review img')).toBeNull();
    fireEvent.change(within(document.querySelector('[data-path="basics.givenName"]')!).getByRole('textbox'), { target: { value: 'Amelia' } });
    fireEvent.click(screen.getByRole('button', { name: /save as a new resume/i }));
    expect(onSave.mock.calls[0]![0].fields[0]).toMatchObject({ path: 'basics.givenName', value: 'Amelia' });
    expect(onSave.mock.calls[0]![1]).toBe('mine');
  });
});

describe('what a real file reads into', () => {
  const CMAPS = `${path.resolve('node_modules/pdfjs-dist/cmaps').split(path.sep).join('/')}/`;
  const linesOf = async (name: string): Promise<TextLine[]> => {
    const data = new Uint8Array(readFileSync(path.join('fixtures', 'resume-samples', name)));
    const r = name.endsWith('.pdf')
      ? await extractPdf(data, getDocument as unknown as PdfLoader, CMAPS)
      : await extractDocx(data, (i) => mammoth.convertToHtml({ buffer: Buffer.from(i.arrayBuffer) } as never));
    if (!r.ok) throw new Error(`${name}: ${r.reason}`);
    return r.lines;
  };

  it.each(['zh-single.pdf', 'en-single.pdf', 'en-two-columns.pdf', 'zh-table.docx', 'en.docx'])('%s: every row has words on it and survives the save', async (name) => {
    const lines = await linesOf(name);
    const draft = parseResume(lines);
    render(<ImportReview fileName={name} lines={lines} draft={draft} onCancel={() => undefined} onSave={() => undefined} />);
    const rows = [...document.querySelectorAll('[data-path]')];
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row.querySelector('label')!.textContent, row.getAttribute('data-path')!).not.toMatch(/options.|^s*$/);
    for (const legend of document.querySelectorAll('legend')) expect(legend.textContent).not.toMatch(/options./);

    const saved = draftToResume(draft, { id: 'x', title: 't' }) as unknown as Record<string, unknown>;
    for (const f of draft.fields) {
      const got = f.path.split('.').reduce<unknown>((bag, part) => (bag as Record<string, unknown> | undefined)?.[part], saved);
      expect(String(got), f.path).toBe(f.value.trim());
    }
  });

  it('has a name for the part that introduces the applicant', () => {
    const about: Draft = { locale: 'en-AU', fields: [{ path: 'selfIntroduction', value: 'Fictional words.', certainty: 'check', line: 0 }] };
    render(<ImportReview fileName="a.pdf" lines={LINES} draft={about} onCancel={() => undefined} onSave={() => undefined} />);
    expect(document.querySelector('legend')!.textContent).toBe('About me');
  });

  it('says where a place belongs when it is not the address', () => {
    const lines = [{ text: '籍贯：四川成都', cells: ['籍贯：四川成都'], page: 1, fontSize: 0 }];
    const native: Draft = { locale: 'zh-CN', fields: [{ path: 'basics.nativePlace.city', value: '成都', certainty: 'check', line: 0 }] };
    render(<ImportReview fileName="a.pdf" lines={lines} draft={native} onCancel={() => undefined} onSave={() => undefined} />);
    expect(document.querySelector('[data-path="basics.nativePlace.city"] label')!.textContent).toBe('Native place');
  });
});

describe('uploading from the options page', () => {
  const existing = ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: 'Old', locale: 'en-AU', contact: { email: 'old@example.com' } })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'en' },
  });

  async function upload(name = 'mine.pdf') {
    await saveProfile(existing);
    render(<App autosaveDelayMs={20} />);
    await screen.findByRole('tab', { name: /Editor/ });
    const before = JSON.stringify(await loadProfile());
    fireEvent.change(screen.getByLabelText(/upload a resume/i), { target: { files: [new File(['x'], name, { type: 'application/pdf' })] } });
    return before;
  }

  it('cancelling writes nothing at all', async () => {
    read.result = { ok: true, lines: LINES, pages: 1, draft: DRAFT };
    const before = await upload();
    await screen.findByRole('region', { name: /what the file says/i });
    expect(JSON.stringify(await loadProfile())).toBe(before);
    expect(await listFiles()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /what the file says/i })).toBeNull());
    expect(JSON.stringify(await loadProfile())).toBe(before);
    expect(await listFiles()).toEqual([]);
  });

  it('saving adds a new active resume, keeps the file with it, and leaves the old one alone', async () => {
    read.result = { ok: true, lines: LINES, pages: 1 };
    await upload();
    await screen.findByRole('region', { name: /what the file says/i });
    fireEvent.click(screen.getByRole('button', { name: /save as a new resume/i }));
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(2), { timeout: 4000 });
    const profile = await loadProfile();
    const old = profile.resumes.find((r) => r.id === 'r1')!;
    const added = profile.resumes.find((r) => r.id !== 'r1')!;
    expect(old.contact.email).toBe('old@example.com');
    expect(profile.activeResumeId).toBe(added.id);
    expect(added.attachments.resumeFileId).toBeTruthy();
    expect((await getFile(added.attachments.resumeFileId!))?.name).toBe('mine.pdf');
  });

  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const choose = (name: string) =>
    fireEvent.change(screen.getByLabelText(/upload a resume/i), { target: { files: [new File(['x'], name, { type: 'application/pdf' })] } });
  const review = () => screen.findByRole('region', { name: /what the file says/i });
  const box = (path: string) => within(document.querySelector(`[data-path="${path}"]`)!).getByRole('textbox') as HTMLInputElement;

  it('checks the file chosen last, whichever finishes first', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    read.result = first.promise;
    await upload('first.pdf');
    read.result = second.promise;
    choose('second.pdf');
    second.resolve({ ok: true, lines: LINES, pages: 1 });
    expect(await screen.findByText(/second\.pdf/)).toBeTruthy();
    first.resolve({ ok: true, lines: LINES, pages: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/second\.pdf/)).toBeTruthy();
    expect(screen.queryByText(/first\.pdf/)).toBeNull();
  });

  it('starts over when another file is chosen, with nothing typed for the first one carried across', async () => {
    read.result = { ok: true, lines: ['Mia Harper', 'mia.harper@example.com'].map((text) => ({ text, cells: [text], page: 1, fontSize: 0 })), pages: 1 };
    await upload('first.pdf');
    await review();
    fireEvent.change(box('contact.email'), { target: { value: 'typed@example.com' } });
    choose('second.pdf');
    await screen.findByText(/second\.pdf/);
    expect(box('contact.email').value).toBe('mia.harper@example.com');
    expect((screen.getByLabelText(/resume name/i) as HTMLInputElement).value).toBe('second');
  });

  it('keeps a file chosen while another is being saved', async () => {
    const hold = deferred<void>();
    read.result = { ok: true, lines: LINES, pages: 1 };
    await upload('first.pdf');
    await review();
    disk.hold = hold.promise;
    fireEvent.click(screen.getByRole('button', { name: /save as a new resume/i }));
    choose('second.pdf');
    await screen.findByText(/second\.pdf/);
    disk.hold = null;
    hold.resolve();
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(2), { timeout: 4000 });
    expect(screen.getByText(/second\.pdf/)).toBeTruthy();
    expect((await loadProfile()).resumes.map((r) => r.title)).toContain('first');
  });

  it('says so when the file cannot be stored, and lets the save be tried again', async () => {
    read.result = { ok: true, lines: LINES, pages: 1 };
    const before = await upload();
    await review();
    disk.fail = true;
    fireEvent.click(screen.getByRole('button', { name: /save as a new resume/i }));
    expect(await screen.findByText(/could not be saved/i)).toBeTruthy();
    expect(JSON.stringify(await loadProfile())).toBe(before);
    const save = screen.getByRole('button', { name: /save as a new resume/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    disk.fail = false;
    fireEvent.click(save);
    await waitFor(async () => expect((await loadProfile()).resumes).toHaveLength(2), { timeout: 4000 });
    expect(screen.queryByText(/could not be saved/i)).toBeNull();
  });

  it('stays on the page and stores nothing when what was typed is not valid', async () => {
    read.result = { ok: true, lines: ['Mia Harper', 'Experience', 'Fictional Studio 2020-02 - Present'].map((text) => ({ text, cells: [text], page: 1, fontSize: 0 })), pages: 1 };
    const before = await upload();
    await review();
    fireEvent.change(box('work.0.startDate'), { target: { value: 'not a date' } });
    fireEvent.click(screen.getByRole('button', { name: /save as a new resume/i }));
    await screen.findByRole('alert');
    await review();
    expect(document.querySelector('[data-path="work.0.startDate"] [aria-invalid="true"]')).toBeTruthy();
    expect(await listFiles()).toEqual([]);
    expect(JSON.stringify(await loadProfile())).toBe(before);
    const save = screen.getByRole('button', { name: /save as a new resume/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('remembers what was typed when another tab is looked at', async () => {
    read.result = { ok: true, lines: ['Mia Harper', 'mia.harper@example.com'].map((text) => ({ text, cells: [text], page: 1, fontSize: 0 })), pages: 1 };
    await upload();
    await review();
    fireEvent.change(screen.getByLabelText(/resume name/i), { target: { value: 'For the studio' } });
    fireEvent.change(box('contact.email'), { target: { value: 'typed@example.com' } });
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.queryByRole('region', { name: /what the file says/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /editor/i }));
    await review();
    expect(box('contact.email').value).toBe('typed@example.com');
    expect((screen.getByLabelText(/resume name/i) as HTMLInputElement).value).toBe('For the studio');
  });

  it('shows no identity number, and no more of a file than it reads', async () => {
    const many = ['Mia Harper', 'Passport: E12345678', ...Array.from({ length: 100_000 }, (_, i) => `Line ${i}`)];
    read.result = { ok: true, lines: many.map((text) => ({ text, cells: [text], page: 1, fontSize: 0 })), pages: 1 };
    await upload();
    const source = await review();
    // Folded until asked for, and it says why.
    expect(source.textContent).not.toContain('Mia Harper');
    expect(source.textContent).toMatch(/passport or ID number/i);
    expect(screen.getByRole('button', { name: /show the file text/i }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /show the file text/i }));
    expect(screen.getByRole('button', { name: /hide the file text/i }).getAttribute('aria-expanded')).toBe('true');
    expect(source.textContent).toContain('Mia Harper');
    expect(source.textContent).not.toContain('E12345678');
    expect(source.querySelectorAll('li').length).toBeLessThanOrEqual(2000);
  });

  it.each([
    ['encrypted', /password/i],
    ['no_text', /no text/i],
    ['unsupported', /\.docx/i],
    ['too_large', /10 MB/i],
    ['failed', /could not be read/i],
  ])('says why a file cannot be read: %s', async (reason, message) => {
    read.result = { ok: false, reason };
    const before = await upload();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(JSON.stringify(await loadProfile())).toBe(before);
  });
});
