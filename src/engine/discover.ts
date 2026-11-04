// Discover: find every fillable control in a document / shadow root.
// Library widgets (antd / Element Plus) are matched first and consume their inner inputs;
// everything else is reported as a native control.
import { resolveAdapter } from '../adapters/resolve';
import type { AtsAdapter } from '../adapters/types';
import { resolveCode } from '../dictionary/options';
import {
  ANSWER_BUTTON_SELECTOR,
  ARIA_COMBOBOX_SELECTOR,
  LIBRARY_OVERLAY_SELECTOR,
  LIBRARY_ROOT_SELECTOR,
  detectDateGranularity,
  isAriaMultiple,
  isUnsupportedLibraryRoot,
  matchLibraryWidget,
  type LibraryWidget,
} from '../drivers/libraries';
import type { Control, OptionInfo } from './types';
import { isInputVisible, isVisible } from './visibility';

export interface DiscoverOptions {
  /** Id allocator, so a caller can keep ids stable across rescans. Called in document order. */
  idFor?: (el: HTMLElement) => string;
  /** The site's adapter; by default whichever one fits the page. */
  adapter?: AtsAdapter | null;
}

type Draft = Omit<Control, 'id'> & { inputs?: HTMLInputElement[] };

const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const NATIVE_SELECTOR = 'input, select, textarea, [contenteditable]';
const DISABLED_SELECTOR = '[disabled], [aria-disabled="true"]';
/** Phone widgets that keep the country with the number: intl-tel-input and react-phone-number-input. */
export const PHONE_WITH_CODE_SELECTOR = '.iti, .PhoneInput';

const PAGE_CHROME_SELECTOR = 'nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]';

const groupMembers = new WeakMap<Control, HTMLInputElement[]>();

/**
 * Radio / checkbox inputs that make up a radio or checkbox control (single-checkbox: itself).
 * Falls back to a DOM query when the control object was cloned.
 */
export function groupInputs(control: Control): HTMLInputElement[] {
  const known = groupMembers.get(control);
  if (known) return known.slice();
  if (control.el instanceof HTMLInputElement) return [control.el];
  const type = control.kind === 'radio' ? 'radio' : 'checkbox';
  return Array.from(control.el.querySelectorAll<HTMLInputElement>(`input[type=${type}]`));
}

function text(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function isDisabledEl(el: Element): boolean {
  if (el.matches(DISABLED_SELECTOR)) return true;
  try {
    return el.matches(':disabled');
  } catch {
    return false;
  }
}

function composedParent(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root.nodeType === 11 && 'host' in root ? (root as ShadowRoot).host : null;
}

function insideAny(el: Element, set: Set<Element>): boolean {
  for (let n: Element | null = el; n; n = composedParent(n)) if (set.has(n)) return true;
  return false;
}

function optionLabel(input: HTMLInputElement): string {
  const label = input.labels?.[0] ?? input.closest('label');
  const fromLabel = text(label?.textContent);
  if (fromLabel) return fromLabel;
  const sib = input.nextSibling;
  const fromSibling = text(sib?.textContent);
  if (fromSibling) return fromSibling;
  return text(input.getAttribute('aria-label')) || text(input.title) || input.value;
}

function inputOptions(inputs: HTMLInputElement[]): OptionInfo[] {
  return inputs.map((i) => ({ label: optionLabel(i), value: i.value, disabled: i.disabled }));
}

function selectOptions(select: HTMLSelectElement): OptionInfo[] {
  return Array.from(select.options).map((o) => ({
    label: text(o.label || o.textContent),
    value: o.value,
    disabled: o.disabled,
  }));
}

/** Lowest element containing all given elements (the element itself for a single one). */
function commonAncestor(els: HTMLElement[]): HTMLElement {
  const first = els[0]!;
  if (els.length === 1) return first;
  for (let n: HTMLElement | null = first.parentElement; n; n = n.parentElement) {
    if (els.every((e) => n!.contains(e))) return n;
  }
  return first;
}

function widgetDisabled(root: HTMLElement, widget: LibraryWidget): boolean {
  if (root.matches(DISABLED_SELECTOR)) return true;
  if (widget.disabled && (root.matches(widget.disabled) || root.querySelector(widget.disabled))) return true;
  const fields = Array.from(
    root.querySelectorAll<HTMLInputElement>('input:not([type=hidden]), select, textarea'),
  );
  return fields.length > 0 && fields.every((f) => f.disabled);
}

function buildWidgetDraft(root: HTMLElement, widget: LibraryWidget): Draft {
  const draft: Draft = { el: root, kind: widget.kind, lib: widget.lib };
  if (widget.kind === 'select' || widget.kind === 'cascader') {
    if (widget.multiple && (root.matches(widget.multiple) || root.querySelector(widget.multiple))) {
      draft.multiple = true;
    }
  } else if (widget.kind === 'date') {
    draft.dateGranularity = detectDateGranularity(root, widget);
  } else if (widget.kind === 'radio' || widget.kind === 'checkbox') {
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>(`input[type=${widget.kind}]`));
    draft.options = inputOptions(inputs);
    draft.inputs = inputs;
    if (widget.kind === 'checkbox') draft.multiple = true;
  }
  return draft;
}

