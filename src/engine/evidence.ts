// Evidence: every piece of text that may tell us what a control is for (labels, aria, placeholders,
// table headers, nearby text, name/id), plus the "required" flag. Pure DOM reads, no side effects.
import { isAddButtonText, isDeleteText, normalizeLabel, resolveCode } from '../dictionary';
import { LIBRARY_OVERLAY_SELECTOR, LIBRARY_ROOT_SELECTOR } from '../drivers/libraries';
import { groupInputs } from './discover';
import { EVIDENCE_WEIGHTS, type Control, type Evidence, type EvidenceSource } from './types';

/** Native form fields (everything `discover` can report, minus buttons / hidden inputs). */
export const FIELD_SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), ' +
  'select, textarea, [contenteditable]:not([contenteditable=false])';

/** Elements that are headings for sure (as opposed to class-name guesses). */
export const STRICT_HEADING_SELECTOR =
  'h1, h2, h3, h4, h5, h6, legend, [role=heading], .ant-card-head-title, .el-card__header, .ant-divider-inner-text';

const FORM_ITEM_SELECTOR = '.ant-form-item, .el-form-item';
const MAX_TEXT = 80;
/** Forms ask whole questions, and a label or the line above a control is meant to be read as one. */
const MAX_LABEL_TEXT = 200;
const MAX_NEARBY = 120;
const MAX_NEARBY_LEVELS = 4;
/** Weight of a form-item label shared by several controls (e.g. phone country code + number). */
const SHARED_LABEL_WEIGHT = 0.6;
/** Weight of a wrapping label that merely names an answer (是 / 否 / Yes / No): the field's own label wins. */
const OPTION_LIKE_LABEL_WEIGHT = 0.55;

const TEXT_LIMITS: Partial<Record<EvidenceSource, number>> = {
  'label-for': MAX_LABEL_TEXT,
  'label-wrap': MAX_LABEL_TEXT,
  'aria-labelledby': MAX_LABEL_TEXT,
  'nearby-text': MAX_NEARBY,
};

/** True for labels that read as an answer to a yes/no question rather than as the question. */
export function isOptionLikeLabel(text: string): boolean {
  return resolveCode('yesNo', text.trim()) !== undefined;
}

// ---- text helpers ---------------------------------------------------------------------------------------

/** Trim, collapse whitespace, strip leading / trailing `:：*`; '' when empty or longer than 80 chars. */
export function cleanEvidenceText(raw: string | null | undefined, max: number = MAX_TEXT): string {
  let t = (raw ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
  t = t.replace(/^[\s*＊✱]+/, '').replace(/[\s:：*＊✱]+$/, '');
  return t.length > 0 && t.length <= max ? t : '';
}

/**
 * A label wrapped around its control: the words before the control, when there are any. What follows it
 * is often the widget's own messages, kept in the label so that clicking them focuses the control.
 */
function labelTextOf(label: Element, control: Element): string {
  const range = control.ownerDocument.createRange();
  range.selectNodeContents(label);
  range.setEndBefore(control);
  const before = textWithoutControls(range.cloneContents());
  return cleanEvidenceText(before, MAX_LABEL_TEXT) ? before : textWithoutControls(label);
}

/** Text of an element ignoring form controls, widgets, buttons and scripts inside it. */
export function textWithoutControls(el: Element | DocumentFragment): string {
  const clone = el.cloneNode(true) as Element | DocumentFragment;
  clone
    .querySelectorAll(`input, select, textarea, option, button, script, style, svg, [contenteditable], ${LIBRARY_ROOT_SELECTOR}`)
    .forEach((n) => n.remove());
  return clone.textContent ?? '';
}

/** Whether `el` is a field or contains one (library widgets always contain an input). */
export function containsField(el: Element): boolean {
  return el.matches(FIELD_SELECTOR) || el.querySelector(FIELD_SELECTOR) !== null;
}

const GENERATED_IDENT = /^(?::|rc[-_]|el-id|ember\d|react-|ui-id|radix-|headlessui|mui-|vue-|ant-)/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

/** `user[contact].phone-number` / `githubProfile` → "user contact phone number" / "github profile". */
function identWords(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s || GENERATED_IDENT.test(s) || UUID.test(s)) return '';
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.[\]]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^[0-9a-f]{8,}$/i.test(w))
    .join(' ')
    .toLowerCase();
  // A lone letter ("a", "x") is a test/placeholder id, not a field name.
  return words.length < 2 ? '' : words;
}

