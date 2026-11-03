// Helpers shared by the antd v5 drivers: popup scoping, open / close, selection read-back.
//
// antd teleports every popup to <body>, and a just-closed popup stays visible for its leave animation,
// so "the visible dropdown" is ambiguous. Popups are therefore scoped per control:
//   - Select: the combobox input's `aria-controls` (`<id>_list`) names a listbox that lives inside
//     that select's own dropdown.
//   - Cascader / pickers (no such listbox): the nearest non-retired popup, only while the widget itself
//     reports itself open (`ant-select-open` / `ant-picker-focused`).
import { isVisible } from '../engine/visibility';
import { closeDropdown, findDropdownNear } from './dropdown';
import { focusElement, pressKey, simulateClick } from './events';
import type { DriverContext, FillResult } from './types';
import { waitFor } from './wait';

export const OPEN_CLASS = 'ant-select-open';

export const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
export const normText = (s: string): string => squash(s).normalize('NFKC').toLowerCase();

export const failed = (detail: string, observed: string | null = null): FillResult => ({
  ok: false,
  observed,
  outcome: 'action_failed',
  detail,
});

/** Hidden by class (`*-hidden`), aria-hidden, or mid leave-animation (`*-leave`, `*-leave-active`). */
export function isRetired(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.getAttribute('aria-hidden') === 'true') return true;
    for (const token of (n.getAttribute('class') ?? '').split(/\s+/)) {
      if (/-leave(?:-active|-to|-from)?$/.test(token)) return true;
      if (n === el && /-hidden$/.test(token)) return true;
    }
  }
  return false;
}

/** Popup is gone for our purposes: detached, retired or not rendered. */
export const isGone = (popup: Element): boolean => !popup.isConnected || isRetired(popup) || !isVisible(popup);

export function selectorOf(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.ant-select-selector') ?? root;
}

export function searchInputOf(root: HTMLElement): HTMLInputElement | null {
  return (
    root.querySelector<HTMLInputElement>('input.ant-select-selection-search-input') ??
    root.querySelector<HTMLInputElement>('input[role=combobox]')
  );
}

export interface PopupSpec {
  /** Popup panel selector (without any `-hidden` filtering; retirement is checked separately). */
  selector: string;
  /** Select: the input's aria-controls listbox must be found inside the popup (never fall back to "nearest"). */
  scopedByListbox: boolean;
}

export const SELECT_POPUP: PopupSpec = {
  selector: '.ant-select-dropdown:not(.ant-cascader-dropdown)',
  scopedByListbox: true,
};
export const CASCADER_POPUP: PopupSpec = { selector: '.ant-cascader-dropdown', scopedByListbox: false };

/** The open popup that belongs to this select / cascader, or null when it is not open. */
export function currentPopup(root: HTMLElement, spec: PopupSpec): HTMLElement | null {
  if (!root.classList.contains(OPEN_CLASS)) return null;
  const input = searchInputOf(root);
  const listId = input?.getAttribute('aria-controls') ?? input?.getAttribute('aria-owns');
  const listbox = listId ? root.ownerDocument.getElementById(listId) : null;
  if (listbox) {
    const own = listbox.closest<HTMLElement>(spec.selector);
    return own && !isRetired(own) && isVisible(own) ? own : null;
  }
  if (spec.scopedByListbox && listId) return null; // popup still mounting
  return findDropdownNear(selectorOf(root), spec.selector);
}

/**
 * Open a select-like widget and return its popup. Attempt 1: mousedown-click on the selector (rc-select
 * opens on mousedown). Attempt 2: focus the input and press ArrowDown. An already-open widget is left alone
 * (a second mousedown would toggle it shut).
 */
export async function openPopup(root: HTMLElement, spec: PopupSpec, ctx: DriverContext): Promise<HTMLElement | null> {
  const existing = currentPopup(root, spec);
  if (existing) return existing;
  try {
    root.scrollIntoView({ block: 'center' });
  } catch {
    /* detached or unsupported: harmless */
  }
  const input = searchInputOf(root);
  if (ctx.attempt === 2 && input) {
    focusElement(input);
    pressKey(input, 'ArrowDown');
  } else {
    simulateClick(selectorOf(root));
  }
  return waitFor(() => currentPopup(root, spec), {
    timeout: Math.min(ctx.timeoutMs, 1600),
    root: root.ownerDocument,
    signal: ctx.signal,
  });
}

/** Close the widget (Escape on its input, then a blur) and wait until its popup has left the page. */
export async function closePopup(root: HTMLElement, popup: HTMLElement | null, ctx: DriverContext): Promise<void> {
  const doc = root.ownerDocument;
  if (root.classList.contains(OPEN_CLASS)) {
    const input = searchInputOf(root);
    if (input) pressKey(input, 'Escape');
    const shut = await waitFor(() => !root.classList.contains(OPEN_CLASS) || null, { timeout: 500, root: doc });
    if (shut === null) {
      closeDropdown(doc);
      await waitFor(() => !root.classList.contains(OPEN_CLASS) || null, { timeout: 500, root: doc });
    }
  }
  if (popup) await waitFor(() => isGone(popup) || null, { timeout: Math.min(ctx.timeoutMs, 1500), root: doc });
}

/** Labels of the selected items: one for a single select, several for a multiple select. */
export function readSelectionItems(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.ant-select-selection-item'))) {
    const label = squash(
      el.getAttribute('title') ??
        el.querySelector('.ant-select-selection-item-content')?.textContent ??
        el.textContent,
    );
    if (label) out.push(label);
  }
  return out;
}

export function readSelection(root: HTMLElement): string | null {
  const items = readSelectionItems(root);
  return items.length > 0 ? items.join(', ') : null;
}