function nativeKey(map: Map<unknown, Map<string, HTMLInputElement[]>>, form: unknown, name: string) {
  let byName = map.get(form);
  if (!byName) map.set(form, (byName = new Map()));
  let list = byName.get(name);
  if (!list) byName.set(name, (list = []));
  return list;
}

function isRichtextHost(el: Element): boolean {
  const v = el.getAttribute('contenteditable');
  if (v === null) return false;
  const value = v.toLowerCase();
  if (value !== 'true' && value !== '' && value !== 'plaintext-only') return false;
  // Only the outermost editable element is the editor.
  const parent = el.parentElement?.closest('[contenteditable]');
  if (parent) {
    const pv = parent.getAttribute('contenteditable')?.toLowerCase();
    if (pv === 'true' || pv === '' || pv === 'plaintext-only') return false;
  }
  return true;
}

/** Exactly Yes and No, and nothing else to fill in that element but at most one hidden checkbox or radio. */
function isYesNoGroup(group: HTMLElement, buttons: HTMLElement[]): boolean {
  if (buttons.length !== 2) return false;
  const codes = buttons.map((b) => resolveCode('yesNo', text(b.textContent)));
  if (!codes.includes('yes') || !codes.includes('no')) return false;
  const others = Array.from(group.querySelectorAll<HTMLInputElement>('input:not([type=hidden]), select, textarea, [contenteditable], [role=combobox]'));
  return others.length === 0 || (others.length === 1 && /^(?:checkbox|radio)$/.test(others[0]!.type ?? ''));
}

