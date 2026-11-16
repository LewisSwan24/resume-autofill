// Pure helpers: guards for frame responses, merging per-frame reports, patching one field.
import type { CardDemandSummary, FieldReport, FillPreview, FillReport, FramePreview, PreviewItem } from '../engine/types';
import { countOutcomes } from '../fill/report';

export interface FramePart {
  frameId: number;
  report: FillReport;
}

export interface FramePreviewPart {
  frameId: number;
  preview: FramePreview;
}

export function isFramePreview(x: unknown): x is FramePreview {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Partial<FramePreview>;
  return typeof p.url === 'string' && Array.isArray(p.items) && Array.isArray(p.cardDemand);
}

export function isFillPreview(x: unknown): x is FillPreview {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Partial<FillPreview>;
  return typeof p.tabId === 'number' && Array.isArray(p.items) && Array.isArray(p.cardDemand);
}

export function mergeFramePreviews(tabId: number, parts: readonly FramePreviewPart[]): FillPreview {
  const top = parts.find((p) => p.frameId === 0) ?? parts[0];
  const items: PreviewItem[] = parts.flatMap(({ frameId, preview }) =>
    preview.items.map((item) => ({ ...item, frameId })),
  );
  const cardMap = new Map<CardDemandSummary['section'], CardDemandSummary>();
  for (const { preview } of parts) {
    for (const d of preview.cardDemand) {
      const prev = cardMap.get(d.section);
      if (!prev || d.need - d.have > prev.need - prev.have) cardMap.set(d.section, d);
    }
  }
  const unresolvedCount = parts.reduce((sum, p) => sum + (p.preview.unresolvedCount ?? 0), 0);
  return {
    tabId,
    url: top?.preview.url ?? '',
    createdAt: Date.now(),
    items,
    cardDemand: [...cardMap.values()],
    unresolvedCount,
  };
}

export function isFieldReport(x: unknown): x is FieldReport {
  if (typeof x !== 'object' || x === null) return false;
  const f = x as Partial<FieldReport>;
  return typeof f.fieldId === 'string' && typeof f.outcome === 'string' && typeof f.label === 'string';
}

export function isFillReport(x: unknown): x is FillReport {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Partial<FillReport>;
  return Array.isArray(r.fields) && r.fields.every(isFieldReport);
}

/** Section-level rows (`section:<key>`, e.g. a failed "add card" click) have no control. */
export const isSectionRow = (fieldId: string): boolean => fieldId.startsWith('section:');

/**
 * Merge per-frame reports into one. Field ids are NOT prefixed: a field is identified by
 * `(frameId, fieldId)`. Parts keep the given order (top frame first); counts are recomputed.
 * `url` is the top frame's (else the first part's).
 */
export function mergeFrameReports(parts: readonly FramePart[]): FillReport {
  const top = parts.find((p) => p.frameId === 0) ?? parts[0];
  const fields: FieldReport[] = parts.flatMap(({ frameId, report }) =>
    report.fields.map((f) => ({ ...f, frameId })),
  );
  const startedAt = parts.length ? Math.min(...parts.map((p) => p.report.startedAt)) : Date.now();
  const finishedAt = parts.length ? Math.max(...parts.map((p) => p.report.finishedAt)) : startedAt;
  return { url: top?.report.url ?? '', startedAt, finishedAt, fields, counts: countOutcomes(fields) };
}

/** Does this stored row belong to (frameId, fieldId)? Rows without a frameId count as frame 0. */
export const sameField = (f: FieldReport, frameId: number, fieldId: string): boolean =>
  f.fieldId === fieldId && (f.frameId ?? 0) === frameId;

/**
 * Replace one row with the result of `field:apply`. The page's answer wins, except that an empty
 * label / missing key / section / source falls back to the stored row. Counts are recomputed.
 * Returns the same report object when the row is unknown.
 */
export function patchReportField(report: FillReport, frameId: number, updated: FieldReport): FillReport {
  if (!report.fields.some((f) => sameField(f, frameId, updated.fieldId))) return report;
  const fields = report.fields.map((f) => {
    if (!sameField(f, frameId, updated.fieldId)) return f;
    const next: FieldReport = {
      ...updated,
      frameId,
      label: updated.label || f.label,
      fieldKey: updated.fieldKey ?? f.fieldKey,
      section: updated.section ?? f.section,
    };
    const source = updated.source ?? f.source;
    if (source !== undefined) next.source = source;
    if (f.note && updated.outcome !== 'filled') next.note = f.note;
    return next;
  });
  return { ...report, fields, counts: countOutcomes(fields) };
}
