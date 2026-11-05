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

const FAR_AWAY_PX = -500;

const isMovedOff = (style: CSSStyleDeclaration): boolean =>
  (style.position === 'absolute' || style.position === 'fixed') && (Number.parseFloat(style.left) <= FAR_AWAY_PX || Number.parseFloat(style.top) <= FAR_AWAY_PX);

function isPutAway(style: CSSStyleDeclaration): boolean {
  if (isMovedOff(style)) return true;
  if (style.position === 'absolute' || style.position === 'fixed') {
    if (/^rect\(0(?:px)?,? 0(?:px)?,? 0(?:px)?,? 0(?:px)?\)$/.test(style.clip)) return true;
  }
  if (/^inset\((?:50|100)%\)$/.test(style.clipPath)) return true;
  if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') {
    if (Number.parseFloat(style.height) === 0 || Number.parseFloat(style.width) === 0) return true;
  }
  return false;
}

/** Moved off the page, by this element or one around it. Anything can be behind a widget, but not this far away. */
export function isFarAway(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  for (let node: Element | null = el; node; node = parentOf(node)) {
    if (isMovedOff(view.getComputedStyle(node))) return true;
  }
  return false;
}

/** See-through is a trap, unless it is on its way to showing a whole form: a real fade, around more than a box or two. */
const MAX_BOXES_IN_A_TRAP = 2;
const FILLABLE_BOXES = 'input:not([type=hidden], [type=submit], [type=reset], [type=button], [type=image]), textarea, select';
const isFading = (style: CSSStyleDeclaration): boolean =>
  Number.parseFloat(style.transitionDuration) > 0 || (!!style.animationName && style.animationName !== 'none');
function isSeeThroughTrap(node: Element, style: CSSStyleDeclaration): boolean {
  if (style.opacity === '' || Number(style.opacity) !== 0) return false;
  if (!isFading(style)) return true;
  return node.querySelectorAll(FILLABLE_BOXES).length + (node.matches(FILLABLE_BOXES) ? 1 : 0) <= MAX_BOXES_IN_A_TRAP;
}

/**
 * A box laid out so that nobody can see it, though by the rules of CSS it is showing: moved off the page, see-through,
 * squeezed to nothing, clipped away. That is how a trap for robots looks. Whoever fills it gives themselves away.
 * Only for what people type into: radio buttons and file boxes are often hidden like this behind their labels.
 */
export function isOutOfSight(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const own = view.getComputedStyle(el);
  if (Number.parseFloat(own.height) === 0 || Number.parseFloat(own.width) === 0) return true;
  for (let node: Element | null = el; node; node = parentOf(node)) {
    const style = view.getComputedStyle(node);
    if (isPutAway(style) || isSeeThroughTrap(node, style)) return true;
  }
  if (!hasLayout(el)) return false;
  const box = el.getBoundingClientRect();
  if (box.width <= 1 || box.height <= 1) return true;
  return box.right + view.scrollX <= 0 || box.bottom + view.scrollY <= 0;
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
