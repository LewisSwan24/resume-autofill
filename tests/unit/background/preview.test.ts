import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cancelPreviewRequest, commitPreviewRequest, runFillRequest, type FramePayload } from '../../../src/background/fill';
import { loadPreview, loadReport } from '../../../src/background/tabState';
import { createFrameHandlers } from '../../../src/content/handlers';
import { runFill, runPreview } from '../../../src/fill/runFill';
import { createSampleProfile } from '../../../src/schema';
import { putFile, resetFileStoreForTests, saveProfile } from '../../../src/storage';

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('previewBeforeFill zero-side-effect dry run and commit flow', () => {
  it('runPreview scans and plans values without modifying DOM inputs or clicking add buttons', () => {
    let added = 0;
    document.body.innerHTML = `
      <form>
        <h2>Education</h2>
        <label for="sc">School</label><input id="sc" type="text" />
        <button type="button" id="add-ed">Add Education</button>
        <label for="em">Email</label><input id="em" type="email" />
        <label for="cv">Resume</label><input id="cv" type="file" />
      </form>
    `;
    document.getElementById('add-ed')!.addEventListener('click', () => {
      added++;
    });

    const profile = createSampleProfile();
    profile.activeResumeId = 'sample-en';
    const resume = profile.resumes.find((r) => r.id === 'sample-en')!;

    const preview = runPreview(document, { resume, files: {} });
    expect(added).toBe(0);
    expect((document.getElementById('em') as HTMLInputElement).value).toBe('');
    expect(preview.items.some((i) => i.fieldKey === 'contact.email')).toBe(true);
    expect(preview.cardDemand.some((d) => d.section === 'education')).toBe(true);
  });

  it('stores preview in session storage with metadata-only attachments, then commits with exclusions & overrides', async () => {
    const profile = createSampleProfile();
    profile.activeResumeId = 'sample-en';
    profile.settings.previewBeforeFill = true;
    const resume = profile.resumes.find((r) => r.id === 'sample-en')!;
    const blob = new File(['%PDF-1.4 content'], 'cv.pdf', { type: 'application/pdf' });
    await putFile({ id: 'file-cv', name: 'cv.pdf', type: 'application/pdf', blob });
    resume.attachments.resumeFileId = 'file-cv';
    await saveProfile(profile);

    document.body.innerHTML = `
      <form>
        <label for="em">Email</label><input id="em" name="email" type="email" />
        <label for="gn">Given name</label><input id="gn" name="givenName" type="text" />
        <label for="up">Resume PDF</label><input id="up" name="resume" type="file" />
      </form>
    `;
    let seq = 0;
    const idFor = (el: HTMLElement) => {
      if (!el.dataset.rafId) el.dataset.rafId = `f${++seq}`;
      return el.dataset.rafId;
    };
    const handlers = createFrameHandlers({ doc: document, idFor });
    const previewPayloads: FramePayload[] = [];
    const fillPayloads: FramePayload[] = [];
    const sendNeeds = async () => handlers.needs();
    const sendPreview = async (_tabId: number, _frameId: number, payload: FramePayload) => {
      previewPayloads.push(payload);
      return handlers.preview(payload);
    };
    const sendFill = async (_tabId: number, _frameId: number, payload: FramePayload) => {
      fillPayloads.push(payload);
      return handlers.fill(payload);
    };
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined);

    const req = await runFillRequest(9, { listFrameIds: async () => [0], sendNeeds, sendPreview, sendFill });
    expect(req).toEqual({ ok: true, preview: true });
    expect(fillPayloads).toHaveLength(0);
    // Attachment binary payload must NOT be loaded during preview.
    expect(previewPayloads[0]!.files['file-cv']?.dataUrl).toBe('');

    const stored = await loadPreview(9);
    expect(stored).not.toBeNull();
    const emailItem = stored!.items.find((i) => i.fieldKey === 'contact.email')!;
    const nameItem = stored!.items.find((i) => i.fieldKey === 'basics.givenName')!;
    expect((document.getElementById('em') as HTMLInputElement).value).toBe('');

    const committed = await commitPreviewRequest(
      9,
      {
        excludedByFrame: { 0: [emailItem.fieldId] },
        overridesByFrame: { 0: { [nameItem.fieldId]: 'OverrideName' } },
      },
      { listFrameIds: async () => [0], sendNeeds, sendPreview, sendFill },
    );
    expect(committed).toEqual({ ok: true });
    expect(await loadPreview(9)).toBeNull();
    expect(await loadReport(9)).not.toBeNull();
    expect((document.getElementById('em') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('gn') as HTMLInputElement).value).toBe('OverrideName');
  });

  it('cancels preview cleanly and clears session storage', async () => {
    const profile = createSampleProfile();
    profile.activeResumeId = 'sample-en';
    profile.settings.previewBeforeFill = true;
    await saveProfile(profile);
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined);

    await runFillRequest(15, {
      listFrameIds: async () => [0],
      sendNeeds: async () => ({ fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] }),
      sendPreview: async () => ({
        url: 'https://example.com',
        items: [{ fieldId: 'c1', fieldKey: 'contact.email', label: 'Email', value: 'a@b.com', kind: 'text', confidence: 1, section: 'contact' }],
        cardDemand: [],
        unresolvedCount: 0,
      }),
    });
    expect(await loadPreview(15)).not.toBeNull();
    await cancelPreviewRequest(15);
    expect(await loadPreview(15)).toBeNull();
  });

  it('runFill respects direct filter overrides cleanly', async () => {
    document.body.innerHTML = '<form><label for="em">Email</label><input id="em" type="email" name="email" /><label for="gn">Given name</label><input id="gn" type="text" name="givenName" /></form>';
    const ids = new WeakMap<HTMLElement, string>();
    let n = 0;
    const idFor = (el: HTMLElement) => {
      let id = ids.get(el);
      if (!id) ids.set(el, (id = `c${++n}`));
      return id;
    };
    const resume = createSampleProfile().resumes.find((r) => r.id === 'sample-en')!;
    const scan = runPreview(document, { resume, files: {} }, { idFor });
    const id = scan.items[0]!.fieldId;
    const out = await runFill(document, { resume, files: {} }, { idFor, filter: { overrides: { [id]: 'custom@test.org' } } });
    expect(out.report.fields[0]?.observed).toBe('custom@test.org');
  });
});
