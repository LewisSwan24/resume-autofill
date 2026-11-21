// Section titles and repeated-card grouping ("教育经历 1 / 2 ...") for a discovered control.
import { ABOUT_SOMEONE_ELSE, isAddButtonText, matchSection, normalizeLabel } from '../dictionary';
import { LIBRARY_OVERLAY_SELECTOR, LIBRARY_ROOT_SELECTOR } from '../drivers/libraries';
import {
  FIELD_SELECTOR,
  STRICT_HEADING_SELECTOR,
  analyzeControl,
  cleanEvidenceText,
  containsField,
  textWithoutControls, FORM_ITEM_SELECTOR } from './evidence';
import { ADD_BUTTON_SELECTOR, plainAddButtons } from './addButtons';
import type { Control, FieldContext, FieldGroup } from './types';

export interface SectionInfo {
  title: string;
  root: Element;
  /** The heading element the title came from. */
  heading: Element;
  /**
   * A line of advice in the heading's box after the title: 工作经历, then 如为实习经历可在职位名称上备注实习生. On Moka's
   * phone form the line is a box of its own between the title and the fields.
   */
  note?: string;
}

const MAX_CLASS_HEADING = 30;
/** A title told only by its words: 教育经历, Work experience. */
const MAX_PLAIN_HEADING = 20;
const MAX_PLAIN_HEADING_PARTS = 2;
/** Class-name guess for headings; library internals (form items, selects, tables...) are excluded. */
const CLASS_HEADING = /title|header|heading/i;
const CLASS_NOT_HEADING = /(?:^|\s)(?:ant|el)-(?:form|select|input|picker|table|cascader|upload|radio|checkbox|steps|menu)/i;
const PAGE_ROOT = /^(?:BODY|HTML)$/;
const DIGEST_SIMILARITY = 0.6;

// ---- numbering ------------------------------------------------------------------------------------------------

