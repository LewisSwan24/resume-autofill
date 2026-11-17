// Open Shadow DOM traversal & cross-root ARIA/label resolution helpers.

/** Return parentElement, or step across an Open ShadowRoot boundary to its host element. */
export function parentElementOrHost(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
    return root.host;
  }
  return null;
}

/** Find nearest ancestor matching `selector`, stepping outward across open ShadowRoot hosts if needed. */
export function shadowClosest(el: Element, selector: string): Element | null {
  let current: Element | null = el;
  const visitedHosts = new Set<Element>();
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const root = current.getRootNode();
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && !visitedHosts.has(root.host)) {
      visitedHosts.add(root.host);
      current = root.host;
      continue;
    }
    return null;
  }
  return null;
}

/** Look up an element by id inside `el`'s own root first, then climb outer shadow hosts and document. */
export function resolveByIdAcrossRoots(el: Element, id: string): HTMLElement | null {
  if (!id) return null;
  let root: Node = el.getRootNode();
  const seen = new Set<Node>();
  while (root && !seen.has(root)) {
    seen.add(root);
    const maybeGetById = root as { getElementById?: (targetId: string) => HTMLElement | null };
    if (typeof maybeGetById.getElementById === 'function') {
      const hit = maybeGetById.getElementById(id);
      if (hit) return hit;
    }
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
      root = root.host.getRootNode();
    } else {
      break;
    }
  }
  return el.ownerDocument.getElementById(id);
}

const MAX_SHADOW_DEPTH = 12;

/** Query `selector` inside `root` and recursively descend into any Open ShadowRoots (cycle & depth guarded). */
export function querySelectorDeep(root: Document | ShadowRoot | Element, selector: string): Element | null {
  const direct = root.querySelector(selector);
  if (direct) return direct;
  const seen = new Set<ShadowRoot>();
  const queue: Array<{ scope: Document | ShadowRoot | Element; depth: number }> = [{ scope: root, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next.depth >= MAX_SHADOW_DEPTH) continue;
    for (const el of Array.from(next.scope.querySelectorAll('*'))) {
      if (el.shadowRoot && !seen.has(el.shadowRoot)) {
        seen.add(el.shadowRoot);
        const hit = el.shadowRoot.querySelector(selector);
        if (hit) return hit;
        queue.push({ scope: el.shadowRoot, depth: next.depth + 1 });
      }
    }
  }
  return null;
}

/**
 * Resolve `<label for>` elements across both the control's own root and any outer Shadow host root
 * (e.g. `<label for="emp-email">Email</label><lwc-input id="emp-email">#shadow<input/></lwc-input>`).
 */
export function findExternalHostLabels(controlEl: Element, controlIds: ReadonlySet<string>): Element[] {
  const root = controlEl.getRootNode();
  if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) return [];
  const matches: Element[] = [];
  let currentRoot: Node = root;
  const visited = new Set<Node>();
  while (typeof ShadowRoot !== 'undefined' && currentRoot instanceof ShadowRoot && !visited.has(currentRoot)) {
    visited.add(currentRoot);
    const host = currentRoot.host;
    const hostRoot = host.getRootNode() as Document | ShadowRoot;
    const candidateIds = new Set<string>(controlIds);
    if (host.id) candidateIds.add(host.id);
    if (candidateIds.size > 0 && typeof hostRoot.querySelectorAll === 'function') {
      for (const lbl of Array.from(hostRoot.querySelectorAll('label[for]'))) {
        const target = lbl.getAttribute('for') ?? '';
        if (candidateIds.has(target)) matches.push(lbl);
      }
    }
    const wrapped = host.closest('label');
    if (wrapped && (!wrapped.getAttribute('for') || candidateIds.has(wrapped.getAttribute('for')!))) {
      matches.push(wrapped);
    }
    currentRoot = hostRoot;
  }
  return matches;
}

/** Walk up Shadow host attributes (`label`, `aria-label`, `aria-labelledby`) for custom components inside Shadow DOM. */
export function collectShadowHostAttributes(
  controlEl: Element,
): Array<{ source: 'aria-label' | 'aria-labelledby'; text: string }> {
  const out: Array<{ source: 'aria-label' | 'aria-labelledby'; text: string }> = [];
  let root: Node = controlEl.getRootNode();
  const seen = new Set<Node>();
  while (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && !seen.has(root)) {
    seen.add(root);
    const host = root.host;
    const labelAttr = host.getAttribute('label');
    if (labelAttr) out.push({ source: 'aria-label', text: labelAttr });
    const ariaLabel = host.getAttribute('aria-label');
    if (ariaLabel) out.push({ source: 'aria-label', text: ariaLabel });
    const labelledBy = host.getAttribute('aria-labelledby');
    if (labelledBy) {
      const hostRoot = host.getRootNode();
      const parts = labelledBy
        .split(/\s+/)
        .filter(Boolean)
        .filter((id) => id !== host.id)
        .map((id) => resolveByIdAcrossRoots(host, id) ?? (hostRoot as Document).getElementById?.(id) ?? null)
        .filter((n): n is HTMLElement => !!n)
        .map((n) => n.textContent ?? '');
      const joined = parts.join(' ').trim();
      if (joined) out.push({ source: 'aria-labelledby', text: joined });
    }
    root = host.getRootNode();
  }
  return out;
}
