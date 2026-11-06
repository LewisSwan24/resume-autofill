// Grow repeated sections (education, internship, ...) until the page has one card per resume entry,
// by clicking the section's "add" button. Never clicks anything that is not an add button.
import { isAddButtonText, isDeleteText, matchSection } from '../dictionary';
import { ADD_BUTTON_SELECTOR, plainAddButtons } from '../engine/addButtons';
import { cleanEvidenceText } from '../engine/evidence';
import { findSection } from '../engine/grouping';
import { planFill } from '../engine/plan';
import { scanDocument } from '../engine/scan';
import type { SectionKey } from '../engine/types';
import { entryCount } from '../engine/values';
import { isVisible } from '../engine/visibility';
import { waitFor } from '../drivers/wait';
import { simulateClick } from '../drivers/events';
import type { Resume } from '../schema';

export interface SectionGrowth {
  section: SectionKey;
  /** Cards on the page at the end. */
  have: number;
  /** Resume entries for the section. */
  need: number;
  /** Cards this run added. */
  added: number;
  /**
   * ok: enough cards. no_button: the page offers no add button for the section (nothing to report).
   * action_failed: an add button was clicked but no card appeared, or the `maxAdds` cap was hit before `need`.
   */
  status: 'ok' | 'no_button' | 'action_failed';
  /** Text of the add button (when one was used). */
  label?: string;
}

export interface EnsureCardsOptions {
  idFor?: (el: HTMLElement) => string;
  /** How long to wait for a card to appear after a click. Default 2000. */
  timeoutMs?: number;
  /** Safety cap on clicks per section. Default 12. */
  maxAdds?: number;
  /** Sections something else looks after. */
  skip?: ReadonlySet<SectionKey>;
}

const FIELD_SELECTOR = 'input, select, textarea, [contenteditable=""], [contenteditable="true"]';
const ADD_WORDS = /^[\s+＋]*(?:继续添加|再添加|再增加|添加更多|添加|新增|增加|add\s+(?:another|more|new)|add)\s*/i;
const SECTION_FROM_TEXT_MIN = 0.8;

const REPEATED: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'education', 'work', 'internship', 'projects', 'campus', 'awards', 'languages', 'certificates', 'skills',
  'family', 'referees',
]);

interface AddButton {
  el: HTMLElement;
  text: string;
  section: SectionKey | null;
  /** True when the button's own text names the section ("添加实习经历"). */
  named: boolean;
}

const buttonText = (el: Element): string =>
  cleanEvidenceText(el instanceof HTMLInputElement ? el.value : (el.textContent ?? ''));

/** `javascript:void(0)`, `javascript:;` and the like: a link that only runs script, never navigates. */
const INERT_JS_HREF = /^javascript:\s*(?:void\s*\(?\s*0?\s*\)?|undefined)?\s*;?\s*$/i;

/** True for `<a href>` that leads somewhere: anything except empty, `#...` and an inert `javascript:` URL. */
function navigates(el: HTMLElement): boolean {
  if (el.tagName !== 'A') return false;
  const href = el.getAttribute('href');
  if (href === null) return false;
  const h = href.trim();
  return !(h === '' || h.startsWith('#') || INERT_JS_HREF.test(h));
}

/** A button that explicitly submits (type=submit / image). An untyped `<button>` is only *implicitly* one. */
const isExplicitSubmit = (el: HTMLElement): boolean => /^(?:submit|image)$/i.test(el.getAttribute('type') ?? '');

function isDisabled(el: HTMLElement): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    /(?:^|\s)(?:is-disabled|ant-btn-disabled|disabled)(?:\s|$)/.test(el.getAttribute('class') ?? '')
  );
}

/** Add buttons on the page with the section each one belongs to. */
export function findAddButtons(doc: Document): AddButton[] {
  const out: AddButton[] = [];
  const plain = new Set(plainAddButtons(doc));
  for (const el of [...Array.from(doc.querySelectorAll<HTMLElement>(ADD_BUTTON_SELECTOR)), ...plain]) {
    const text = buttonText(el);
    if (!text || !isAddButtonText(text) || isDeleteText(text)) continue;
    if (!isVisible(el) || isDisabled(el)) continue;
    // Submit buttons and links that navigate away are never add buttons. (A button with no `type` that sits
    // in a form is an implicit submit button, but also the most common shape of a genuine add button:
    // it is kept and `clickAdd` cancels the submit it would trigger.)
    if (isExplicitSubmit(el) || navigates(el)) continue;
    // A button that is merely the label wrapper of an inner button counts once (the inner one).
    if (!plain.has(el) && (el !== el.closest(ADD_BUTTON_SELECTOR) || el.querySelector(ADD_BUTTON_SELECTOR))) continue;
    const rest = text.replace(ADD_WORDS, '');
    const own = rest ? matchSection(rest) : null;
    if (own && own.confidence >= SECTION_FROM_TEXT_MIN) {
      out.push({ el, text, section: own.section, named: true });
      continue;
    }
    const heading = findSection(el);
    const inherited = heading ? matchSection(heading.title) : null;
    out.push({ el, text, section: inherited?.section ?? null, named: false });
  }
  return out;
}

