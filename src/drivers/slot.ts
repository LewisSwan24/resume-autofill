// Some pages swap a field for a new element while it is being filled, sometimes under a new id or none.
// A slot remembers what stood around the field, so the element that took over can be told from its neighbours.

export interface Slot {
  /** The element in this place now, or null when nothing shows which one it is. */
  find(): HTMLElement | null;
}

const FORM_CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** A page or a form can gain an unrelated field at any time: too wide to say anything about one box. */
const TOO_WIDE = new Set(['BODY', 'HTML']);

/** firstName, Email, EMAIL, address1, ctl00, txtEmail. Letters that only look like one, as in nTowvSy0v2, are not. */
const WORD = /^(?:[a-z]{2,}|[A-Z]{2,}|[A-Z][a-z]+)(?:[A-Z][a-z]+)*\d{0,2}$/;
/**
 * The words of a name, which is all of it that lasts: a generated name means nothing from one render to the next,
 * and the numbers in react-select-3-input or the id in cards[e78797e4][field0] are made up too.
 */
const nameWords = (name: string): string =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => WORD.test(part))
    .join(' ')
    .toLowerCase();

function labelTextOf(el: HTMLElement): string {
  const labels = (el as HTMLInputElement).labels;
  return (labels?.[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** What a box says about itself. Where both boxes say something, they have to say the same. */
function sameField(a: HTMLElement, b: HTMLElement, sameLabel: boolean): boolean {
  const agree = (x: string | null | undefined, y: string | null | undefined): boolean => !x || !y || x === y;
  for (const attr of ['aria-label', 'placeholder', 'autocomplete']) {
    if (!agree(a.getAttribute(attr), b.getAttribute(attr))) return false;
  }
  // A label that stayed says more than a name, which some pages make up again on every render.
  if (sameLabel) return true;
  const [na, nb] = [nameWords(a.getAttribute('name') ?? ''), nameWords(b.getAttribute('name') ?? '')];
  return agree(na, nb);
}

export function slotOf(el: HTMLElement): Slot {
  if (!FORM_CONTROLS.has(el.tagName)) return { find: () => (el.isConnected ? el : null) };
  const type = el.getAttribute('type');
  const peers = (within: Element): HTMLElement[] =>
    Array.from(within.querySelectorAll<HTMLElement>(el.tagName)).filter((p) => p.getAttribute('type') === type);

  // Taken now: the label may be gone with the box by the time anyone asks.
  const self = el.cloneNode(false) as HTMLElement;
  const ownLabel = labelTextOf(el);
  const around = new Map<Element, { before: HTMLElement[]; branches: Element[]; own: Element }>();
  let own: Element = el;
  for (let box = el.parentElement; box && !TOO_WIDE.has(box.tagName); own = box, box = box.parentElement) {
    around.set(box, { before: peers(box), branches: Array.from(box.children), own });
  }

  return {
    find() {
      if (el.isConnected) return el;
      // The nearest box still in the page, as long as the only change in it is one new element in this place.
      for (const [box, { before, branches, own: branch }] of around) {
        if (!box.isConnected) continue;
        const now = peers(box);
        const place = before.indexOf(el);
        const next = now[place];
        if (now.length !== before.length || !next || before.includes(next)) return null;
        if (next.closest('[aria-hidden="true"]')) return null;
        // In a part of the box that was there already and held something else, it is another field.
        let part: Element = next;
        while (part.parentElement !== box) part = part.parentElement!;
        if (part !== branch && branches.includes(part)) return null;
        if (!now.every((p, i) => i === place || p === before[i])) return null;
        const nextLabel = labelTextOf(next);
        const sameLabel = !!ownLabel && ownLabel === nextLabel;
        return sameField(self, next, sameLabel) && (!ownLabel || !nextLabel || sameLabel) ? next : null;
      }
      return null;
    },
  };
}