// ---- per-control context ----------------------------------------------------------------------------------

interface Ctx {
  control: Control;
  el: HTMLElement;
  root: Document | ShadowRoot;
  /** Radio group / checkbox group: its inputs' own labels are option labels, not field evidence. */
  optionGroup: boolean;
  /** Group inputs (radio / checkbox) or [el]. */
  inputs: Element[];
  /** Elements whose attributes (aria-*, placeholder, name, id, required) describe the control. */
  hosts: Element[];
  /** ids a `label[for]` / aria-labelledby may point at to name this control. */
  ids: Set<string>;
}

function rootOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r.nodeType === 9 || r.nodeType === 11 ? (r as Document | ShadowRoot) : el.ownerDocument;
}

function makeCtx(control: Control): Ctx {
  const el = control.el;
  const optionGroup = control.kind === 'radio' || (control.kind === 'checkbox' && !!control.options);
  const elIsField = el.matches(FIELD_SELECTOR);
  let hosts: Element[];
  const ids = new Set<string>();
  if (optionGroup) {
    hosts = [];
    if (!elIsField) {
      hosts.push(el);
      if (el.id) ids.add(el.id);
    }
    const role = el.closest('[role=radiogroup], [role=group]');
    if (role && !hosts.includes(role)) hosts.push(role);
    if (control.lib === 'aria') {
      for (const hidden of Array.from(el.querySelectorAll('input[name]'))) ids.add(hidden.getAttribute('name')!);
    }
  } else {
    hosts = elIsField ? [el] : [el, ...Array.from(el.querySelectorAll(FIELD_SELECTOR))];
    for (const h of hosts) if (h.id) ids.add(h.id);
  }
  return {
    control,
    el,
    root: rootOf(el),
    optionGroup,
    inputs: optionGroup ? groupInputs(control) : [el],
    hosts,
    ids,
  };
}

/** Whether `scope` holds a field that is not part of this control. */
function hasOtherFields(scope: Element, c: Ctx): boolean {
  for (const f of Array.from(scope.querySelectorAll(FIELD_SELECTOR))) {
    if (f === c.el || c.el.contains(f) || c.inputs.includes(f)) continue;
    if (f.closest(LIBRARY_OVERLAY_SELECTOR)) continue;
    return true;
  }
  return false;
}

// ---- individual sources -----------------------------------------------------------------------------------

function legendOf(c: Ctx): string | null {
  const fieldset = c.el.closest('fieldset');
  if (!fieldset || hasOtherFields(fieldset, c)) return null;
  const legend = Array.from(fieldset.children).find((ch) => ch.tagName === 'LEGEND');
  return legend ? textWithoutControls(legend) : null;
}

function columnStart(cell: HTMLTableCellElement): number {
  let col = 0;
  for (let s = cell.previousElementSibling; s; s = s.previousElementSibling) {
    col += (s as HTMLTableCellElement).colSpan || 1;
  }
  return col;
}

function tableHeaderTexts(c: Ctx): string[] {
  const cell = c.el.closest('td, th') as HTMLTableCellElement | null;
  const row = cell?.parentElement;
  const table = row?.closest('table');
  if (!cell || !row || row.tagName !== 'TR' || !table) return [];

  let headerRow: HTMLTableRowElement | null = null;
  const head = table.tHead;
  if (head && head.rows.length > 0) headerRow = head.rows[head.rows.length - 1] ?? null;
  else if (table.rows[0] && !containsField(table.rows[0])) headerRow = table.rows[0];
  if (headerRow === row) headerRow = null;

  const out: string[] = [];
  if (headerRow) {
    const start = columnStart(cell);
    let col = 0;
    for (const h of Array.from(headerRow.cells)) {
      const span = h.colSpan || 1;
      if (start >= col && start < col + span) {
        out.push(textWithoutControls(h));
        break;
      }
      col += span;
    }
  }
  for (const h of Array.from((row as HTMLTableRowElement).cells)) {
    if (h !== cell && h.tagName === 'TH') out.push(textWithoutControls(h));
  }
  return out;
}

