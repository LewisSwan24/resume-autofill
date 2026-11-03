// Visibility checks used by discover. Pure DOM, overridable probe for tests.

export type VisibilityProbe = (el: Element) => boolean;

function parentOf(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  // Cross an open/closed shadow boundary to the host.
  return root.nodeType === 11 && 'host' in root ? (root as ShadowRoot).host : null;
}

function hasLayout(el: Element): boolean {
  const ua = el.ownerDocument.defaultView?.navigator?.userAgent ?? '';
  return !ua.includes('jsdom') && typeof el.getClientRects === 'function';
}

export const defaultVisibilityProbe: VisibilityProbe = (el) => {
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  for (let node: Element | null = el; node; node = parentOf(node)) {
    if ((node as HTMLElement).hidden) return false;
    const style = view.getComputedStyle(node);
    if (style.display === 'none') return false;
    // `visibility` is inherited, so the element's own computed value already reflects ancestors
    // (and lets a descendant opt back in with visibility: visible).
    if (node === el && (style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
  }
  if (hasLayout(el) && el.getClientRects().length === 0) return false;
  return true;
};

let probe: VisibilityProbe = defaultVisibilityProbe;

/** Override the visibility implementation (tests). Pass null to restore the default. */
export function setVisibilityProbe(fn: VisibilityProbe | null): void {
  probe = fn ?? defaultVisibilityProbe;
}

export function isVisible(el: Element): boolean {
  return probe(el);
}

function labelOf(input: HTMLInputElement): Element | null {
  return input.labels?.[0] ?? input.closest('label');
}

/**
 * Visibility for native form inputs. Radios, checkboxes and file inputs are routinely hidden
 * (opacity/display) behind a styled label or upload container, so they count as visible when
 * their label — or, for files, their parent container — is visible.
 */
export function isInputVisible(input: HTMLInputElement): boolean {
  if (isVisible(input)) return true;
  const type = input.type;
  if (type !== 'radio' && type !== 'checkbox' && type !== 'file') return false;
  const label = labelOf(input);
  if (label && isVisible(label)) return true;
  if (type === 'file' && input.parentElement && isVisible(input.parentElement)) return true;
  return false;
}
