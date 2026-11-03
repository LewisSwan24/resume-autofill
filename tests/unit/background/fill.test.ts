import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadAttachmentFiles, runFillRequest, type FramePayload } from '../../../src/background/fill';
import { loadReport } from '../../../src/background/tabState';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { emptyCounts } from '../../../src/fill/report';
import { createSampleProfile } from '../../../src/schema';
import { putFile, resetFileStoreForTests, saveProfile } from '../../../src/storage';
import { seedSamplesIfEmpty } from '../../../src/background/seed';

const row = (fieldId: string, outcome: FieldReport['outcome']): FieldReport => ({
  fieldId, label: fieldId, fieldKey: null, section: null, outcome, confidence: 1,
});
const report = (url: string, fields: FieldReport[]): FillReport => ({
  url, startedAt: 1, finishedAt: 2, fields, counts: emptyCounts(),
});

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  vi.restoreAllMocks();
});

describe('runFillRequest', () => {
  it('answers no_resume when there is no active resume (and does not message any frame)', async () => {
    const sendFill = vi.fn();
    expect(await runFillRequest(1, { sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'no_resume' });
    expect(sendFill).not.toHaveBeenCalled();
  });

  it('fills frames sequentially, merges with frameId, stores the report and broadcasts it', async () => {
    await seedSamplesIfEmpty();
    const order: string[] = [];
    const sendFill = vi.fn(async (_tab: number, frameId: number, p: FramePayload) => {
      order.push(`start ${frameId}`);
      await new Promise((r) => setTimeout(r, frameId === 0 ? 15 : 0));
      order.push(`end ${frameId}`);
      expect(p.resume.id).toBeTruthy();
      return report(`https://f/${frameId}`, [row('c1', 'filled'), row('c2', 'unmatched')]);
    });
    const toTab = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
    const toRuntime = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    const res = await runFillRequest(7, { sendFill, listFrameIds: async () => [0, 3] });

    expect(res).toEqual({ ok: true });
    expect(order).toEqual(['start 0', 'end 0', 'start 3', 'end 3']);
    const stored = await loadReport(7);
    expect(stored?.fields.map((f) => [f.frameId, f.fieldId])).toEqual([[0, 'c1'], [0, 'c2'], [3, 'c1'], [3, 'c2']]);
    expect(stored?.counts).toMatchObject({ filled: 2, unmatched: 2 });
    expect(stored?.url).toBe('https://f/0');

    expect(toTab).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'report:updated', tabId: 7 }), { frameId: 0 });
    expect(toRuntime).toHaveBeenCalledWith(expect.objectContaining({ type: 'report:updated', tabId: 7, report: stored }));
  });

  it('skips frames without a content script and still reports the others', async () => {
    await seedSamplesIfEmpty();
    const sendFill = async (_t: number, frameId: number) => {
      if (frameId === 2) throw new Error('Receiving end does not exist');
      return report(`f${frameId}`, [row('c1', 'filled')]);
    };
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);

    expect(await runFillRequest(3, { sendFill, listFrameIds: async () => [0, 2, 4] })).toEqual({ ok: true });
    expect((await loadReport(3))?.fields.map((f) => f.frameId)).toEqual([0, 4]);
  });

  it('answers no_frames (and stores nothing) when no frame answers', async () => {
    await seedSamplesIfEmpty();
    const sendFill = async () => {
      throw new Error('no receiver');
    };
    expect(await runFillRequest(3, { sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'no_frames' });
    expect(await loadReport(3)).toBeNull();
  });

  it('rejects a second request for the same tab while one is running', async () => {
    await seedSamplesIfEmpty();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sendFill = async () => {
      await gate;
      return report('u', []);
    };
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
    const first = runFillRequest(5, { sendFill, listFrameIds: async () => [0] });
    await new Promise((r) => setTimeout(r, 5));
    expect(await runFillRequest(5, { sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'busy' });
    release();
    expect(await first).toEqual({ ok: true });
    // and the tab is free again
    expect((await runFillRequest(5, { sendFill, listFrameIds: async () => [0] })).ok).toBe(true);
  });

  it('turns a frame that never answers into a skip after the timeout', async () => {
    await seedSamplesIfEmpty();
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
    const sendFill = (_t: number, frameId: number) =>
      frameId === 0 ? new Promise<never>(() => undefined) : Promise.resolve(report('sub', [row('c1', 'filled')]));
    const res = await runFillRequest(8, { sendFill, listFrameIds: async () => [0, 1], timeoutMs: 20 });
    expect(res).toEqual({ ok: true });
    expect((await loadReport(8))?.fields.map((f) => f.frameId)).toEqual([1]);
  });
});

describe('loadAttachmentFiles', () => {
  it('returns data urls for the resume attachments, keyed by id, and ignores missing ones', async () => {
    const profile = createSampleProfile();
    const resume = {
      ...profile.resumes[0]!,
      attachments: { resumeFileId: 'f-resume', photoFileId: 'f-photo', transcriptFileId: 'gone' },
    };
    await putFile({ id: 'f-resume', name: 'cv.pdf', type: 'application/pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) });
    await putFile({ id: 'f-photo', name: 'me.png', type: 'image/png', blob: new Blob(['png'], { type: 'image/png' }) });
    await saveProfile({ ...profile, resumes: [resume], activeResumeId: resume.id });

    const files = await loadAttachmentFiles(resume);

    expect(Object.keys(files).sort()).toEqual(['f-photo', 'f-resume']);
    expect(files['f-resume']).toMatchObject({ name: 'cv.pdf', type: 'application/pdf' });
    expect(files['f-resume']!.dataUrl.startsWith('data:application/pdf;base64,')).toBe(true);
  });
});