/** "教育经历 1" / "Employment #2" / "实习经历（2）" / "第2段教育经历" → the un-numbered title. */
export function stripNumbering(title: string): string {
  const t = title.trim();
  // Full-width digits and brackets (教育经历（２）) read as their plain forms.
  const plain = t.normalize('NFKC');
  const stripped = plain
    .replace(/^第\s*[0-9一二三四五六七八九十百]+\s*[段条项个份]\s*/, '')
    .replace(/\s*#?\s*[([]?\s*\d+\s*[)\]]?$/, '')
    // An ordinal in Chinese numerals: 教育经历（二）, or bare after a title of two characters or more (教育经历二).
    .replace(/\s*[([【]\s*[一二三四五六七八九十百]+\s*[)\]】]$/, '')
    .replace(/(?<=\p{Script=Han}{2})[一二三四五六七八九十]{1,3}$/u, '')
    .trim();
  return stripped && stripped !== plain ? stripped : t;
}

const isNumbered = (title: string): boolean => stripNumbering(title) !== title.trim();

// ---- DOM helpers -----------------------------------------------------------------------------------------------

function composedParent(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root.nodeType === 11 && 'host' in root ? (root as ShadowRoot).host : null;
}

/** Native boxes, plus the library widgets that have none inside (on a phone, Feishu's pickers are only a tap target). */
function fieldCount(root: Element): number {
  const boxless = Array.from(root.querySelectorAll(LIBRARY_ROOT_SELECTOR)).filter((w) => !w.querySelector(FIELD_SELECTOR));
  return root.querySelectorAll(FIELD_SELECTOR).length + boxless.length;
}

/** Number of controls inside `root`, counting a library widget (or radio / checkbox group) once. */
function countControls(root: Element): number {
  const keys = new Set<unknown>();
  const widgets = Array.from(root.querySelectorAll(LIBRARY_ROOT_SELECTOR));
  for (const w of widgets) {
    const outer = w.parentElement?.closest(LIBRARY_ROOT_SELECTOR);
    if (!outer || !root.contains(outer)) keys.add(w);
  }
  for (const f of Array.from(root.querySelectorAll(FIELD_SELECTOR))) {
    const lib = f.closest(LIBRARY_ROOT_SELECTOR);
    if (lib && lib !== root && root.contains(lib)) continue;
    if (f.closest(LIBRARY_OVERLAY_SELECTOR)) continue;
    const type = f instanceof HTMLInputElement ? f.type.toLowerCase() : '';
    const name = f instanceof HTMLInputElement ? f.name : '';
    if (type === 'radio') keys.add(name ? `r:${name}` : (f.closest('[role=radiogroup]') ?? f));
    else if (type === 'checkbox' && name) keys.add(`c:${name}`);
    else keys.add(f);
  }
  return keys.size;
}

// ---- section ---------------------------------------------------------------------------------------------------

function headingText(h: Element, limit: number): string | null {
  const t = cleanEvidenceText(textWithoutControls(h));
  return t && t.length <= limit ? t : null;
}

/**
 * A heading box that holds a section's name and, after it, a line of advice (Moka: 语言能力, then
 * 除英语外的其他外语能力). Read whole they name nothing, so the first words that name a section are the title.
 */
function titleBeforeNote(h: Element): { title: string; note?: string } | null {
  const leaves = Array.from(h.querySelectorAll('*')).filter((e) => e.children.length === 0 && !e.closest('button'));
  const lead = leaves.map((e) => cleanEvidenceText(e.textContent)).find((t) => t !== '');
  if (!lead || lead.length > MAX_PLAIN_HEADING || !matchSection(lead)) return null;
  const whole = cleanEvidenceText(textWithoutControls(h), Number.MAX_SAFE_INTEGER);
  const note = whole.startsWith(lead) ? whole.slice(lead.length).trim() : '';
  return note ? { title: lead, note } : { title: lead };
}

/** The heading a previous sibling `s` provides for `parent`, or null. */
function headingOf(s: Element, parent: Element): { title: string; heading: Element; note?: string } | null {
  if (containsField(s)) return null;
  const strict = s.matches(STRICT_HEADING_SELECTOR) ? s : s.querySelector(STRICT_HEADING_SELECTOR);
  if (strict) {
    const title = headingText(strict, Number.MAX_SAFE_INTEGER);
    if (!title) return null;
    const split = matchSection(title) ? null : titleBeforeNote(strict);
    return split ? { ...split, heading: strict } : { title, heading: strict };
  }
  const cls = s.getAttribute('class') ?? '';
  // The caption of one question, even when its answer takes several boxes: 就读时间 over year, month, year, month.
  if (parent.matches(FORM_ITEM_SELECTOR) && !parent.querySelector(FORM_ITEM_SELECTOR)) return null;
  if (CLASS_HEADING.test(cls) && !CLASS_NOT_HEADING.test(cls) && !s.querySelector('table, th')) {
    // A bare "title" span next to one field is a field caption, not a section: require a group of fields.
    if (fieldCount(parent) < 2) return null;
    const title = headingText(s, MAX_CLASS_HEADING);
    return title ? { title, heading: s } : null;
  }
  // A column beside the fields that holds the title with other things, such as a line of advice under it (Feishu's
  // createFormSection-left). The titled part heads them only when its words name a part of a resume.
  if (fieldCount(parent) >= 2) {
    const titled = Array.from(s.querySelectorAll('[class]')).find((e) => {
      const c = e.getAttribute('class') ?? '';
      return CLASS_HEADING.test(c) && !CLASS_NOT_HEADING.test(c);
    });
    const title = titled ? headingText(titled, MAX_PLAIN_HEADING) : null;
    // A whole section with no entry yet is a title and its 添加: that heads only its own button, not what follows.
    const rest = title ? cleanEvidenceText(textWithoutControls(s), Number.MAX_SAFE_INTEGER).replace(title, '') : '';
    if (titled && title && matchSection(title) && !isAddButtonText(rest)) return { title, heading: titled };
  }
  // Classes that are only build hashes say nothing, but a few bare words naming a part of a resume still head it.
  if (s.querySelectorAll('*').length <= MAX_PLAIN_HEADING_PARTS && fieldCount(parent) >= 2) {
    const title = headingText(s, MAX_PLAIN_HEADING);
    if (title && matchSection(title)) return { title, heading: s };
  }
  return null;
}

/** A box of advice that says what a section wants, by its class (Moka's phone form: describe-<hash>). */
const ADVICE_CLASS = /(?:^|\s)describe-/;

/** The advice between a heading and what it titles: the boxes after the heading that say so by their class. */
function adviceAfter(heading: Element, node: Element): string | undefined {
  const lines: string[] = [];
  for (let s = heading.nextElementSibling; s && s !== node; s = s.nextElementSibling) {
    if (!ADVICE_CLASS.test(s.getAttribute('class') ?? '') || containsField(s)) continue;
    const text = cleanEvidenceText(textWithoutControls(s), Number.MAX_SAFE_INTEGER);
    if (text) lines.push(text);
  }
  return lines.length ? lines.join(' ') : undefined;
}

/**
 * Nearest heading above `el`: walk up the ancestors and, at each level, look at the preceding siblings
 * (blocks that hold controls — earlier cards, rows — are skipped). `root` is the container the heading titles.
 */
export function findSection(el: Element): SectionInfo | null {
  let node: Element | null = el;
  while (node) {
    const parent = composedParent(node);
    if (!parent) return null;
    for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
      const hit = headingOf(s, parent);
      if (hit) {
        const note = hit.note ?? adviceAfter(s, node);
        return { ...hit, root: parent, ...(note ? { note } : {}) };
      }
    }
    node = parent;
  }
  return null;
}