function formItemLabel(item: Element): Element | null {
  const own = (n: Element | null) => (n && n.closest(FORM_ITEM_SELECTOR) === item ? n : null);
  return (
    own(item.querySelector('.ant-form-item-label label')) ??
    own(item.querySelector('.el-form-item__label')) ??
    own(item.querySelector('.ant-form-item-label'))
  );
}

function isHeadingLike(el: Element): boolean {
  return el.matches(STRICT_HEADING_SELECTOR) || el.querySelector(STRICT_HEADING_SELECTOR) !== null;
}

const SKIP_NEARBY_TAGS = new Set(['SCRIPT', 'STYLE', 'BR', 'OPTION', 'OPTGROUP', 'BUTTON', 'SVG', 'TEMPLATE']);

function acceptNearby(raw: string): string | null {
  const t = cleanEvidenceText(raw, MAX_NEARBY);
  if (!t || isAddButtonText(t) || isDeleteText(t)) return null;
  return t;
}

/**
 * First short text block before the control: previous siblings, then the siblings of each ancestor
 * (max 4 levels). Stops at the previous field, and never climbs into an ancestor that holds another field.
 */
function nearbyText(c: Ctx): string | null {
  let node: Element = c.el;
  for (let level = 0; level <= MAX_NEARBY_LEVELS; level++) {
    for (let s: Node | null = node.previousSibling; s; s = s.previousSibling) {
      if (s.nodeType === 3) {
        const t = acceptNearby(s.textContent ?? '');
        if (t) return t;
        continue;
      }
      if (s.nodeType !== 1) continue;
      const sib = s as Element;
      if (SKIP_NEARBY_TAGS.has(sib.tagName.toUpperCase()) || sib.matches('[role=button]')) continue;
      if (containsField(sib)) return null;
      if (isHeadingLike(sib)) continue;
      const t = acceptNearby(textWithoutControls(sib));
      if (t) return t;
    }
    const parent = node.parentElement;
    if (!parent || /^(BODY|HTML|FORM)$/.test(parent.tagName) || hasOtherFields(parent, c)) return null;
    node = parent;
  }
  return null;
}

// ---- value hints ------------------------------------------------------------------------------------------

