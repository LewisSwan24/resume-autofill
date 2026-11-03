// Pure helpers for the side panel: filtering, sorting, formatting. No browser or React imports.
import type { FieldReport, FillReport, Outcome } from '../../src/engine/types';

/** Outcomes from most to least urgent for the user. Also the display order of the filter chips. */
export const OUTCOME_ORDER: readonly Outcome[] = [
  'action_failed',
  'needs_review',
  'no_option',
  'unmatched',
  'no_data',
  'no_control',
  'filled',
];

export type Tone = 'success' | 'warning' | 'danger' | 'muted';

const TONES: Record<Outcome, Tone> = {
  filled: 'success',
  needs_review: 'warning',
  no_option: 'warning',
  unmatched: 'danger',
  action_failed: 'danger',
  no_data: 'muted',
  no_control: 'muted',
};

/** Status chip colour family of an outcome. */
export const outcomeTone = (outcome: Outcome): Tone => TONES[outcome];

/** Lower = more severe. */
export function severity(outcome: Outcome): number {
  const index = OUTCOME_ORDER.indexOf(outcome);
  return index < 0 ? OUTCOME_ORDER.length : index;
}

/** Stable sort by outcome severity (most urgent first); ties keep report order. Does not mutate. */
export function sortBySeverity<T extends { outcome: Outcome }>(fields: readonly T[]): T[] {
  return fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => severity(a.field.outcome) - severity(b.field.outcome) || a.index - b.index)
    .map((entry) => entry.field);
}

/** Keep fields whose outcome is selected. An empty selection means "no filter". */
export function filterByOutcomes<T extends { outcome: Outcome }>(
  fields: readonly T[],
  selected: ReadonlySet<Outcome>,
): T[] {
  return selected.size === 0 ? [...fields] : fields.filter((f) => selected.has(f.outcome));
}

/** Toggle one outcome in the selection (returns a new set). */
export function toggleOutcome(selected: ReadonlySet<Outcome>, outcome: Outcome): Set<Outcome> {
  const next = new Set(selected);
  if (!next.delete(outcome)) next.add(outcome);
  return next;
}

/** Count fields per outcome, computed from the fields themselves (not trusted from `report.counts`). */
export function countOutcomes(fields: readonly { outcome: Outcome }[]): Record<Outcome, number> {
  const counts = Object.fromEntries(OUTCOME_ORDER.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const field of fields) counts[field.outcome] += 1;
  return counts;
}

/** Confidence 0..1 → "85%". Clamped; non-finite values render as an em dash. */
export function formatConfidence(confidence: number | null | undefined): string {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return '—';
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

/** The value shown in the table: what we intended to write, else what was read back, else ''. */
export function displayValue(field: Pick<FieldReport, 'value' | 'observed'>): string {
  return field.value || field.observed || '';
}

/** Rows that offer "Use" buttons for candidate options. */
export function hasCandidateChoices(field: FieldReport): boolean {
  return (
    (field.outcome === 'needs_review' || field.outcome === 'no_option') &&
    (field.candidates ?? []).some((c) => c.label.trim() !== '')
  );
}

/** Stable per-row key (field ids are only unique per frame). */
export const fieldKey = (field: Pick<FieldReport, 'fieldId' | 'frameId'>): string =>
  `${field.frameId ?? 0}:${field.fieldId}`;

/** Replace one field of a report (matched by frame + id), e.g. with the response of `field:apply`. */
export function patchReport(report: FillReport, updated: FieldReport): FillReport {
  const key = fieldKey(updated);
  const fields = report.fields.map((f) => (fieldKey(f) === key ? { ...f, ...updated, frameId: f.frameId ?? updated.frameId } : f));
  return { ...report, fields, counts: countOutcomes(fields) };
}

export const reportStorageKey = (tabId: number): string => `report:${tabId}`;

/** `?tabId=<n>` page-URL override (tests / e2e, where the panel is opened as a normal tab). */
export function parseTabIdOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Structural check for a value read from `storage.session` (it may be missing or from an older build). */
export function isFillReport(value: unknown): value is FillReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as { fields?: unknown };
  return Array.isArray(report.fields);
}
