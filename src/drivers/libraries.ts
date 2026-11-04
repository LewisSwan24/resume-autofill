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
  /** Attribute (on root or inner input) that overrides date granularity: day | month | year. */
  granularityAttr?: string;
  /** Selector matched against the root or any descendant; a hit means the widget is disabled. */
  disabled?: string;
  /** Selector matched against the root or any descendant; a hit means multi-select. */
  multiple?: string;
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

/** Checked before LIBRARY_WIDGETS. Range / time / multi-date pickers are out of M1 scope. */
export const LIBRARY_UNSUPPORTED: UnsupportedWidget[] = [
  { lib: 'antd', root: '.ant-picker-range', reason: 'range picker' },
  {
    lib: 'element',
    root:
      '.el-date-editor.el-range-editor, .el-date-editor--time, .el-date-editor--dates, ' +
      '.el-date-editor--months, .el-date-editor--years, .el-date-editor--week',
    reason: 'range / time / multi-date picker',
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
].join(', ');

/** Selector matching every library root (widgets + unsupported), for one querySelectorAll. */
export const LIBRARY_ROOT_SELECTOR = [
  ...LIBRARY_UNSUPPORTED.map((u) => u.root),
  ...LIBRARY_WIDGETS.map((w) => w.root),
].join(', ');

/** Comboboxes outside the libraries above. A native select says role=combobox too, but is handled as a select. */
export const ARIA_COMBOBOX_SELECTOR = '[role=combobox]:not(select), button[aria-haspopup="listbox"]';

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

export function isUnsupportedLibraryRoot(el: Element): UnsupportedWidget | undefined {
  return LIBRARY_UNSUPPORTED.find((u) => el.matches(u.root));
}

/** First table entry whose root matches (table order matters, e.g. cascader before select). */
export function matchLibraryWidget(el: Element): LibraryWidget | undefined {
  return LIBRARY_WIDGETS.find((w) => el.matches(w.root));
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
  if (widget.lib === 'element') {
    if (root.classList.contains('el-date-editor--month')) return 'month';
    if (root.classList.contains('el-date-editor--year')) return 'year';
    if (root.classList.contains('el-date-editor--date') || root.classList.contains('el-date-editor--datetime')) {
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