const DIAL_CODE = /^\+\d{1,4}(?:\s|$|\()/;

/** Text of the option a select currently shows (library widgets and native selects); '' when none / placeholder. */
function selectedText(control: Control): string {
  const el = control.el;
  if (el instanceof HTMLSelectElement) return (el.selectedOptions[0]?.textContent ?? '').trim();
  const shown = el.querySelector(
    '.ant-select-selection-item, .el-select__selected-item:not(.is-transparent):not(.el-select__input-wrapper)',
  );
  return (shown?.getAttribute('title') ?? shown?.textContent ?? '').trim();
}

/**
 * A select that shows a dial code ("+86") is a country-code select, whatever its placeholder was: the
 * placeholder disappears with the selection (e.g. after a first fill run), leaving only the phone number's
 * shared form-item label.
 */
function dialCodeHint(c: Ctx, known: readonly string[]): string | null {
  if (c.control.kind !== 'select' || !DIAL_CODE.test(selectedText(c.control))) return null;
  return known.some((t) => /[\u3400-\u9fff]/.test(t)) ? '区号' : 'Country code';
}

// ---- assembly -------------------------------------------------------------------------------------------

export interface EvidenceAnalysis {
  evidence: Evidence[];
  required: boolean;
}

/** Evidence (sorted, de-duplicated) and the required flag of one control. */
export function analyzeControl(control: Control): EvidenceAnalysis {
  const c = makeCtx(control);
  const out: Evidence[] = [];
  let asterisk = false;

  const push = (source: EvidenceSource, raw: string | null | undefined, opts: { label?: boolean; weight?: number } = {}) => {
    if (opts.label && raw && /[*＊]/.test(raw)) asterisk = true;
    const text = cleanEvidenceText(raw, TEXT_LIMITS[source]);
    if (text) out.push({ source, text, weight: opts.weight ?? EVIDENCE_WEIGHTS[source] });
  };

  // label[for] → control (or inner input of a library widget)
  if (c.ids.size > 0) {
    for (const l of Array.from(c.root.querySelectorAll('label[for]'))) {
      if (c.ids.has(l.getAttribute('for') ?? '')) push('label-for', textWithoutControls(l), { label: true });
    }
  }
  // wrapping <label>
  if (!c.optionGroup) {
    const wrap = c.el.closest('label');
    const target = wrap?.getAttribute('for');
    if (wrap && (!target || c.ids.has(target))) {
      const text = labelTextOf(wrap, c.el);
      push('label-wrap', text, isOptionLikeLabel(cleanEvidenceText(text)) ? { label: true, weight: OPTION_LIKE_LABEL_WEIGHT } : { label: true });
    }
  }
  // aria-labelledby / aria-label
  for (const h of c.hosts) {
    const refs = (h.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    const parts = refs
      .filter((id) => id !== h.id)
      .map((id) => c.root.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => textWithoutControls(n));
    if (parts.length > 0) push('aria-labelledby', parts.join(' '));
  }
  for (const h of c.hosts) push('aria-label', h.getAttribute('aria-label'));
  // A single control inside [role=group][aria-labelledby] (Element Plus form items): the group label names it.
  if (!c.optionGroup) {
    const group = c.el.closest('[role=group][aria-labelledby]');
    if (group && !c.hosts.includes(group) && !hasOtherFields(group, c)) {
      const names = (group.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      const text = names.map((id) => c.root.getElementById(id)).filter((n): n is HTMLElement => !!n).map((n) => textWithoutControls(n)).join(' ');
      push('aria-labelledby', text);
    }
  }

  // library form-item label
  let labelOwned = true;
  let labelClassRequired = false;
  const item = c.el.closest(FORM_ITEM_SELECTOR);
  const itemLabel = item ? formItemLabel(item) : null;
  if (item && itemLabel) {
    const target = itemLabel.getAttribute('for');
    const matched = !!target && c.ids.has(target);
    const raw = textWithoutControls(itemLabel);
    if (matched || !hasOtherFields(item, c)) {
      if (!matched) push('label-for', raw, { label: true });
      labelClassRequired = itemLabel.classList.contains('ant-form-item-required');
    } else {
      // The label belongs to a sibling control (phone number next to its country code): keep it, weaker.
      labelOwned = false;
      push('nearby-text', raw, { weight: SHARED_LABEL_WEIGHT });
    }
  }

  // table headers
  for (const t of tableHeaderTexts(c)) push('table-header', t);
  // legend
  push('legend', legendOf(c));

  if (!c.optionGroup) {
    // placeholders
    for (const h of c.hosts) push('placeholder', h.getAttribute('placeholder'));
    for (const p of Array.from(c.el.querySelectorAll('.ant-select-selection-placeholder, .el-select__placeholder'))) {
      // Element Plus reuses .el-select__placeholder for the selected label; only the transparent one is a placeholder.
      if (p.classList.contains('el-select__placeholder') && !p.classList.contains('is-transparent')) continue;
      push('placeholder', p.textContent);
    }
    push('title-attr', c.el.getAttribute('title'));
  }

  // nearby text
  push('nearby-text', nearbyText(c));

  // name / id
  const first = c.inputs[0] as HTMLInputElement | undefined;
  const identSources = c.optionGroup
    ? [first?.getAttribute('name'), c.el.matches(FIELD_SELECTOR) ? null : c.el.id]
    : c.hosts.flatMap((h) => [h.getAttribute('name'), h.id]);
  for (const s of identSources) push('name-id', identWords(s));

  const hint = dialCodeHint(c, out.map((e) => e.text));
  if (hint) push('aria-label', hint);

  // sort by weight (stable), de-duplicate by normalized text keeping the heaviest
  const sorted = out.map((e, i) => ({ e, i })).sort((a, b) => b.e.weight - a.e.weight || a.i - b.i).map((x) => x.e);
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  for (const e of sorted) {
    const key = normalizeLabel(e.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    evidence.push(e);
  }

  const required =
    c.hosts.some((h) => h.hasAttribute('required') || h.getAttribute('aria-required') === 'true') ||
    c.inputs.some((i) => (i as HTMLInputElement).required === true) ||
    asterisk ||
    labelClassRequired ||
    (labelOwned && c.el.closest('.is-required') !== null);

  return { evidence, required };
}

export function collectEvidence(control: Control): Evidence[] {
  return analyzeControl(control).evidence;
}

export function collectRequired(control: Control): boolean {
  return analyzeControl(control).required;
}

