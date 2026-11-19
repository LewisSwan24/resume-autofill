// Declarative table of UI-library widgets (antd v5 / Element Plus 2.x).
// `discover` uses `lib`, `kind`, `root` (+ `disabled`, `multiple`, `granularityAttr`);
// the drivers (Tasks 15/16) use the remaining selectors. Selector values other than
// `root` are best-effort hints that the driver tasks may refine.
import type { ControlKind, UiLib } from '../engine/types';

export interface LibraryWidget {
  lib: UiLib;
  kind: ControlKind;
  /** Widget root selector. Entries are tried in table order: first match wins. */
  root: string;
  /** Element that opens the dropdown / receives the click. */
  trigger?: string;
  /** The inner text input (search / display input). */
  input?: string;
  /** Open dropdown panel (usually teleported to <body>). */
  dropdown?: string;
  /** One option inside the dropdown. */
  option?: string;
  /** Element showing the current selection inside the root. */
  selected?: string;
  /** One answer of a radio group that has no inputs behind it, and the part of it that says the answer. */
  answer?: { option: string; label: string };
  /** Attribute (on root or inner input) that overrides date granularity: day | month | year. */
  granularityAttr?: string;
  /** Selector matched against the root or any descendant; a hit means the widget is disabled. */
  disabled?: string;
  /** Selector matched against the root or any descendant; a hit means multi-select. */
  multiple?: string;
  /** What the root alone cannot say: a further test of the element it matched. */
  when?: (root: Element) => boolean;
}

/** Widgets that exist but are not supported in M1: their inner inputs are consumed and nothing is reported. */
export interface UnsupportedWidget {
  lib: UiLib;
  root: string;
  reason: string;
}

/** Attribute that lets a page (or a test fixture) force the date granularity of a picker. */
export const GRANULARITY_ATTR = 'data-granularity';

// NOTE: antd v5 Cascader root is `.ant-select.ant-cascader`, so cascader must precede select.
export const LIBRARY_WIDGETS: LibraryWidget[] = [
  // ---- Moka. Build hashes end every class, so these go by what comes before ----
  { lib: 'moka', kind: 'date', root: '.month-range-select' },
  { lib: 'moka', kind: 'date', root: 'label[class*="sd-Input-container"].day_info' },
  { lib: 'moka', kind: 'cascader', root: '[class*="sd-Input-tag-container"]' },
  { lib: 'moka', kind: 'select', root: 'label[class*="sd-Select-container"]' },

  // ---- Beisen (北森, zhiye.com): one box for lists, dates and places alike; a date says so by its icon ----
  { lib: 'beisen', kind: 'date', root: '.phoenix-select', when: (el) => el.querySelector('.phoenix-select__switchArrow [id*="field_date"]') !== null },
  { lib: 'beisen', kind: 'select', root: '.phoenix-select', multiple: '.phoenix-select--multi' },
  { lib: 'beisen', kind: 'radio', root: '.phoenix-radio-group', answer: { option: '.phoenix-radio', label: '[class*="radio__radio-text"]' } },

  // ---- Feishu recruiting ----
  { lib: 'feishu', kind: 'date', root: '.throne-biz-date-range-picker-wrapper' },
  { lib: 'feishu', kind: 'date', root: '.ud__picker' },
  { lib: 'feishu', kind: 'select', root: '.ud__select' },
  // On a phone (/index/m/): no inputs at all, a tap opens a drawer. The phone number is plain text from the login.
  { lib: 'feishu', kind: 'date', root: '.atsx-mperiod' },
  { lib: 'feishu', kind: 'select', root: '.atsx-mselect' },
  { lib: 'feishu', kind: 'select', root: '.atsx-m-input-select-warp' },
  { lib: 'feishu', kind: 'select', root: '.atsx-mSelectTreeInput' },

  // ---- antd v5 ----
  {
    lib: 'antd',
    kind: 'cascader',
    root: '.ant-cascader',
    trigger: '.ant-select-selector',
    input: 'input.ant-select-selection-search-input',
    dropdown: '.ant-cascader-dropdown:not(.ant-select-dropdown-hidden)',
    option: '.ant-cascader-menu-item',
    selected: '.ant-select-selection-item',
    disabled: '.ant-select-disabled',
    multiple: '.ant-select-multiple',
  },
  {
    lib: 'antd',
    kind: 'select',
    // AutoComplete is a free-text input with suggestions: its inner input stays a plain text control.
    root: '.ant-select:not(.ant-select-auto-complete)',
    trigger: '.ant-select-selector',
    input: 'input.ant-select-selection-search-input',
    dropdown: '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    option: '.ant-select-item-option',
    selected: '.ant-select-selection-item',
    disabled: '.ant-select-disabled',
    multiple: '.ant-select-multiple',
  },
  {
    lib: 'antd',
    kind: 'date',
    root: '.ant-picker',
    trigger: '.ant-picker-input',
    input: '.ant-picker-input input',
    dropdown: '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
    granularityAttr: GRANULARITY_ATTR,
    disabled: '.ant-picker-disabled',
  },
  { lib: 'antd', kind: 'radio', root: '.ant-radio-group', input: 'input[type=radio]' },
  { lib: 'antd', kind: 'checkbox', root: '.ant-checkbox-group', input: 'input[type=checkbox]' },
  { lib: 'antd', kind: 'file', root: '.ant-upload', input: 'input[type=file]', disabled: '.ant-upload-disabled' },

  // ---- Element Plus 2.x ----
  {
    lib: 'element',
    kind: 'cascader',
    root: '.el-cascader',
    trigger: '.el-input, .el-cascader__wrapper',
    input: 'input',
    dropdown: '.el-cascader__dropdown',
    option: '.el-cascader-node',
    disabled: '.is-disabled',
    multiple: '.el-cascader__tags',
  },
  {
    lib: 'element',
    kind: 'select',
    root: '.el-select',
    trigger: '.el-select__wrapper',
    input: 'input.el-select__input',
    dropdown: '.el-select__popper',
    option: '.el-select-dropdown__item',
    selected: '.el-select__selected-item',
    disabled: '.is-disabled',
    multiple: '.el-select__tags, .el-tag',
  },
  {
    lib: 'element',
    kind: 'date',
    root: '.el-date-editor',
    trigger: '.el-input__wrapper',
    input: 'input.el-input__inner',
    dropdown: '.el-picker__popper',
    granularityAttr: GRANULARITY_ATTR,
    disabled: '.is-disabled',
  },
  { lib: 'element', kind: 'radio', root: '.el-radio-group', input: 'input[type=radio]' },
  { lib: 'element', kind: 'checkbox', root: '.el-checkbox-group', input: 'input[type=checkbox]' },
  { lib: 'element', kind: 'file', root: '.el-upload', input: 'input[type=file]', disabled: '.is-disabled' },
];

