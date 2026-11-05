// Helpers for library dropdowns that teleport their panel to <body> (antd, Element Plus).
import { isVisible } from '../engine/visibility';
import type { OptionInfo } from '../engine/types';
import { fireBlur, pressKey, simulateClick } from './events';

export interface FindDropdownOptions {
  /** Document to search; defaults to the trigger's own document. */
  doc?: Document;
}

const HIDDEN_CLASS = /-hidden$/;
const LEAVING_CLASS = /-leave(?:-active|-to|-from)?$/;

function classTokens(el: Element): string[] {
  const raw = el.getAttribute('class');
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

/** Hidden by class (`ant-select-dropdown-hidden`), aria-hidden, or mid leave-animation (`*-leave-active`). */
export function isRetired(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.getAttribute('aria-hidden') === 'true') return true;
    for (const token of classTokens(n)) {
      if (LEAVING_CLASS.test(token)) return true;
      if (n === el && HIDDEN_CLASS.test(token)) return true;
    }
  }
  return false;
}

/**
 * Pick the open dropdown panel that belongs to `trigger`. Panels are teleported, so there is no
 * ancestry to follow: take every visible, non-retired match and choose the one whose top-left
 * corner is nearest (Manhattan) to the trigger's bottom-left corner. Ties go to the panel that
 * appears last in the document (the most recently opened one).
 */
export function findDropdownNear(
  trigger: Element,
  selector: string,
  opts: FindDropdownOptions = {},
): HTMLElement | null {
  const doc = opts.doc ?? trigger.ownerDocument;
  const t = trigger.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
    if (isRetired(el) || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const distance = Math.abs(r.left - t.left) + Math.abs(r.top - t.bottom);
    if (distance <= bestDistance) {
      best = el;
      bestDistance = distance;
    }
  }
  return best;
}

export interface DropdownOption {
  el: HTMLElement;
  info: OptionInfo;
}

function isDisabledOption(el: HTMLElement): boolean {
  if (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')) return true;
  return classTokens(el).some((c) => /(?:^|-)disabled$/.test(c));
}

/** Visible, enabled options of an open dropdown, in document order. Disabled ones are skipped entirely. */
export function visibleOptions(dropdown: Element, optionSelector: string): DropdownOption[] {
  const out: DropdownOption[] = [];
  for (const el of Array.from(dropdown.querySelectorAll<HTMLElement>(optionSelector))) {
    if (isDisabledOption(el) || !isVisible(el)) continue;
    const label = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const value = el.getAttribute('data-value') ?? el.getAttribute('data-key') ?? undefined;
    out.push({ el, info: value === undefined ? { label } : { label, value } });
  }
  return out;
}

/**
 * Close whatever dropdown is open without clicking anywhere on the page:
 * Escape on the focused element, then blur it.
 */
export function closeDropdown(doc: Document): void {
  const active = (doc.activeElement as HTMLElement | null) ?? doc.body;
  pressKey(active, 'Escape');
  if (active !== doc.body) fireBlur(active);
}

/** For a list known to be open and not meant to stay: some only shut on a press outside them. */
export function shutDropdown(doc: Document, stillOpen: () => boolean): void {
  closeDropdown(doc);
  if (stillOpen()) simulateClick(doc.body);
}
