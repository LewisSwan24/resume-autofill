// Per-tab state in `storage.session` (trusted contexts only; survives service worker restarts):
//   report:<tabId> → merged FillReport        scan:<tabId> → { [frameId]: fillable count }
import { browser } from 'wxt/browser';
import type { FieldReport, FillPreview, FillReport } from '../engine/types';
import { isFillPreview, isFillReport, patchReportField } from './merge';

export const reportKey = (tabId: number): string => `report:${tabId}`;
export const previewKey = (tabId: number): string => `preview:${tabId}`;
export const scanKey = (tabId: number): string => `scan:${tabId}`;

/** Serialises read-modify-write sequences (the worker is single-threaded, awaits interleave). */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// ------------------------------------------------------------------ reports

export async function loadReport(tabId: number): Promise<FillReport | null> {
  const key = reportKey(tabId);
  const stored = await browser.storage.session.get(key);
  const value: unknown = stored[key];
  return isFillReport(value) ? value : null;
}

export function saveReport(tabId: number, report: FillReport): Promise<void> {
  return exclusive(() => browser.storage.session.set({ [reportKey(tabId)]: report }));
}

export async function loadPreview(tabId: number): Promise<FillPreview | null> {
  const key = previewKey(tabId);
  const stored = await browser.storage.session.get(key);
  const value: unknown = stored[key];
  return isFillPreview(value) ? value : null;
}

export function savePreview(tabId: number, preview: FillPreview): Promise<void> {
  return exclusive(() => browser.storage.session.set({ [previewKey(tabId)]: preview }));
}

export function clearPreview(tabId: number): Promise<void> {
  return exclusive(() => browser.storage.session.remove(previewKey(tabId)));
}

/** Patch one row of the stored report. Resolves to the new report, or null when nothing is stored / the row is unknown. */
export function patchStoredField(tabId: number, frameId: number, field: FieldReport): Promise<FillReport | null> {
  return exclusive(async () => {
    const current = await loadReport(tabId);
    if (!current) return null;
    const next = patchReportField(current, frameId, field);
    if (next === current) return null;
    await browser.storage.session.set({ [reportKey(tabId)]: next });
    return next;
  });
}

// ------------------------------------------------------------------ scan totals

type FrameCounts = Record<string, number>;

/** Record the fillable-control count of one frame; resolves to the tab's total over all frames. */
export function recordScan(tabId: number, frameId: number, count: number): Promise<number> {
  return exclusive(async () => {
    const key = scanKey(tabId);
    const stored = await browser.storage.session.get(key);
    const raw: unknown = stored[key];
    const counts: FrameCounts = typeof raw === 'object' && raw !== null ? { ...(raw as FrameCounts) } : {};
    counts[String(frameId)] = count;
    await browser.storage.session.set({ [key]: counts });
    return Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  });
}

/** Total fillable-control count over all frames of the tab (0 when nothing was scanned yet). */
export async function loadScanTotal(tabId: number): Promise<number> {
  const key = scanKey(tabId);
  const raw: unknown = (await browser.storage.session.get(key))[key];
  if (typeof raw !== 'object' || raw === null) return 0;
  return Object.values(raw as FrameCounts).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
}

/** Forget scan counts and the report of a tab (navigation / tab closed). */
export function clearTabState(tabId: number, opts: { keepReport?: boolean } = {}): Promise<void> {
  return exclusive(async () => {
    const keys = opts.keepReport ? [scanKey(tabId), previewKey(tabId)] : [scanKey(tabId), reportKey(tabId), previewKey(tabId)];
    await browser.storage.session.remove(keys);
  });
}
