// The judge's own view of the page. Deliberately shares nothing with the drivers: a driver's read() must not
// grade its own write. `inspectInPage` runs inside the page and is self-contained for that reason.
import type { Frame, Page } from '@playwright/test';
import type { CapturedExpected, Inspection, Reading } from '../shared/capturedExpectations';

/** Name → selector, for everything the scorer has to look at. */
export type Locators = Record<string, string>;

/** A selector with this prefix only has to match some element: see `CapturedField.exists`. */
const EXISTS_PREFIX = 'exists:';
/** A selector with this prefix reads the text of everything it matches: see `__entries`. */
const ENTRIES_PREFIX = 'entries:';
/** A selector with this prefix names boxes that show an answer with no input behind them: see `CapturedField.shown`. */
const SHOWN_PREFIX = 'shown:';

export function locatorsOf(expected: CapturedExpected): Locators {
  const out: Locators = {};
  for (const [label, f] of Object.entries(expected.fields)) out[label] = f.exists ? `${EXISTS_PREFIX}${f.selector}` : f.shown ? `${SHOWN_PREFIX}${f.selector}` : f.selector;
  for (const [label, g] of Object.entries(expected.__knownGaps ?? {})) out[label] = g.shown ? `${SHOWN_PREFIX}${g.selector}` : g.selector;
  for (const [label, r] of Object.entries(expected.__review ?? {})) out[label] = r.shown ? `${SHOWN_PREFIX}${r.selector}` : r.selector;
  for (const [label, r] of Object.entries(expected.__leaveEmpty ?? {})) out[label] = r.selector;
  // Read as shown boxes so that every one the selector finds is covered, not only the first.
  for (const [label, r] of Object.entries(expected.__pageOwn ?? {})) out[label] = `${SHOWN_PREFIX}${r.selector}`;
  for (const [label, e] of Object.entries(expected.__entries ?? {})) out[label] = `${ENTRIES_PREFIX}${e.selector}`;
  return out;
}

