// How many child frames this document expects to check in with the app (`unreachable`): visible
// iframe / frame elements (at least 20×20 CSS px) whose src is http(s). about:blank and srcdoc frames run no engine.
const MIN_SIDE = 20;

export function countChildFrames(doc: Document): number {
  let n = 0;
  for (const el of doc.querySelectorAll('iframe, frame')) {
    const src = (el as HTMLIFrameElement).src;
    if (!/^https?:\/\//i.test(src ?? '')) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_SIDE && r.height >= MIN_SIDE) n++;
  }
  return n;
}