function scanScope(scope: Document | ShadowRoot, out: Draft[], adapter: AtsAdapter | null): void {
  // 1. Library widget roots (outermost wins). Disabled / unsupported / hidden ones still
  //    consume their inner inputs.
  const blocked = new Set<Element>();
  const candidates = new Map<Element, Draft>();
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(LIBRARY_ROOT_SELECTOR))) {
    if (insideAny(el, blocked)) continue;
    blocked.add(el);
    if (isUnsupportedLibraryRoot(el)) continue;
    const widget = matchLibraryWidget(el);
    if (!widget || widgetDisabled(el, widget) || !isVisible(el)) continue;
    candidates.set(el, buildWidgetDraft(el, widget));
  }

  // Search boxes an adapter names are plain inputs that only look like text boxes.
  for (const { input, ...search } of adapter?.searchBoxes ?? []) {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(input))) {
      if (insideAny(el, blocked)) continue;
      blocked.add(el);
      if (isDisabledEl(el) || !isVisible(el)) continue;
      candidates.set(el, { el, kind: 'select', lib: 'search', search });
    }
  }

  for (const { input, ...prompt } of adapter?.prompts ?? []) {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(input))) {
      if (insideAny(el, blocked)) continue;
      blocked.add(el);
      if (isDisabledEl(el) || !isVisible(el)) continue;
      candidates.set(el, { el, kind: 'select', lib: 'workday', prompt });
    }
  }

  // 2. Comboboxes outside those libraries consume their inner inputs too.
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(ARIA_COMBOBOX_SELECTOR))) {
    if (insideAny(el, blocked) || el.closest(LIBRARY_OVERLAY_SELECTOR)) continue;
    blocked.add(el);
    if (isDisabledEl(el) || !isVisible(el)) continue;
    // A language switcher or site search: part of the page around the form.
    if (el.closest(PAGE_CHROME_SELECTOR) && !el.closest('form')) continue;
    // The country picker of a phone box follows the number written in the box.
    if (el.closest(PHONE_WITH_CODE_SELECTOR)) continue;
    const draft: Draft = { el, kind: 'select', lib: 'aria' };
    if (isAriaMultiple(el)) draft.multiple = true;
    candidates.set(el, draft);
  }

  // Answer buttons: Yes and No side by side, usually with one hidden input behind them.
  const buttonGroups = new Set<HTMLElement>();
  for (const button of Array.from(scope.querySelectorAll<HTMLElement>(ANSWER_BUTTON_SELECTOR))) {
    const group = button.parentElement;
    if (group && !insideAny(group, blocked)) buttonGroups.add(group);
  }
  for (const group of buttonGroups) {
    const buttons = Array.from(group.querySelectorAll<HTMLElement>(`:scope > ${ANSWER_BUTTON_SELECTOR}`));
    if (!isYesNoGroup(group, buttons)) continue;
    blocked.add(group);
    if (!isVisible(group) || buttons.every(isDisabledEl)) continue;
    const options = buttons.map((b) => ({ label: text(b.textContent), disabled: isDisabledEl(b) }));
    candidates.set(group, { el: group, kind: 'radio', lib: 'aria', options });
  }

  // 3. Native controls.
  const radios = new Map<unknown, Map<string, HTMLInputElement[]>>();
  const checkboxes = new Map<unknown, Map<string, HTMLInputElement[]>>();
  const radioGroups = new Map<Element, HTMLInputElement[]>();
  const nativeGroups: { kind: 'radio' | 'checkbox'; inputs: HTMLInputElement[] }[] = [];

  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(NATIVE_SELECTOR))) {
    if (insideAny(el, blocked) || el.closest(LIBRARY_OVERLAY_SELECTOR)) continue;

    if (el instanceof HTMLInputElement) {
      const type = el.type.toLowerCase();
      if (EXCLUDED_INPUT_TYPES.has(type)) continue;
      if (type === 'radio') {
        const group = el.name
          ? nativeKey(radios, el.form, el.name)
          : (() => {
              const rg = el.closest('[role=radiogroup]');
              if (!rg) return [] as HTMLInputElement[];
              let list = radioGroups.get(rg);
              if (!list) radioGroups.set(rg, (list = []));
              return list;
            })();
        if (group.length === 0) nativeGroups.push({ kind: 'radio', inputs: group });
        group.push(el);
        continue;
      }
      if (type === 'checkbox') {
        // Checkboxes only group by name; nameless ones stay single.
        const group = el.name ? nativeKey(checkboxes, el.form, el.name) : [];
        if (group.length === 0) nativeGroups.push({ kind: 'checkbox', inputs: group });
        group.push(el);
        continue;
      }
      if (isDisabledEl(el) || !isInputVisible(el)) continue;
      if (type === 'file') {
        candidates.set(el, { el, kind: 'file', lib: 'native', inputType: 'file' });
      } else if (type === 'date' || type === 'month') {
        candidates.set(el, {
          el,
          kind: 'date',
          lib: 'native',
          inputType: type,
          dateGranularity: type === 'month' ? 'month' : 'day',
        });
      } else if (!el.closest('[aria-hidden="true"]')) {
        // aria-hidden: a companion a widget renders for validation, or a trap for robots. Not a field either way.
        candidates.set(el, { el, kind: 'text', lib: 'native', inputType: type });
      }
    } else if (el instanceof HTMLSelectElement) {
      if (isDisabledEl(el) || !isVisible(el)) continue;
      candidates.set(el, {
        el,
        kind: 'select',
        lib: 'native',
        multiple: el.multiple,
        options: selectOptions(el),
      });
    } else if (el instanceof HTMLTextAreaElement) {
      if (isDisabledEl(el) || !isVisible(el)) continue;
      candidates.set(el, { el, kind: 'textarea', lib: 'native' });
    } else if (isRichtextHost(el)) {
      if (isDisabledEl(el) || !isVisible(el)) continue;
      candidates.set(el, { el, kind: 'richtext', lib: 'native' });
    }
  }

  for (const { kind, inputs } of nativeGroups) {
    if (inputs.every(isDisabledEl) || !inputs.some(isInputVisible)) continue;
    const first = inputs[0]!;
    if (kind === 'radio') {
      candidates.set(first, {
        el: commonAncestor(inputs),
        kind: 'radio',
        lib: 'native',
        options: inputOptions(inputs),
        inputs,
      });
    } else if (inputs.length >= 2) {
      candidates.set(first, {
        el: commonAncestor(inputs),
        kind: 'checkbox',
        lib: 'native',
        multiple: true,
        options: inputOptions(inputs),
        inputs,
      });
    } else {
      candidates.set(first, { el: first, kind: 'checkbox', lib: 'native', inputType: 'checkbox', inputs });
    }
  }

  // 4. Emit in document order, descending into open shadow roots at the host position.
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
    const draft = candidates.get(el);
    if (draft) out.push(draft);
    if (el.shadowRoot) scanScope(el.shadowRoot, out, adapter);
  }
}

function questionTextOf(el: HTMLElement, adapter: AtsAdapter): string | null {
  for (const q of adapter.questions ?? []) {
    // A group of radio buttons has a box around them as its element.
    if (!el.matches(q.control) && !el.querySelector(q.control)) continue;
    const text = el.closest(q.within)?.querySelector(q.text)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

export function discover(root: Document | ShadowRoot, opts: DiscoverOptions = {}): Control[] {
  const adapter = opts.adapter === undefined ? resolveAdapter(root) : opts.adapter;
  const drafts: Draft[] = [];
  scanScope(root, drafts, adapter);
  let counter = 0;
  const skip = adapter?.skip ?? [];
  const wanted = drafts.filter((d) => !skip.some((s) => d.el.matches(s)));
  return wanted.map(({ inputs, ...rest }) => {
    const control: Control = { id: opts.idFor ? opts.idFor(rest.el) : `c${++counter}`, ...rest };
    const question = adapter ? questionTextOf(rest.el, adapter) : null;
    if (question) control.questionText = question;
    const fixed = adapter?.labels?.find((l) => rest.el.matches(l.control));
    if (fixed) control.fixedLabel = fixed.label;
    for (const editor of adapter?.editors ?? []) {
      const root = rest.el.closest(editor.root);
      if (root) control.fixedSection = { title: editor.title, root };
    }
    if (inputs) groupMembers.set(control, inputs);
    return control;
  });
}
