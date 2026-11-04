// Highlighting of filled / suspicious fields with inline outlines (and restoring them afterwards).
import { ARIA_COMBOBOX_SELECTOR, ariaValueScope } from '../drivers/libraries';
import type { Outcome } from '../engine/types';
import { HIGHLIGHT_COLORS } from '../ui/tokens';

export interface HighlightEntry {
  el: HTMLElement;
  outcome: Outcome;
}

/**
 * Outline for an outcome, or null when the field is not highlighted (no_data / no_control).
 * State is not carried by colour alone: filled = 2px solid, review = 2px DASHED, error = 3px solid (thicker).
 */
export function outlineFor(outcome: Outcome): string | null {
  switch (outcome) {
    case 'filled':
      return `2px solid ${HIGHLIGHT_COLORS.filled}`;
    case 'needs_review':
    case 'no_option':
      return `2px dashed ${HIGHLIGHT_COLORS.review}`;
    case 'unmatched':
    case 'action_failed':
      return `3px solid ${HIGHLIGHT_COLORS.error}`;
    default:
      return null;
  }
}

interface Saved {
  outline: string;
  outlineOffset: string;
}

const saved = new Map<HTMLElement, Saved>();

/** Outline each element by outcome; the first highlight of an element remembers its inline style. */
export function applyHighlights(entries: readonly HighlightEntry[]): void {
  for (const { el: control, outcome } of entries) {
    const outline = outlineFor(outcome);
    if (outline === null) continue;
    // A combobox input can be 2px wide inside the box it is drawn as.
    const el = control.matches(ARIA_COMBOBOX_SELECTOR) ? ariaValueScope(control) : control;
    if (!saved.has(el)) saved.set(el, { outline: el.style.outline, outlineOffset: el.style.outlineOffset });
    el.style.outline = outline;
    el.style.outlineOffset = '2px';
  }
}

/** Remove every highlight and restore the original inline styles. */
export function clearHighlights(): void {
  for (const [el, s] of saved) {
    el.style.outline = s.outline;
    el.style.outlineOffset = s.outlineOffset;
  }
  saved.clear();
}

/** Scroll the field to the centre and flash it briefly. */
export function focusField(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'auto' });
  if (typeof el.animate !== 'function') return;
  const colour = HIGHLIGHT_COLORS.review;
  el.animate(
    [
      { boxShadow: `0 0 0 0 ${colour}` },
      { boxShadow: `0 0 0 6px ${colour}` },
      { boxShadow: `0 0 0 0 ${colour}` },
    ],
    { duration: 700, iterations: 2 },
  );
}
