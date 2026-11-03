// Report helpers: outcome counts and label selection.
import { OUTCOMES, type Evidence, type FieldReport, type Outcome } from '../engine/types';

export function emptyCounts(): Record<Outcome, number> {
  return Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
}

/** Number of fields per outcome (every outcome is present, zero included). */
export function countOutcomes(fields: readonly Pick<FieldReport, 'outcome'>[]): Record<Outcome, number> {
  const counts = emptyCounts();
  for (const f of fields) counts[f.outcome] += 1;
  return counts;
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

/** Fields the user should look at: anything that is neither filled nor deliberately empty. */
export function needsAttention(fields: readonly Pick<FieldReport, 'outcome'>[]): number {
  return fields.filter((f) => f.outcome !== 'filled' && f.outcome !== 'no_data').length;
}
