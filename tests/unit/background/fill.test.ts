import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadAttachmentFiles, runFillRequest, type FramePayload } from '../../../src/background/fill';
import { loadReport } from '../../../src/background/tabState';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { emptyCounts } from '../../../src/fill/report';
import { createSampleProfile } from '../../../src/schema';
import { putFile, resetFileStoreForTests, saveProfile } from '../../../src/storage';
import { seedSamplesIfEmpty } from '../../../src/background/seed';
import { buildResumeSubset } from '../../../src/background/subset';
import { emptyNeeds, type FrameNeeds } from '../../../src/engine/fieldDeps';

const row = (fieldId: string, outcome: FieldReport['outcome']): FieldReport => ({
  fieldId, label: fieldId, fieldKey: null, section: null, outcome, confidence: 1,
});
const report = (url: string, fields: FieldReport[]): FillReport => ({
  url, startedAt: 1, finishedAt: 2, fields, counts: emptyCounts(),
});

/** Every frame recognises one field. */
const sendNeeds = async () => ({ fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] });

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  vi.restoreAllMocks();
});

describe('runFillRequest', () => {
  it('answers no_resume when there is no active resume (and does not message any frame)', async () => {
    const sendFill = vi.fn();
    expect(await runFillRequest(1, { sendNeeds, sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'no_resume' });
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

    const res = await runFillRequest(7, { sendNeeds, sendFill, listFrameIds: async () => [0, 3] });

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

    expect(await runFillRequest(3, { sendNeeds, sendFill, listFrameIds: async () => [0, 2, 4] })).toEqual({ ok: true });
    expect((await loadReport(3))?.fields.map((f) => f.frameId)).toEqual([0, 4]);
  });

  it('answers no_frames (and stores nothing) when no frame answers', async () => {
    await seedSamplesIfEmpty();
    const sendFill = async () => {
      throw new Error('no receiver');
    };
    expect(await runFillRequest(3, { sendNeeds, sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'no_frames' });
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
    const first = runFillRequest(5, { sendNeeds, sendFill, listFrameIds: async () => [0] });
    await new Promise((r) => setTimeout(r, 5));
    expect(await runFillRequest(5, { sendNeeds, sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'busy' });
    release();
    expect(await first).toEqual({ ok: true });
    // and the tab is free again
    expect((await runFillRequest(5, { sendNeeds, sendFill, listFrameIds: async () => [0] })).ok).toBe(true);
  });

  it('turns a frame that never answers into a skip after the timeout', async () => {
    await seedSamplesIfEmpty();
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
    const sendFill = (_t: number, frameId: number) =>
      frameId === 0 ? new Promise<never>(() => undefined) : Promise.resolve(report('sub', [row('c1', 'filled')]));
    const res = await runFillRequest(8, { sendNeeds, sendFill, listFrameIds: async () => [0, 1], timeoutMs: 20 });
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

describe('data minimisation (frame:needs → frame:fill)', () => {
  const EMAIL = 'zhiyuan.lin@example.com';
  const needs = (p: Partial<FrameNeeds>): FrameNeeds => ({ ...emptyNeeds(), ...p });

  interface Sent {
    frameId: number | undefined;
    msg: { type: string; [k: string]: unknown };
  }

  /** Records every tabs.sendMessage; `needsByFrame` answers frame:needs (missing entry = no content script). */
  function stubFrames(needsByFrame: Record<number, FrameNeeds>): Sent[] {
    const sent: Sent[] = [];
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation((async (
      _tabId: number,
      msg: Sent['msg'],
      opts?: { frameId?: number },
    ) => {
      sent.push({ frameId: opts?.frameId, msg: structuredClone(msg) });
      if (msg.type === 'frame:needs') {
        const n = needsByFrame[opts?.frameId ?? -1];
        if (!n) throw new Error('Receiving end does not exist');
        return n;
      }
      if (msg.type === 'frame:fill') return report(`https://f/${opts?.frameId}`, [row('c1', 'filled')]);
      return undefined;
    }) as never);
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
    return sent;
  }

  const to = (sent: Sent[], frameId: number) => sent.filter((s) => s.frameId === frameId);
  const fills = (sent: Sent[]) => sent.filter((s) => s.msg.type === 'frame:fill');

  it('(a) a frame whose needs are empty gets only frame:needs: no frame:fill, no resume, no attachment bytes', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: needs({ fieldKeys: ['contact.email'] }), 1: emptyNeeds() });

    expect(await runFillRequest(9, { listFrameIds: async () => [0, 1] })).toEqual({ ok: true });

    // frame 1 saw exactly one message, and it carried nothing but its type
    expect(to(sent, 1).map((s) => s.msg)).toEqual([{ type: 'frame:needs' }]);
    // nothing sent anywhere carries data meant for the empty frame; check every recorded payload
    for (const s of sent) {
      const json = JSON.stringify(s.msg);
      if (s.msg.type === 'frame:needs') expect(json).toBe('{"type":"frame:needs"}');
      if (s.frameId === 1) {
        expect(json).not.toContain(EMAIL);
        expect(json).not.toContain('林');
        expect(json).not.toContain('data:');
      }
    }
    expect(fills(sent).map((s) => s.frameId)).toEqual([0]);
  });

  it('frames without a content script are skipped without any frame:fill either', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: needs({ fieldKeys: ['contact.email'] }) });
    expect(await runFillRequest(9, { listFrameIds: async () => [0, 4] })).toEqual({ ok: true });
    expect(to(sent, 4).map((s) => s.msg.type)).toEqual(['frame:needs']);
  });

  it('when no frame has anything to fill nothing is sent but frame:needs, and the run reports no_frames', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: emptyNeeds(), 2: emptyNeeds() });
    expect(await runFillRequest(9, { listFrameIds: async () => [0, 2] })).toEqual({ ok: false, error: 'no_frames' });
    expect(sent.map((s) => s.msg.type)).toEqual(['frame:needs', 'frame:needs']);
    expect(await loadReport(9)).toBeNull();
  });

  it('(b) a frame needing only contact.email gets a resume with just that leaf and no files', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: needs({ fieldKeys: ['contact.email'] }) });
    await runFillRequest(9, { listFrameIds: async () => [0] });

    const [fill] = fills(sent);
    const resume = fill!.msg.resume as ReturnType<typeof buildResumeSubset>;
    expect(fill!.msg.files).toEqual({});
    expect(resume.contact.email).toBe(EMAIL);
    expect(resume.attachments).toEqual({});
    expect({ ...resume, contact: { ...resume.contact, email: '' } }).toEqual(
      buildResumeSubset(resume, emptyNeeds()),
    );
    const json = JSON.stringify(fill!.msg);
    for (const secret of ['13800138000', '110101200203150019', '浙江大学', '腾讯', '林建国', 'data:']) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it('(c) attachment bytes go only to the frame with a matching upload control, and only the requested file', async () => {
    await seedSamplesIfEmpty(); // sample-zh: resume + photo files stored
    const sent = stubFrames({
      0: needs({ fieldKeys: ['contact.email'] }),
      1: needs({ fieldKeys: ['basics.fullName'], attachmentKeys: ['attachments.resume'] }),
      2: needs({ fieldKeys: ['contact.phone'] }),
    });
    await runFillRequest(9, { listFrameIds: async () => [0, 1, 2] });

    const fillOf = (frameId: number) => fills(sent).find((s) => s.frameId === frameId)!.msg;
    expect(Object.keys(fillOf(1).files as object)).toEqual(['sample-resume-zh']);
    expect((fillOf(1).resume as { attachments: object }).attachments).toEqual({ resumeFileId: 'sample-resume-zh' });
    expect(fillOf(0).files).toEqual({});
    expect(fillOf(2).files).toEqual({});
    for (const s of sent) {
      const json = JSON.stringify(s.msg);
      if (s.msg.type === 'frame:fill' && s.frameId !== 1) expect(json).not.toContain('data:application/pdf');
      expect(json, 'the photo was never requested').not.toContain('data:image/png');
      expect(json, 'its id is not shared either').not.toContain('sample-photo');
    }
  });

  it('(d) derived keys pull their sources into the frame resume', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: needs({ fieldKeys: ['basics.fullName', 'basics.age'] }) });
    await runFillRequest(9, { listFrameIds: async () => [0] });
    const resume = fills(sent)[0]!.msg.resume as ReturnType<typeof buildResumeSubset>;
    expect([resume.basics.familyName, resume.basics.givenName, resume.basics.birthDate]).toEqual(['林', '知远', '2002-03-15']);
    expect(resume.basics.idNumber).toBe('');
  });

  it('(e) a frame with a repeated section gets every entry of that module (count preserved), nothing of the others', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: needs({ fieldKeys: ['education.school'], repeatSections: ['education'] }) });
    await runFillRequest(9, { listFrameIds: async () => [0] });
    const resume = fills(sent)[0]!.msg.resume as ReturnType<typeof buildResumeSubset>;
    expect(resume.education.map((e) => e.school)).toEqual(['浙江大学', '澳大利亚国立大学']);
    expect(resume.work).toEqual([]);
    expect(resume.family).toEqual([]);
    expect(resume.basics.givenName).toBe('');
  });

  it('keeps the same runId for all frames and sends frame:needs before the frame:fill of the same frame', async () => {
    await seedSamplesIfEmpty();
    const sent = stubFrames({ 0: needs({ fieldKeys: ['contact.email'] }), 1: needs({ fieldKeys: ['contact.phone'] }) });
    await runFillRequest(9, { listFrameIds: async () => [0, 1] });
    expect(sent.map((s) => `${s.msg.type}@${s.frameId}`).filter((t) => !t.startsWith('report:'))).toEqual([
      'frame:needs@0', 'frame:fill@0', 'frame:needs@1', 'frame:fill@1',
    ]);
    const ids = fills(sent).map((s) => s.msg.runId);
    expect(new Set(ids).size).toBe(1);
  });

  it('a malformed needs answer skips the frame; a frame that never answers is skipped after the needs timeout', async () => {
    await seedSamplesIfEmpty();
    const sent: number[] = [];
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation((async (_t: number, msg: { type: string }, o?: { frameId?: number }) => {
      if (msg.type === 'frame:needs') {
        if (o?.frameId === 0) return { nonsense: true };
        if (o?.frameId === 1) return new Promise(() => undefined);
        return needs({ fieldKeys: ['contact.email'] });
      }
      if (msg.type === 'frame:fill') sent.push(o?.frameId ?? -1);
      return report('u', [row('c1', 'filled')]);
    }) as never);
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    expect(await runFillRequest(9, { listFrameIds: async () => [0, 1, 2], needsTimeoutMs: 20 })).toEqual({ ok: true });
    expect(sent).toEqual([2]);
  });
});

describe('loadAttachmentFiles by key', () => {
  it('loads only the files of the given attachment keys', async () => {
    const profile = createSampleProfile();
    const resume = { ...profile.resumes[0]!, attachments: { resumeFileId: 'a', photoFileId: 'b' } };
    await putFile({ id: 'a', name: 'cv.pdf', type: 'application/pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) });
    await putFile({ id: 'b', name: 'me.png', type: 'image/png', blob: new Blob(['png'], { type: 'image/png' }) });
    expect(Object.keys(await loadAttachmentFiles(resume, ['attachments.photo']))).toEqual(['b']);
    expect(await loadAttachmentFiles(resume, [])).toEqual({});
  });
});