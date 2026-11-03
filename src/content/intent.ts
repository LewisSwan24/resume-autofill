// Intent builder for `frame:apply`: a manual correction from the side panel.
import { normalizeLabel } from '../dictionary';
import type { FillIntent, OptionMatcher } from '../drivers/types';

/**
 * Matcher that picks the (enabled) option whose normalized label equals the normalized wanted label.
 * Exactly one → matched; several → ambiguous (never pick); none → none.
 */
export function exactLabelMatcher(optionLabel: string): OptionMatcher {
  const wanted = normalizeLabel(optionLabel);
  return (options) => {
    if (!wanted) return { status: 'none' };
    const hits: number[] = [];
    options.forEach((o, i) => {
      if (!o.disabled && normalizeLabel(o.label) === wanted) hits.push(i);
    });
    if (hits.length === 1) return { status: 'matched', index: hits[0]!, confidence: 1 };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
    return { status: 'none' };
  };
}

/**
 * `optionLabel` → choice intent (exact normalized label); otherwise `text` → text intent.
 * `null` when neither is given. The side panel sends exactly one of them.
 */
export function buildApplyIntent(input: { text?: string; optionLabel?: string }): FillIntent | null {
  if (typeof input.optionLabel === 'string') {
    return {
      kind: 'choice',
      display: input.optionLabel,
      query: input.optionLabel,
      match: exactLabelMatcher(input.optionLabel),
    };
  }
  if (typeof input.text === 'string') return { kind: 'text', text: input.text };
  return null;
}