/** Checked before LIBRARY_WIDGETS. Time and multi-date pickers are out of scope. */
export const LIBRARY_UNSUPPORTED: UnsupportedWidget[] = [
  {
    lib: 'element',
    root:
      '.el-date-editor--datetimerange, .el-date-editor--time, .el-date-editor--dates, ' +
      '.el-date-editor--months, .el-date-editor--years, .el-date-editor--week',
    reason: 'time / multi-date picker',
  },
];

/** Teleported popups: inputs inside them (search boxes, panel header inputs) are never form fields. */
export const LIBRARY_OVERLAY_SELECTOR = [
  '.ant-select-dropdown',
  '.ant-picker-dropdown',
  '.ant-cascader-dropdown',
  '.el-select-dropdown',
  '.el-select__popper',
  '.el-picker__popper',
  '.el-picker-panel',
  '.el-cascader__dropdown',
  '[class*="sd-Dropdown-dropdown"]',
  '.ud__select__dropdown',
  '.common-unmodeled-layer__layerContent',
  '.atsx-drawer',
].join(', ');

/** Selector matching every library root (widgets + unsupported), for one querySelectorAll. */
export const LIBRARY_ROOT_SELECTOR = [
  ...LIBRARY_UNSUPPORTED.map((u) => u.root),
  ...LIBRARY_WIDGETS.map((w) => w.root),
].join(', ');

/** Comboboxes outside the libraries above. A native select says role=combobox too, but is handled as a select. */
/** What a button says or shows when "pick one" really means a list opens. */
const PICK_ONE = /^(?:please\s+)?(?:select|choose|pick)(?:\s+(?:one|an?\s+option|option))?\s*(?:\.{3}|…)?$|^请选择$/i;

