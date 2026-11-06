// Where a form's "add another entry" controls are. Most are buttons or links; some pages (Beisen) draw one as words in
// a few divs that only the pointer shows to be clickable, so those are found by their words.
import { isAddButtonText, matchSection } from '../dictionary';
import { cleanEvidenceText } from './evidence';

export const ADD_BUTTON_SELECTOR = 'button, a, [role=button], input[type=button], .ant-btn, .el-button';

/** Longer than this and it is a sentence about adding something, not a button. */
const MAX_WORDS = 20;
/** How far above the words a clickable wrapper may be. */
const MAX_WRAPPERS = 4;

const ADD_WORD = /^[\s+＋]*(?:继续添加|再添加|再增加|添加更多|添加|新增|增加|add\s+(?:another|more|new)|add)\s*/i;

/**
 * With nothing else saying it is a button, the words must be the whole of it: 添加 alone, or 添加 and the part of
 * the resume it adds to. "添加的内容请写在下面" is a sentence.
 */
function saysOnlyAdd(words: string): boolean {
  const rest = words.replace(ADD_WORD, '').trim();
  return rest === '' || (matchSection(rest)?.confidence ?? 0) >= SECTION_NAMED;
}
const SECTION_NAMED = 0.8;

/**
 * Add buttons that are not buttons: words that add an entry, on an element the pointer shows as clickable and that
 * holds nothing but those words (and an icon). The element holding the words is the one returned, once per button:
 * the pointer is inherited and does not say which wrapper listens, and a click only travels up, so it starts there.
 */
export function plainAddButtons(root: Node): HTMLElement[] {
  const doc = root.ownerDocument ?? (root as Document);
  const win = doc.defaultView;
  if (!win) return [];
  const found = new Set<HTMLElement>();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!ADD_WORD.test(cleanEvidenceText(n.textContent ?? ''))) continue;
    const start = n.parentElement;
    // A real button is found by what it is.
    if (!start || start.closest(ADD_BUTTON_SELECTOR)) continue;
    // React may write 添加 and 教育经历 as two pieces of text in one element: the element's words are the button's.
    const words = cleanEvidenceText(start.textContent ?? '');
    if (!words || words.length > MAX_WORDS || !isAddButtonText(words) || !saysOnlyAdd(words)) continue;
    let clickable = false;
    let e: HTMLElement | null = start;
    for (let i = 0; e && i < MAX_WRAPPERS && !clickable; e = e.parentElement, i++) {
      if (cleanEvidenceText(e.textContent ?? '') !== words || e.querySelector('input, select, textarea')) break;
      clickable = win.getComputedStyle(e).cursor === 'pointer';
    }
    if (clickable) found.add(start);
  }
  return [...found];
}
