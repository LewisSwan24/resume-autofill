import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { emptyCounts } from '../../../src/fill/report';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { clearTabState, loadReport, loadScanTotal, patchStoredField, recordScan, reportKey, saveReport } from '../../../src/background/tabState';

const row = (fieldId: string, frameId: number, outcome: FieldReport['outcome']): FieldReport => ({
  fieldId, frameId, label: fieldId, fieldKey: null, section: null, outcome, confidence: 1,
});
const report: FillReport = {
  url: 'u', startedAt: 1, finishedAt: 2,
  fields: [row('c1', 0, 'unmatched'), row('c1', 2, 'unmatched')],
  counts: { ...emptyCounts(), unmatched: 2 },
};

beforeEach(() => fakeBrowser.reset());

describe('recordScan', () => {
  it('sums the latest count per frame and keeps tabs separate', async () => {
    expect(await recordScan(1, 0, 3)).toBe(3);
    expect(await recordScan(1, 4, 2)).toBe(5);
    expect(await recordScan(1, 0, 6)).toBe(8); // a rescan replaces, not adds
    expect(await recordScan(2, 0, 1)).toBe(1);
  });

  it('is safe under concurrent calls', async () => {
    const totals = await Promise.all([recordScan(9, 0, 1), recordScan(9, 1, 1), recordScan(9, 2, 1)]);
    expect(Math.max(...totals)).toBe(3);
  });
});

describe('clearTabState', () => {
  it('forgets scan counts and the report of that tab only', async () => {
    await recordScan(1, 0, 3);
    await recordScan(2, 0, 4);
    await saveReport(1, report);
    await saveReport(2, report);
    await clearTabState(1);
    expect(await loadReport(1)).toBeNull();
    expect(await loadReport(2)).not.toBeNull();
    expect(await recordScan(1, 0, 1)).toBe(1);
    expect(await recordScan(2, 0, 1)).toBe(1);
  });
});

describe('patchStoredField', () => {
  it('writes the patched report under report:<tabId>', async () => {
    await saveReport(5, report);
    const next = await patchStoredField(5, 2, { ...row('c1', 2, 'filled'), value: 'v' });
    expect(next?.counts.filled).toBe(1);
    const stored = (await fakeBrowser.storage.session.get(reportKey(5)))[reportKey(5)] as FillReport;
    expect(stored.fields.map((f) => f.outcome)).toEqual(['unmatched', 'filled']);
  });

  it('is a no-op without a stored report or for an unknown row', async () => {
    expect(await patchStoredField(5, 0, row('c1', 0, 'filled'))).toBeNull();
    await saveReport(5, report);
    expect(await patchStoredField(5, 0, row('zzz', 0, 'filled'))).toBeNull();
  });
});

describe('loadScanTotal', () => {
  it('sums the frame counts of the tab and is 0 for an unscanned tab', async () => {
    fakeBrowser.reset();
    expect(await loadScanTotal(9)).toBe(0);
    await recordScan(9, 0, 3);
    await recordScan(9, 2, 4);
    expect(await loadScanTotal(9)).toBe(7);
    expect(await loadScanTotal(10)).toBe(0);
  });
});