interface SectionState {
  section: SectionKey;
  have: number;
  need: number;
}

/** Cards vs. resume entries per repeated section, including sections that have no card at all yet. */
function sectionStates(doc: Document, resume: Resume, idFor?: (el: HTMLElement) => string): SectionState[] {
  const scan = scanDocument(doc, idFor);
  const demand = planFill(scan.contexts, scan.classifications, resume).cardDemand;
  const have = new Map<SectionKey, number>();
  for (const d of demand) have.set(d.section, Math.max(have.get(d.section) ?? 0, d.have));
  for (const b of findAddButtons(doc)) {
    if (b.section && REPEATED.has(b.section) && !have.has(b.section)) have.set(b.section, 0);
  }
  const hasInternship = have.has('internship');
  return [...have].map(([section, n]) => ({ section, have: n, need: entryCount(resume, section, hasInternship) }));
}

/**
 * Click without ever letting a stray form submit through: for the duration of the click a capture-phase
 * `submit` listener on the window cancels the event and keeps every page listener from seeing it.
 */
export function clickAdd(el: HTMLElement): void {
  const target: EventTarget = el.ownerDocument.defaultView ?? el.ownerDocument;
  const block = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  target.addEventListener('submit', block, true);
  try {
    simulateClick(el);
  } finally {
    // Submit events fire synchronously during the click, so the guard can go right away.
    target.removeEventListener('submit', block, true);
  }
}

function pickButton(buttons: AddButton[], section: SectionKey): AddButton | undefined {
  const named = buttons.filter((b) => b.section === section && b.named);
  const inside = buttons.filter((b) => b.section === section && !b.named);
  // Several candidates: the last one in document order follows the cards.
  return named[named.length - 1] ?? inside[inside.length - 1];
}

/**
 * For every repeated section with fewer cards than resume entries, click its add button until the
 * count is reached or clicking stops helping. Returns one entry per section that needed cards.
 */
export async function ensureCards(
  doc: Document,
  resume: Resume,
  opts: EnsureCardsOptions = {},
): Promise<SectionGrowth[]> {
  const timeout = opts.timeoutMs ?? 2000;
  const maxAdds = opts.maxAdds ?? 12;
  const results: SectionGrowth[] = [];
  const fieldCount = () => doc.querySelectorAll(FIELD_SELECTOR).length;

  const initial = sectionStates(doc, resume, opts.idFor).filter((s) => s.need > s.have && !opts.skip?.has(s.section));
  for (const first of initial) {
    const result: SectionGrowth = { section: first.section, have: first.have, need: first.need, added: 0, status: 'ok' };
    results.push(result);
    let prevHave = first.have;
    while (result.added < maxAdds) {
      const state = sectionStates(doc, resume, opts.idFor).find((s) => s.section === first.section);
      if (!state) break;
      result.have = state.have;
      result.need = state.need;
      if (state.have >= state.need) break;
      if (result.added > 0 && state.have <= prevHave) {
        // The last click added fields but no recognisable card: stop instead of piling up blocks.
        result.status = 'action_failed';
        break;
      }
      prevHave = state.have;
      const button = pickButton(findAddButtons(doc), first.section);
      if (!button) {
        result.status = 'no_button';
        break;
      }
      result.label = button.text;
      const before = fieldCount();
      clickAdd(button.el);
      const grown = await waitFor(() => fieldCount() > before, { timeout, root: doc });
      if (!grown) {
        result.status = 'action_failed';
        break;
      }
      result.added += 1;
    }
    if (result.status === 'ok' && result.added >= maxAdds) {
      // Stopped by the cap, not by success: refresh the counts and do not claim a complete section.
      const last = sectionStates(doc, resume, opts.idFor).find((s) => s.section === first.section);
      if (last) {
        result.have = last.have;
        result.need = last.need;
        if (last.have < last.need) result.status = 'action_failed';
      }
    }
  }
  return results;
}