/**
 * Section of a control for classification: the nearest heading that is not the repeated card's own
 * (numbered) title — "教育经历" rather than "教育经历 1" — falling back to the stripped card title.
 */
function resolveSection(el: Element): { title: string; root: Element; note?: string } | null {
  const near = findSection(el);
  if (!near) return null;
  const own = matchSection(near.title)?.section;
  if (own && ABOUT_SOMEONE_ELSE.has(own)) return { title: stripNumbering(near.title), root: near.root };
  if (PAGE_ROOT.test(near.root.tagName) || !(isNumbered(near.title) || cardMembers(near.root))) return near;
  const outer = findSection(near.root);
  if (outer && !PAGE_ROOT.test(outer.root.tagName) && !/^H1$/i.test(outer.heading.tagName)) return outer;
  return { title: stripNumbering(near.title), root: near.root.parentElement ?? near.root };
}

// ---- repeated cards --------------------------------------------------------------------------------------------

function isStateClass(c: string): boolean {
  return (
    /^(?:is|has)-/.test(c) ||
    /-has-|-with-help$/.test(c) ||
    /-(?:active|selected|open|opened|focused|disabled|hidden|checked|error|success|warning|validating)$/.test(c) ||
    /^(?:active|selected|open|show|hidden|current)$/.test(c)
  );
}

/** styled-components names the component (`sc-AjmGg`, the same for every instance) and its current styles. */
const STYLED_COMPONENT = /^sc-/;
/** The styles' class is a short hash that changes with the props: Beisen's last entry, the one with the add button. */
const STYLE_HASH = /^(?=[a-zA-Z]*[a-z])(?=[a-zA-Z]*[A-Z])[a-zA-Z]{5,8}$/;

