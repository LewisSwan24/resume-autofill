// Some pages swap a field for a new element while it is being filled, sometimes under a new id or none.
// A slot remembers what stood around the field, so the element that took over can be told from its neighbours.

export interface Slot {
  /** The element in this place now, or null when nothing shows which one it is. */
  find(): HTMLElement | null;
}

const FORM_CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** A page or a form can gain an unrelated field at any time: too wide to say anything about one box. */
const TOO_WIDE = new Set(['BODY', 'HTML']);

/** firstName, fName, Email, EMAIL, address1, ctl00, userID, q1. Letters that only look like one, as in nTowvSy0v2, are not. */
const WORD = /^(?:[a-z]+|[A-Z]+|[A-Z][a-z]+)(?:[A-Z][a-z]+)*(?:URL|URI|ID|PIN|DOB)?\d{0,3}$/;
/** The place of a field among others: address_1, education[0][school]. A longer number is somebody's id. */
const PLACE = /^\d{1,3}$/;
/** Names a library numbers as it goes: they say nothing, and the number changes from one render to the next. */
const GENERATED = /^(?::[a-z0-9]+:|react-select-\d+-.*|rc[-_]select[-_]\d+|el-id-\d+-\d+|(?:field|input)[-_]?\d+)$/i;
/**
 * The words of a name and the places in it, which are all of it that lasts: a generated name means nothing from one
 * render to the next, and the id in cards[e78797e4][field0] is made up too.
 */
const nameWords = (name: string): string =>
  GENERATED.test(name)
    ? ''
    : name
        .split(/[^A-Za-z0-9]+/)
        .filter((part) => WORD.test(part) || PLACE.test(part))
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
