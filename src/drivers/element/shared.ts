// Element Plus drivers: helpers shared across the widget-specific files.
import { isPlaceholderOption } from '../../dictionary/options';
import type { OptionInfo } from '../../engine/types';
import { isVisible } from '../../engine/visibility';
import { fireBlur, focusElement, pressKey, simulateClick } from '../events';
import type { DriverContext, FillResult, OptionMatcher } from '../types';
import { waitFor } from '../wait';

// ------------------------------------------------------------------ shared helpers

export const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

export const failed = (detail: string, observed: string | null = null): FillResult => ({
  ok: false,
  observed,
  outcome: 'action_failed',
  detail,
});

const LEAVING = /-leave(?:-active|-to|-from)?$/;

/** An open popper: displayed, not aria-hidden and not in its leave animation. */
export function isPopperLive(el: Element | null): el is HTMLElement {
  if (!el || el.getAttribute('aria-hidden') === 'true') return false;
  for (const token of Array.from(el.classList)) if (LEAVING.test(token)) return false;
  return isVisible(el);
}

/** `.el-popper` that owns `id` (the popper itself, or a listbox inside it). */
export function popperById(doc: Document, id: string | null | undefined): HTMLElement | null {
  return id ? (doc.getElementById(id)?.closest<HTMLElement>('.el-popper') ?? null) : null;
}

export function scrollIntoView(el: HTMLElement): void {
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    /* ignore */
  }
}

/**
 * Close the popper: Escape on the field's input (twice: the first Escape of a filterable select only
 * clears its query), then — as the last resort — toggle it with a click on the control itself.
 * Never clicks anywhere else on the page. Finishes with a blur of the input.
 */
export async function closePopper(
  input: HTMLElement | null,
  toggle: HTMLElement,
  getPopper: () => HTMLElement | null,
  ctx: DriverContext,
): Promise<void> {
  const gone = (): boolean => !isPopperLive(getPopper());
  const waitGone = async (ms: number): Promise<boolean> =>
    (await waitFor(() => gone() || null, { timeout: ms, root: ctx.doc })) !== null;
  if (!gone()) {
    for (let i = 0; i < 2 && !gone(); i++) {
      if (input) {
        focusElement(input);
        pressKey(input, 'Escape');
      }
      if (await waitGone(300)) break;
    }
    if (!gone()) {
      simulateClick(toggle);
      await waitGone(500);
    }
  }
  if (input) fireBlur(input);
}

type Picked = { indexes: number[] } | { result: FillResult };

/** Run every matcher: all-or-nothing, ambiguity → needs_review, miss → no_option. Never picks a guess. */
export function pickAll(matchers: OptionMatcher[], options: OptionInfo[]): Picked {
  const indexes: number[] = [];
  const ambiguous: number[] = [];
  let missing = 0;
  for (const match of matchers) {
    const m = match(options);
    if (m.status === 'ambiguous') ambiguous.push(...m.candidates);
    else if (m.status === 'none') missing++;
    else {
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
