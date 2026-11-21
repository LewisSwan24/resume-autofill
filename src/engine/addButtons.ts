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

/** A page made for touch (a phone's WebView, Feishu's /m/ forms) sets no cursor, so the pointer says nothing there. */
function touchFirst(win: Window): boolean {
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** An icon drawn beside the words: an image, or an icon font's empty <i>. */
const ICON = 'svg, img, i, [class*="icon" i]';
/** Words of a class or id that say the element adds something or is a button: award-addBtn, formOperate-addMore. */
const NAMED_ADD = new Set(['add', 'plus', 'btn', 'button']);
/** A class or id cut into its words: at dashes, underscores and spaces, and where camelCase turns upper. */
const nameWords = (name: string): string[] => name.split(/[-_\s]+|(?<=[a-z0-9])(?=[A-Z])/).map((w) => w.toLowerCase());

/**
 * On a touch page the pointer says nothing, and the phone's fill browser runs on every site, so the words need
 * something more that draws them as a button: a plus written before them, an icon beside them, or a class or id that
 * names the element as an add or a button. Words alone are as likely a tip or a heading.
 */
function drawnAsButton(e: HTMLElement, words: string): boolean {
  return /^[+＋]/.test(words) || e.querySelector(ICON) !== null || named(e, NAMED_ADD);
}

/** Words of a class or id that say the element is a button, whatever it does: createFormSection-addBtn. */
const NAMED_BUTTON = new Set(['btn', 'button']);
const named = (e: HTMLElement, words: Set<string>): boolean =>
  nameWords(`${typeof e.className === 'string' ? e.className : ''} ${e.id}`).some((w) => words.has(w));

/**
 * Add buttons that are not buttons: words that add an entry, on an element the pointer shows as clickable or whose
 * class names it a button (on a touch-first page, one drawn as a button) and that holds nothing but those words (and an icon). The element holding
 * the words is the one returned, once per button: the pointer is inherited and does not say which wrapper listens,
 * and a click only travels up, so it starts there.
 */
export function plainAddButtons(root: Node): HTMLElement[] {
  const doc = root.ownerDocument ?? (root as Document);
  const win = doc.defaultView;
  if (!win) return [];
  const touch = touchFirst(win);
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
      // On a computer the pointer says it, or a name that calls it a button: Feishu sets no pointer on the 添加 of
      // a section with no entry yet. An add in the name alone (createFormSection-addText) is as likely a label.
      clickable = touch ? drawnAsButton(e, words) : win.getComputedStyle(e).cursor === 'pointer' || named(e, NAMED_BUTTON);
    }
    if (clickable) found.add(start);
  }
  return [...found];
}
