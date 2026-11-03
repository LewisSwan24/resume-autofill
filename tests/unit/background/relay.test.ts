import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { relayApply, relayFocus } from '../../../src/background/relay';
import { loadReport, saveReport } from '../../../src/background/tabState';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { emptyCounts } from '../../../src/fill/report';

const row = (fieldId: string, frameId: number, outcome: FieldReport['outcome'], extra: Partial<FieldReport> = {}): FieldReport => ({
  fieldId, frameId, label: `L-${fieldId}`, fieldKey: 'basics.gender', section: 'basics', outcome, confidence: 0.8, ...extra,
});
const stored: FillReport = {
  url: 'u', startedAt: 1, finishedAt: 2,
  fields: [row('c1', 0, 'needs_review', { candidates: [{ label: 'Male' }, { label: 'Man' }] }), row('c1', 6, 'unmatched')],
  counts: { ...emptyCounts(), needs_review: 1, unmatched: 1 },
};

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('relayFocus', () => {
  it('sends frame:focus to the owning frame of the tab', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await relayFocus(4, 6, 'c9', { send });
    expect(send).toHaveBeenCalledWith(4, 6, { type: 'frame:focus', fieldId: 'c9' });
  });

  it('ignores section rows (no control)', async () => {
    const send = vi.fn();
    await relayFocus(4, 0, 'section:education', { send });
    expect(send).not.toHaveBeenCalled();
  });

  it('defaults to tabs.sendMessage with the frame id', async () => {
    const spy = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
    await relayFocus(4, 2, 'c1');
    expect(spy).toHaveBeenCalledWith(4, { type: 'frame:focus', fieldId: 'c1' }, { frameId: 2 });
  });
});

describe('relayApply', () => {
  it('relays text / optionLabel, sets frameId and patches the stored report row of that frame', async () => {
    await saveReport(4, stored);
    const send = vi.fn().mockResolvedValue({
      fieldId: 'c1', label: '', fieldKey: null, section: null, outcome: 'filled', confidence: 0.8, value: 'Male', observed: 'Male',
    } satisfies FieldReport);

    const result = await relayApply({ tabId: 4, frameId: 6, fieldId: 'c1', optionLabel: 'Male' }, { send });

    expect(send).toHaveBeenCalledWith(4, 6, { type: 'frame:apply', fieldId: 'c1', optionLabel: 'Male' });
    expect(result).toMatchObject({ frameId: 6, outcome: 'filled', label: 'L-c1', fieldKey: 'basics.gender', value: 'Male' });

    const after = await loadReport(4);
    expect(after?.fields.map((f) => f.outcome)).toEqual(['needs_review', 'filled']); // frame 0 row untouched
    expect(after?.counts).toMatchObject({ needs_review: 1, filled: 1, unmatched: 0 });
  });

  it('relays free text without an optionLabel key', async () => {
    const send = vi.fn().mockResolvedValue(row('c1', 0, 'filled'));
    await relayApply({ tabId: 4, frameId: 0, fieldId: 'c1', text: 'hello' }, { send });
    expect(send).toHaveBeenCalledWith(4, 0, { type: 'frame:apply', fieldId: 'c1', text: 'hello' });
  });

  it('resolves null for section rows and malformed answers, and leaves the report alone', async () => {
    await saveReport(4, stored);
    const send = vi.fn().mockResolvedValue({ nonsense: true });
    expect(await relayApply({ tabId: 4, frameId: 0, fieldId: 'section:work', text: 'x' }, { send })).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(await relayApply({ tabId: 4, frameId: 0, fieldId: 'c1', text: 'x' }, { send })).toBeNull();
    expect(await loadReport(4)).toEqual(stored);
  });

  it('propagates a frame failure so the caller can answer', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
    await expect(relayApply({ tabId: 4, frameId: 0, fieldId: 'c1', text: 'x' }, { send })).rejects.toThrow();
  });

  it('still returns the answer when nothing is stored for the tab', async () => {
    const send = vi.fn().mockResolvedValue(row('c1', 0, 'filled'));
    expect(await relayApply({ tabId: 99, frameId: 0, fieldId: 'c1', text: 'x' }, { send })).toMatchObject({ outcome: 'filled', frameId: 0 });
  });
});
