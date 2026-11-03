// Control ids of this frame: one module-level WeakMap shared by scans and fills, so the id of an
// element is the same in the FAB's scan, in `runFill` and in later `frame:focus` / `frame:apply`.
const ids = new WeakMap<HTMLElement, string>();
let counter = 0;

/** Stable per-element id for this page session: "c1", "c2", ... */
export function idFor(el: HTMLElement): string {
  let id = ids.get(el);
  if (!id) {
    id = `c${++counter}`;
    ids.set(el, id);
  }
  return id;
}
