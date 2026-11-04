// Native driver: helpers shared across the control-specific files.
import { isPlaceholderOption } from '../../dictionary/options';
import type { OptionInfo } from '../../engine/types';
import type { DriverContext, FillIntent, FillResult, OptionMatcher } from '../types';
import { waitFor } from '../wait';

/** How long a failed read-back may keep re-checking before the attempt is declared failed. */
const SETTLE_MS = 300;

export const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
export const stripSpace = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

export const failed = (detail: string, observed: string | null = null): FillResult => ({
  ok: false,
  observed,
  outcome: 'action_failed',
  detail,
});

/** Re-check `probe` for a short while: frameworks (React / Vue) may reconcile the DOM a tick later. */
export async function settle(el: Element, ctx: DriverContext, probe: () => boolean): Promise<boolean> {
  if (probe()) return true;
  const hit = await waitFor(() => probe() || null, {
    timeout: Math.min(SETTLE_MS, ctx.timeoutMs),
    root: el.ownerDocument,
  });
  return hit !== null;
}

// ------------------------------------------------------------------ option matching

type Picked = { indexes: number[] } | { result: FillResult };

export function matchersOf(intent: FillIntent): OptionMatcher[] | null {
  if (intent.kind === 'choice') return [intent.match];
  if (intent.kind === 'multi') return intent.items.map((i) => i.match);
  return null;
}

/**
 * Run every matcher against the options. All-or-nothing: any ambiguity → needs_review, any miss →
 * no_option, and in both cases nothing may be selected.
 */
export function pickOptions(matchers: OptionMatcher[], options: OptionInfo[]): Picked {
  const indexes: number[] = [];
  const ambiguous: number[] = [];
  let missing = 0;
  for (const match of matchers) {
    const m = match(options);
    if (m.status === 'ambiguous') {
      ambiguous.push(...m.candidates);
    } else if (m.status === 'none') {
      missing++;
    } else {
      const opt = options[m.index];
      if (!opt || opt.disabled || isPlaceholderOption(opt)) missing++;
      else if (!indexes.includes(m.index)) indexes.push(m.index);
    }
  }
  if (ambiguous.length > 0) {
    const labels = [...new Set(ambiguous.map((i) => options[i]?.label).filter((l): l is string => !!l))];
    return { result: { ok: false, observed: null, outcome: 'needs_review', candidates: labels } };
  }
  if (missing > 0) return { result: { ok: false, observed: null, outcome: 'no_option', detail: 'no matching option' } };
  return { indexes };
}
