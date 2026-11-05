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
import type { Control, FieldContext, FieldGroup } from './types';

export interface SectionInfo {
  title: string;
  root: Element;
  /** The heading element the title came from. */
  heading: Element;
}

const MAX_CLASS_HEADING = 30;
/** Class-name guess for headings; library internals (form items, selects, tables...) are excluded. */
const CLASS_HEADING = /title|header|heading/i;
const CLASS_NOT_HEADING = /(?:^|\s)(?:ant|el)-(?:form|select|input|picker|table|cascader|upload|radio|checkbox|steps|menu)/i;
const PAGE_ROOT = /^(?:BODY|HTML)$/;
const ADD_BUTTON_SELECTOR = 'button, a, [role=button], input[type=button], .ant-btn, .el-button';
const DIGEST_SIMILARITY = 0.6;

// ---- numbering ------------------------------------------------------------------------------------------------

/** "教育经历 1" / "Employment #2" / "实习经历（2）" / "第2段教育经历" → the un-numbered title. */
export function stripNumbering(title: string): string {
  const t = title.trim();
  const stripped = t
    .replace(/^第\s*[0-9一二三四五六七八九十百]+\s*[段条项个份]\s*/, '')
    .replace(/\s*[#＃]?\s*[(（[]?\s*\d+\s*[)）\]]?$/, '')
    .trim();
  return stripped || t;
}

const isNumbered = (title: string): boolean => stripNumbering(title) !== title.trim();

// ---- DOM helpers -----------------------------------------------------------------------------------------------

function composedParent(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root.nodeType === 11 && 'host' in root ? (root as ShadowRoot).host : null;
}

function fieldCount(root: Element): number {
  return root.querySelectorAll(FIELD_SELECTOR).length;
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

/** The heading a previous sibling `s` provides for `parent`, or null. */
function headingOf(s: Element, parent: Element): { title: string; heading: Element } | null {
  if (containsField(s)) return null;
  const strict = s.matches(STRICT_HEADING_SELECTOR) ? s : s.querySelector(STRICT_HEADING_SELECTOR);
  if (strict) {
    const title = headingText(strict, Number.MAX_SAFE_INTEGER);
    return title ? { title, heading: strict } : null;
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
  return null;
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
      if (hit) return { ...hit, root: parent };
    }
    node = parent;
  }
  return null;
}

/**
 * Section of a control for classification: the nearest heading that is not the repeated card's own
 * (numbered) title — "教育经历" rather than "教育经历 1" — falling back to the stripped card title.
 */
function resolveSection(el: Element): { title: string; root: Element } | null {
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

function signature(el: Element): string {
  const classes = (el.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((c) => c && !isStateClass(c))
    .sort();
  return el.tagName.toLowerCase() + (classes.length > 0 ? `.${classes.join('.')}` : '');
}

const digestKey = (s: string): string => normalizeLabel(s).replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

/** Normalized label texts of a block (numbers dropped), falling back to placeholders / names. */
function labelDigest(root: Element): Set<string> {
  const set = new Set<string>();
  for (const l of Array.from(root.querySelectorAll('label, th, legend, .ant-form-item-label, .el-form-item__label'))) {
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
  const members = Array.from(parent.children).filter(
    (ch) => ch === a || (signature(ch) === sig && countControls(ch) >= 1 && similar(labelDigest(ch), digest)),
  );
  return members.length >= 2 ? members : null;
}

function findAddButtons(root: Element): Element[] {
  return Array.from(root.querySelectorAll(ADD_BUTTON_SELECTOR)).filter((b) => {
    const text = b instanceof HTMLInputElement ? b.value : (b.textContent ?? '');
    return isAddButtonText(cleanEvidenceText(text));
  });
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
  const section = control.fixedSection ?? resolveSection(control.el);
  const group = findGroup(control.el, section?.root ?? null, section?.title ?? null);
  return {
    control,
    evidence,
    sectionTitle: section?.title ?? null,
    sectionRoot: section?.root ?? null,
    group,
    required,
  };
}