export function inspectInPage(locators: Locators): Inspection {
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  // A box that shows its hint until something is chosen (请选择 on Feishu's phone pickers) marks the hint a placeholder.
  const shownText = (el: Element): string => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll('[class*="placeholder"]').forEach((p) => p.remove());
    return squash(copy.textContent);
  };

  const roots: ParentNode[] = [document];
  const walkRoots = (root: ParentNode): void => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        walkRoots(el.shadowRoot);
      }
    }
  };
  walkRoots(document);
  const queryAll = (selector: string): Element[] => roots.flatMap((r) => [...r.querySelectorAll(selector)]);

  type FormEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const typeOf = (el: FormEl): string => (el.tagName === 'INPUT' ? ((el as HTMLInputElement).type || 'text').toLowerCase() : el.tagName.toLowerCase());

  // A custom select shows its value outside the input: react-select keeps the input itself empty.
  const shownNear = (el: Element): string => {
    let scope: Element | null = el.closest('[class*="control"]');
    if (!scope) {
      scope = el;
      for (let i = 0; i < 3 && scope?.parentElement; i++) scope = scope.parentElement;
    }
    const shown = scope?.querySelectorAll('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"],[class*="multiValue"]');
    return shown ? [...shown].map((s) => squash(s.textContent)).join(', ') : '';
  };

  const optionLabel = (el: HTMLInputElement): string => {
    const byLabel = el.labels?.[0]?.textContent;
    return squash(byLabel || el.getAttribute('aria-label') || el.value);
  };

  // Zoho's Lyte lists have no input: one answer shows as a label, several as tags, the phone's country as its code.
  const LYTE_LIST = 'crux-picklist-component lyte-dropdown, crux-phone-component lyte-dropdown';
  const lyteShown = (el: Element): string | string[] => {
    const tags = el.querySelector('ul.lyteMultipleSelect');
    if (tags) return [...tags.querySelectorAll(':scope > li[data-value]')].map((li) => li.getAttribute('data-value') ?? '');
    const country = el.querySelector('lyte-yield[selected-value]');
    if (country) return country.getAttribute('selected-value') ?? '';
    return squash(el.querySelector('.lyteDropdownLabel')?.textContent);
  };

  // Moka's lists keep their input empty: the choice is shown beside it, several choices as tags.
  const mokaShown = (el: FormEl): string | string[] | null => {
    const label = el.closest('label[class*="sd-Select-container"]');
    if (!label) return null;
    if (label.querySelector('[class*="sd-Input-tag-container"]')) return [...label.querySelectorAll('[class*="sd-Tag-text"]')].map((t) => squash(t.textContent));
    return squash(label.querySelector('[class*="sd-Input-display-value"]')?.textContent) || el.value;
  };

  const single = (el: FormEl): string | boolean | string[] => {
    if (el.matches(LYTE_LIST)) return lyteShown(el);
    const type = typeOf(el);
    const moka = type === 'text' ? mokaShown(el) : null;
    if (moka !== null) return moka;
    // A list that is only a button shows its choice as the button's own text, and an editable box its own text.
    if (type === 'button') return squash(el.textContent);
    // An editable box that writes its hint as its own text, marked as a placeholder, is empty.
    if (el.hasAttribute('contenteditable')) return el.classList.contains('placeholder') ? '' : squash(el.textContent);
    if (shownBoxes.has(el)) return shownText(el);
    // A search-and-pick box keeps its choices as pills beside it: the text in it is not an answer.
    const pills = el.closest('[data-automation-id="multiSelectContainer"]');
    if (pills) return [...pills.querySelectorAll('[data-automation-id="selectedItem"] [data-automation-id="promptOption"]')].map((p) => squash(p.textContent)).join(', ');
    if (type === 'file') return [...((el as HTMLInputElement).files ?? [])].map((f) => f.name);
    if (type === 'checkbox' || type === 'radio') return (el as HTMLInputElement).checked;
    if (type === 'select') {
      const select = el as HTMLSelectElement;
      const chosen = [...select.selectedOptions].filter((o) => o.value !== '');
      return select.multiple ? chosen.map((o) => squash(o.textContent)) : squash(chosen[0]?.textContent);
    }
    if (el.getAttribute('role') === 'combobox') {
      const shown = shownNear(el);
      return shown || el.value;
    }
    return el.value;
  };

  // ---- every control, for the "nothing else changed" check
  const listButton = 'button[aria-haspopup="listbox"]';
  // A plain button that opens a list has nothing to show it for one, except a verdict naming it.
  const namedButtons = new Set(
    Object.values(locators)
      .filter((s) => !/^(?:exists|entries|shown):/.test(s))
      .flatMap((s) => queryAll(s).filter((el) => el.tagName === 'BUTTON')),
  );
  // A box that only shows its answer, a date on wheels with no input, as a verdict names it.
  const shownBoxes = new Set(
    Object.values(locators)
      .filter((s) => s.startsWith('shown:'))
      .flatMap((s) => queryAll(s.slice('shown:'.length))),
  );
  // A box the applicant types into with no input behind it (contenteditable) is one too, once a verdict names it.
  const namedEditables = new Set(
    Object.values(locators)
      .filter((s) => !/^(?:exists|entries|shown):/.test(s))
      .flatMap((s) => queryAll(s).filter((el) => el.hasAttribute('contenteditable'))),
  );
  const isControl = (el: Element): el is FormEl =>
    /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.matches(listButton) || el.matches(LYTE_LIST) || namedButtons.has(el) || namedEditables.has(el) || shownBoxes.has(el);
  const included = (el: FormEl): boolean => typeOf(el) !== 'hidden' && !/^g-recaptcha-response|^h-captcha-response/.test(el.name || el.id || '');
  // Feishu's formily form gives its boxes no id or name. The field's id on the row, and the card's place in its own
  // list, say which box it is, so a card added to one list does not renumber the boxes of the next.
  const formilyIdentity = (el: Element): string => {
    const row = el.closest('[data-form-field-id]');
    if (!row) return '';
    const card = row.closest('[class*="apply-form-array-card__"]');
    // A list is named by its id on a computer, and by its section's title on a phone, where it has none.
    const list = card?.closest('[id^="formily-item-"]')?.id ?? card?.closest('.moduleWrapper')?.querySelector('.moduleWrapper-text')?.textContent ?? '';
    const place = card ? `${list}[${[...card.parentElement!.children].indexOf(card)}]/` : '';
    return `%${place}${row.getAttribute('data-form-field-id')}`;
  };
  const keys = new Map<Element, string>();
  const used = new Map<string, number>();
  const snapshot: Record<string, string> = {};
  for (const el of [...queryAll(`input,select,textarea,${listButton},${LYTE_LIST}`), ...namedButtons, ...namedEditables, ...shownBoxes]) {
    if (keys.has(el)) continue;
    if (!isControl(el) || !included(el)) continue;
    const type = typeOf(el);
    const identity = el.id ? `#${el.id}` : el.name ? `@${el.name}` : formilyIdentity(el);
    const option = type === 'radio' || type === 'checkbox' ? `=${(el as HTMLInputElement).value}` : '';
    const base = `${type}${identity}${option}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    const key = n === 0 ? base : `${base}~${n}`;
    keys.set(el, key);
    const value = single(el);
    snapshot[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  // An untouched box and a missing one are the same thing to the comparison.
  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === 'false' || snapshot[key] === '[]') snapshot[key] = '';
  }

  // ---- what each named control holds
  const readings: Record<string, Reading> = {};
  const coverage: Record<string, string[]> = {};
  for (const [label, selector] of Object.entries(locators)) {
    if (selector.startsWith('exists:')) {
      readings[label] = queryAll(selector.slice('exists:'.length)).length > 0;
      coverage[label] = [];
      continue;
    }
    if (selector.startsWith('entries:')) {
      readings[label] = queryAll(selector.slice('entries:'.length)).map((el) => squash(el.textContent));
      coverage[label] = [];
      continue;
    }
    if (selector.startsWith('shown:')) {
      // A start and an end shown in two boxes read as one span.
      const boxes = queryAll(selector.slice('shown:'.length));
      coverage[label] = boxes.flatMap((el) => keys.get(el) ?? []);
      readings[label] = boxes.length === 0 ? null : boxes.every((b) => !shownText(b)) ? '' : boxes.map(shownText).join(' ~ ');
      continue;
    }
    const els = queryAll(selector).filter(isControl);
    if (els.length === 0) {
      readings[label] = null;
      coverage[label] = [];
      continue;
    }
    const first = els[0]!;
    const type = typeOf(first);
    // Only what is read is covered. Another control of the same kind the selector also finds, as the same box on a
    // second entry, stays in the comparison: a change there is caught unless a verdict of its own reads it.
    let read: Element[] = [first];
    if (type === 'radio') {
      const hit = els.find((el) => (el as HTMLInputElement).checked) as HTMLInputElement | undefined;
      readings[label] = hit ? optionLabel(hit) : '';
      read = els;
    } else if (type === 'checkbox' && els.length > 1) {
      readings[label] = (els as HTMLInputElement[]).filter((el) => el.checked).map(optionLabel);
      read = els;
    } else if (els.length > 1 && els.every((el) => el.closest('.month-range-select, .throne-biz-date-range-picker-wrapper') && typeOf(el) === 'text')) {
      // Year and month, or both ends of a span: one answer in several lists, read in order.
      readings[label] = els.map((el) => single(el)).filter((v) => typeof v === 'string' && v).join(' ');
      read = els;
    } else {
      readings[label] = single(first);
    }
    // A control of another kind the selector names with it is a part of the same field: the file box behind a button.
    const parts = els.filter((el) => !read.includes(el) && typeOf(el) !== type);
    coverage[label] = [...read, ...parts].flatMap((el) => keys.get(el) ?? []);
  }
  return { snapshot, readings, coverage };
}

export function inspect(target: Page | Frame, locators: Locators): Promise<Inspection> {
  return target.evaluate(inspectInPage, locators);
}

/**
 * Controls the engine finds on this page that no verdict covers, and verdicts that find nothing. Needs the
 * harness, because what counts as a control is the engine's own idea.
 */
export function unjudgedControls(target: Page | Frame, selectors: string[]): Promise<{ label: string; kind: string }[]> {
  return target.evaluate((wanted) => {
    const roots: ParentNode[] = [document];
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    const nodesOf = (selector: string): Element[] => roots.flatMap((r) => [...r.querySelectorAll(selector)]);
    const judged = wanted.map((selector) => ({ selector, nodes: nodesOf(selector) }));
    const { contexts } = window.__raf.scanDocument(document);
    const out: { label: string; kind: string }[] = [];
    for (const { control, evidence } of contexts) {
      const covered = judged.some(({ nodes }) => nodes.some((n) => control.el.contains(n) || n.contains(control.el)));
      if (!covered) out.push({ label: evidence[0]?.text ?? control.el.id ?? control.el.tagName, kind: control.kind });
    }
    for (const { selector, nodes } of judged) {
      if (nodes.length === 0) out.push({ label: `verdict finds nothing: ${selector}`, kind: '-' });
    }
    return out;
  }, selectors);
}