function signature(el: Element): string {
  let classes = (el.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((c) => c && !isStateClass(c))
    .sort();
  if (classes.some((c) => STYLED_COMPONENT.test(c))) classes = classes.filter((c) => !STYLE_HASH.test(c));
  return el.tagName.toLowerCase() + (classes.length > 0 ? `.${classes.join('.')}` : '');
}

const digestKey = (s: string): string => normalizeLabel(s).replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

/** Normalized label texts of a block (numbers dropped), falling back to placeholders / names. */
function labelDigest(root: Element): Set<string> {
  const set = new Set<string>();
  for (const l of Array.from(root.querySelectorAll('label, th, legend, .ant-form-item-label, .el-form-item__label'))) {
    // A widget drawn as a label (Moka's lists) shows its answer there, which differs from one entry to the next.
    if (l.matches(LIBRARY_ROOT_SELECTOR)) continue;
    const k = digestKey(textWithoutControls(l));
    if (k) set.add(k);
  }
  if (set.size === 0) {
    for (const f of Array.from(root.querySelectorAll(FIELD_SELECTOR))) {
      for (const a of ['placeholder', 'aria-label', 'name']) {
        const k = digestKey(f.getAttribute(a) ?? '');
        if (k) set.add(k);
      }
    }
  }
  return set;
}

function similar(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return a.size === b.size;
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return both / (a.size + b.size - both) >= DIGEST_SIMILARITY;
}

/**
 * Siblings of `a` that repeat it (same signature, same labels) — including `a` — when `a` is a card:
 * it holds ≥ 2 controls and has at least one repeat. Null otherwise.
 */
function cardMembers(a: Element): Element[] | null {
  const parent = a.parentElement;
  if (!parent || countControls(a) < 2) return null;
  const sig = signature(a);
  const digest = labelDigest(a);
  const title = ownTitle(a);
  const members = Array.from(parent.children).filter(
    (ch) => ch === a || (signature(ch) === sig && countControls(ch) >= 1 && similar(labelDigest(ch), digest) && sameTitle(ownTitle(ch), title)),
  );
  return members.length >= 2 ? members : null;
}

/** The title a block opens with, numbering dropped: 教育经历 1 and 教育经历 2 are one section's cards. */
function ownTitle(block: Element): string | null {
  const first = block.firstElementChild;
  const hit = first ? headingOf(first, block) : null;
  return hit ? normalizeLabel(stripNumbering(hit.title)) : null;
}

/**
 * Two blocks built alike, each under a title of its own, are two sections (Moka's 工作经历 and 项目经验 both end a
 * span with 至今), not two cards of one. Without a title on both, nothing is said.
 */
const sameTitle = (a: string | null, b: string | null): boolean => a === null || b === null || a === b;

function findAddButtons(root: Element): Element[] {
  const buttons = Array.from(root.querySelectorAll(ADD_BUTTON_SELECTOR)).filter((b) => {
    const text = b instanceof HTMLInputElement ? b.value : (b.textContent ?? '');
    return isAddButtonText(cleanEvidenceText(text));
  });
  return [...buttons, ...plainAddButtons(root)];
}

/**
 * The card of a single-entry section: the highest ancestor of `el` (below the section root) that holds
 * all of the section's controls but not the add button, with pure wrapper chains (one child) unwrapped.
 * "Highest without the button" is the card in antd (card + button live in the same body) and the list
 * wrapper in native pages (unwrapped down to the card).
 */
function singleCard(el: Element, sectionRoot: Element, buttons: Element[]): Element | null {
  const total = countControls(sectionRoot);
  let nearest: Element | null = null;
  let highest: Element | null = null;
  for (let a = composedParent(el); a && a !== sectionRoot; a = composedParent(a)) {
    if (countControls(a) !== total || total < 2) continue;
    nearest ??= a;
    if (!buttons.some((b) => a.contains(b))) highest = a;
  }
  let card = highest ?? nearest;
  while (card && card.children.length === 1 && countControls(card.children[0]!) === total) card = card.children[0]!;
  return card;
}

/**
 * The repeated card ("第 N 段经历") a control sits in, bounded by `sectionRoot`.
 * Single-card sections that offer an add button report index 0 with the card as root.
 */
export function findGroup(el: Element, sectionRoot: Element | null, sectionTitle?: string | null): FieldGroup | null {
  const title = sectionTitle !== undefined ? sectionTitle : (resolveSection(el)?.title ?? null);
  const keyOf = (card: Element) => `${title ?? ''}|${signature(card)}`;

  for (let a = composedParent(el); a && a !== sectionRoot && !PAGE_ROOT.test(a.tagName); a = composedParent(a)) {
    const members = cardMembers(a);
    if (members) return { key: keyOf(a), index: members.indexOf(a), root: a };
  }

  if (sectionRoot && !PAGE_ROOT.test(sectionRoot.tagName)) {
    const buttons = findAddButtons(sectionRoot);
    const card = buttons.length > 0 ? singleCard(el, sectionRoot, buttons) : null;
    if (card) return { key: keyOf(card), index: 0, root: card };
  }
  return null;
}

// ---- context ---------------------------------------------------------------------------------------------------

export function buildFieldContext(control: Control): FieldContext {
  const { evidence, required } = analyzeControl(control);
  const section: { title: string; root: Element; note?: string } | null = control.fixedSection ?? resolveSection(control.el);
  const group = findGroup(control.el, section?.root ?? null, section?.title ?? null);
  return {
    control,
    evidence,
    sectionTitle: section?.title ?? null,
    ...(section?.note ? { sectionNote: section.note } : {}),
    sectionRoot: section?.root ?? null,
    group,
    required,
  };
}
