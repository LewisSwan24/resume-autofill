// The side panel's own fills, seen from the background: one box by a chosen key gets only that key's data, and a
// retry asks only the frames with boxes to retry, for only those boxes, and changes only their rows.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { fillOneRequest, retryRequest, type FramePayload } from '../../../src/background/fill';
import { loadReport, saveReport } from '../../../src/background/tabState';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { countOutcomes } from '../../../src/fill/report';
import { seedSamplesIfEmpty } from '../../../src/background/seed';
import { resetFileStoreForTests } from '../../../src/storage';

const row = (fieldId: string, outcome: FieldReport['outcome'], frameId = 0): FieldReport => ({
  fieldId, label: fieldId, fieldKey: null, section: null, outcome, confidence: 1, frameId,
});
const report = (fields: FieldReport[]): FillReport => ({
  url: 'https://jobs.example/apply', startedAt: 1, finishedAt: 2, fields, counts: countOutcomes(fields),
});

beforeEach(async () => {
  fakeBrowser.reset();
  await resetFileStoreForTests();
  vi.restoreAllMocks();
  await seedSamplesIfEmpty();
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
});

describe('fillOneRequest', () => {
  it('sends the frame only the chosen key’s data and patches the stored row', async () => {
    await saveReport(4, report([row('c1', 'filled'), row('c2', 'needs_review')]));
    const sendFillOne = vi.fn(async (_tab: number, _frame: number, msg: { fieldId: string; fieldKey: string; resume: FramePayload['resume'] }) => ({
      ...row(msg.fieldId, 'filled'), fieldKey: msg.fieldKey, value: msg.resume.contact.email,
    }));

    const field = await fillOneRequest({ tabId: 4, frameId: 0, fieldId: 'c2', fieldKey: 'contact.email' }, { sendFillOne });

    const msg = sendFillOne.mock.calls[0]![2];
    expect(msg.resume.contact.email).toContain('@');
    expect(msg.resume.contact.phone).toBe('');
    expect(msg.resume.education).toEqual([]);
    expect(field).toMatchObject({ fieldId: 'c2', outcome: 'filled', fieldKey: 'contact.email', frameId: 0 });
    const stored = await loadReport(4);
    expect(stored?.fields.map((f) => f.outcome)).toEqual(['filled', 'filled']);
    expect(stored?.counts.filled).toBe(2);
  });

  it('answers null for a key it does not know, without asking the frame', async () => {
    const sendFillOne = vi.fn();
    expect(await fillOneRequest({ tabId: 4, frameId: 0, fieldId: 'c2', fieldKey: 'not.a.key' }, { sendFillOne })).toBeNull();
    expect(sendFillOne).not.toHaveBeenCalled();
  });
});

describe('retryRequest', () => {
  it('asks only the frames with failed or unrecognised boxes, for only those, and patches their rows', async () => {
    await saveReport(5, report([
      row('c1', 'filled'), row('c2', 'action_failed'), row('c3', 'unmatched'), row('c4', 'no_data'),
      row('c1', 'filled', 2), row('section:education', 'action_failed'),
    ]));
    const asked: { frameId: number; only?: string[] }[] = [];
    const sendFill = vi.fn(async (_tab: number, frameId: number, p: FramePayload) => {
      asked.push({ frameId, ...(p.filter?.onlyFieldIds ? { only: p.filter.onlyFieldIds } : {}) });
      return { ...report([row('c2', 'filled'), row('c3', 'unmatched')]), url: 'https://jobs.example/apply' };
    });
    const sendNeeds = async () => ({ fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] });

    expect(await retryRequest(5, { sendFill, sendNeeds, listFrameIds: async () => [0, 2] })).toEqual({ ok: true });

    expect(asked).toEqual([{ frameId: 0, only: ['c2', 'c3'] }]);
    const stored = await loadReport(5);
    expect(stored?.fields.map((f) => `${f.frameId}:${f.fieldId}:${f.outcome}`)).toEqual([
      '0:c1:filled', '0:c2:filled', '0:c3:unmatched', '0:c4:no_data', '2:c1:filled', '0:section:education:action_failed',
    ]);
    expect(stored?.counts.filled).toBe(3);
  });

  it('answers nothing_to_retry when no row failed', async () => {
    await saveReport(6, report([row('c1', 'filled')]));
    const sendFill = vi.fn();
    expect(await retryRequest(6, { sendFill, listFrameIds: async () => [0] })).toEqual({ ok: false, error: 'nothing_to_retry' });
    expect(sendFill).not.toHaveBeenCalled();
  });
});
