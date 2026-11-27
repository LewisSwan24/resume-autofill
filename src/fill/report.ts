// Report helpers: outcome counts and label selection.
import { OUTCOMES, type Evidence, type FieldReport, type FillTiming, type Outcome } from '../engine/types';

export function emptyCounts(): Record<Outcome, number> {
  return Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
}

/** Number of fields per outcome (every outcome is present, zero included). */
export function countOutcomes(fields: readonly Pick<FieldReport, 'outcome'>[]): Record<Outcome, number> {
  const counts = emptyCounts();
  for (const f of fields) counts[f.outcome] += 1;
  return counts;
}

export const emptyTiming = (): FillTiming => ({ cards: 0, scan: 0, uploadWait: 0, steps: 0, editors: 0 });

/** Two timings added phase by phase (frames of one tab, steps of one form). */
export function addTimings(a: FillTiming, b: FillTiming | undefined): FillTiming {
  if (!b) return a;
  return { cards: a.cards + b.cards, scan: a.scan + b.scan, uploadWait: a.uploadWait + b.uploadWait, steps: a.steps + b.steps, editors: a.editors + b.editors };
}

/** Text a user would recognise the field by: the strongest evidence, or the control id as a last resort. */
export function bestLabel(evidence: readonly Evidence[], fallback = ''): string {
  return evidence[0]?.text.trim() || fallback;
}

/** Label shortened for a report row. */
export function shortLabel(label: string, max = 60): string {
  const t = label.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const RETRIED: ReadonlySet<Outcome> = new Set<Outcome>(['action_failed', 'no_option', 'unmatched']);

/** A box a retry fills again: it failed, had no option to pick, or was not recognised. A section row is not a box. */
export const isRetryable = (f: Pick<FieldReport, 'outcome' | 'fieldId'>): boolean =>
  RETRIED.has(f.outcome) && !f.fieldId.startsWith('section:');

/** A box the fill left because it held an answer of the applicant's own: one the resume's can be written over. */
export const isHeldAnswer = (f: Pick<FieldReport, 'note' | 'fieldKey'>): boolean => f.note === 'answer_held' && f.fieldKey !== null;

/** Fields the user should look at: anything that is neither filled nor deliberately empty. */
export function needsAttention(fields: readonly Pick<FieldReport, 'outcome'>[]): number {
  return fields.filter((f) => f.outcome !== 'filled' && f.outcome !== 'no_data').length;
}