/** A picture after the words: how a dropdown looks. Before them it is how an action looks. */
function hasArrowAfterWords(el: Element): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let words: Node | null = walker.nextNode();
  while (words && !words.textContent?.trim()) words = walker.nextNode();
  if (!words) return false;
  if (el.querySelector('img')) return false;
  const pictures = Array.from(el.querySelectorAll('svg'));
  if (pictures.length !== 1 || !(words.compareDocumentPosition(pictures[0]!) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
  // One that says it points onward moves things on.
  for (let n: Element | null = pictures[0]!; n && n !== el; n = n.parentElement) {
    if (/right|next|forward|continue/i.test(n.getAttribute('class') ?? '')) return false;
  }
  return true;
}

/**
 * Clicking is all there is to find out what a button does, and "Select" can open a dialog or move the form on.
 * So the words are not enough: the button also has to say or show that it has a list behind it.
 */
export function isPromptButton(el: Element): boolean {
  if (el.tagName !== 'BUTTON' || (el.getAttribute('type') ?? 'submit').toLowerCase() !== 'button') return false;
  if (!PICK_ONE.test((el.textContent ?? '').replace(/\s+/g, ' ').trim())) return false;
  const popup = el.getAttribute('aria-haspopup');
  return (!!popup && popup !== 'false' && popup !== 'dialog') || el.hasAttribute('aria-expanded') || hasArrowAfterWords(el);
}

export const ARIA_COMBOBOX_SELECTOR =
  '[role=combobox]:not(select), button[aria-haspopup="listbox"], input[aria-haspopup="listbox"][aria-autocomplete="list"], input[aria-haspopup="listbox"][aria-autocomplete="both"]';

export const ANSWER_BUTTON_SELECTOR = 'button[aria-pressed]';

/**
 * The part of the page that shows this combobox's value. react-select keeps it beside the input, inside
 * its control box; a box holding another combobox is some page wrapper instead.
 */
export function ariaValueScope(el: HTMLElement): HTMLElement {
  const box = el.closest<HTMLElement>('[class*="__control"], [class*="-control"]');
  return box && box.querySelectorAll(ARIA_COMBOBOX_SELECTOR).length === 1 ? box : el;
}

export function isAriaMultiple(el: HTMLElement): boolean {
  return (
    el.getAttribute('aria-multiselectable') === 'true' ||
    ariaValueScope(el).querySelector('[class*="is-multi"], [class*="multi-value"]') !== null
  );
}

/** A picker that holds a start and an end in one field. */
export const isDateRangeRoot = (el: Element): boolean => el.matches('.ant-picker-range, .el-range-editor') ||
  (el.matches('.month-range-select') && el.querySelectorAll('input').length === 4) ||
  el.matches('.throne-biz-date-range-picker-wrapper, .atsx-mperiod');

export function isUnsupportedLibraryRoot(el: Element): UnsupportedWidget | undefined {
  return LIBRARY_UNSUPPORTED.find((u) => el.matches(u.root));
}

/** First table entry whose root matches (table order matters, e.g. cascader before select). */
export function matchLibraryWidget(el: Element): LibraryWidget | undefined {
  return LIBRARY_WIDGETS.find((w) => el.matches(w.root) && (!w.when || w.when(el)));
}

type Granularity = 'day' | 'month' | 'year';

function isGranularity(v: string | null | undefined): v is Granularity {
  return v === 'day' || v === 'month' || v === 'year';
}

function fromHint(text: string): Granularity | null {
  if (/日|day/i.test(text) || /DD/.test(text)) return 'day';
  if (/月|month/i.test(text) || /MM/.test(text)) return 'month';
  if (/年份|year/i.test(text) || /YYYY/.test(text)) return 'year';
  return null;
}

/**
 * Date granularity of a library picker.
 * Order: explicit attribute override → Element's `el-date-editor--<type>` class →
 * placeholder wording → antd's input `size` (= format length: 4 year, 7 month) → day.
 * antd adds no class to the root for `picker="month"`, hence the heuristics.
 */
export function detectDateGranularity(root: Element, widget: Pick<LibraryWidget, 'lib' | 'granularityAttr'>): Granularity {
  const input = root.querySelector('input');
  if (widget.granularityAttr) {
    const forced = root.getAttribute(widget.granularityAttr) ?? input?.getAttribute(widget.granularityAttr);
    if (isGranularity(forced)) return forced;
  }
  // Year and month is all either of Moka's date widgets asks.
  if (widget.lib === 'moka') return 'month';
  if (root.matches('.throne-biz-date-range-picker-wrapper, .atsx-mperiod')) return 'month';
  // Beisen's box opens a day calendar or a month panel, and only opening it tells which: ask for the day.
  if (widget.lib === 'beisen') return 'day';
  if (widget.lib === 'element') {
    if (root.classList.contains('el-date-editor--month') || root.classList.contains('el-date-editor--monthrange')) return 'month';
    if (root.classList.contains('el-date-editor--year') || root.classList.contains('el-date-editor--yearrange')) return 'year';
    if (root.classList.contains('el-date-editor--date') || root.classList.contains('el-date-editor--daterange') || root.classList.contains('el-date-editor--datetime')) {
      return 'day';
    }
  }
  const hinted = fromHint(input?.getAttribute('placeholder') ?? '');
  if (hinted) return hinted;
  const size = Number(input?.getAttribute('size'));
  if (size === 4) return 'year';
  if (size === 7) return 'month';
  return 'day';
}

/** Moka's country code beside a phone number. It says +86 until changed, and nothing on the resume needs that. */
export const isMokaDialCode = (el: Element): boolean => el.closest('[class^="code-"]') !== null;
