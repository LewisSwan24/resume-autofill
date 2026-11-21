// Feishu recruiting forms on a computer, in the atsx- generation campus portals run (antd 3 under its own prefix).
// A list is a box whose dropdown goes to the end of <body>, found through the box's aria-controls. A place is the
// same box with a tree in the dropdown: typing filters it and opens the path to what matches, and any level is
// picked by clicking its name, which the tree writes bare (广东, 深圳). A school is a combobox: the words typed go
// to the site's search, and a pick from its answer is written into the box. A span of months opens a panel of years
// and months for its start, then by itself for its end; it has no word for "still going".
import type { Control } from '../engine/types';
import { shutDropdown } from './dropdown';
import { fireInput, focusElement, setNativeValue, simulateClick } from './events';
import type { DatePart, Driver, DriverContext, FillIntent, FillResult, OptionMatcher } from './types';
import { waitFor } from './wait';

const HIDDEN = 'atsx-select-dropdown-hidden';
const ITEM = '.atsx-select-dropdown-menu-item';
const NODE = 'li[role="treeitem"]';
const NAME = ':scope > .atsx-tree-node-content-wrapper';
const SEARCH_FIELD = 'input.atsx-select-search__field';
const OPENS_MS = 1500;
const SETTLES_MS = 1500;
/** The site answers a search over the network. */
const SEARCH_MS = 3000;
/** A tree filters on the page itself. */
const FILTER_MS = 800;

type Level = { query: string; match: OptionMatcher };

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();
const fits = (level: Level, label: string): boolean => level.match([{ label }]).status === 'matched';

// ---- lists, places and schools: one box ----------------------------------------------------------------------------

const isCombobox = (control: Control) => control.el.classList.contains('atsx-select-combobox');
const fieldOf = (control: Control) => control.el.querySelector<HTMLInputElement>(SEARCH_FIELD);

/**
 * The box's dropdown while it is open. A list's content carries the id the box's aria-controls names; a tree's
 * carries none, and only the data-cy pair ties it to its box: current_cityInput, current_cityInputDropdown.
 */
function dropdownOf(control: Control): HTMLElement | null {
  const doc = control.el.ownerDocument;
  const selection = control.el.querySelector('.atsx-select-selection');
  const id = selection?.getAttribute('aria-controls');
  const cy = selection?.getAttribute('data-cy');
  const content = (id ? doc.getElementById(id) : null) ?? (cy ? doc.querySelector(`[data-cy="${CSS.escape(`${cy}Dropdown`)}"]`) : null);
  const dd = content?.closest<HTMLElement>('.atsx-select-dropdown');
  return dd && !dd.classList.contains(HIDDEN) ? dd : null;
}

function readBox(control: Control): string | null {
  if (isCombobox(control)) return clean(fieldOf(control)?.value) || null;
  const tags = Array.from(control.el.querySelectorAll('.atsx-select-selection__choice__content')).map((t) => clean(t.textContent)).filter(Boolean);
  if (tags.length > 0) return tags.join('、');
  return clean(control.el.querySelector('.atsx-select-selection-selected-value')?.textContent) || null;
}

const shut = (control: Control, ctx: DriverContext) => {
  if (dropdownOf(control)) shutDropdown(ctx.doc, () => dropdownOf(control) !== null);
};

async function open(control: Control, ctx: DriverContext): Promise<HTMLElement | null> {
  const already = dropdownOf(control);
  if (already) return already;
  simulateClick(control.el.querySelector('.atsx-select-selection') ?? control.el);
  return waitFor(() => dropdownOf(control), { timeout: OPENS_MS, signal: ctx.signal, root: ctx.doc });
}

async function taken(control: Control, label: string, ctx: DriverContext): Promise<boolean> {
  return (await waitFor(() => readBox(control) === label || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc })) === true;
}

function type(field: HTMLInputElement, words: string): void {
  focusElement(field);
  setNativeValue(field, words);
  fireInput(field, words);
}

async function fillBox(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`a ${intent.kind} answer on a list`, readBox(control));
  if (isCombobox(control)) return fillSchool(control, intent, ctx);
  const current = readBox(control);
  const levels: Level[] = [intent, ...(intent.wider ?? []), ...(intent.fallbacks ?? [])];
  if (current && levels.some((l) => fits(l, current))) return { ok: true, observed: current };
  const dd = await open(control, ctx);
  if (!dd) return failed('the list did not open', current);
  if (dd.querySelector('.atsx-select-tree-wrapper')) return fillPlace(control, intent, ctx);
  const options = Array.from(dd.querySelectorAll<HTMLElement>(ITEM)).map((el) => ({ el, info: { label: clean(el.textContent) } }));
  for (const level of levels) {
    const m = level.match(options.map((o) => o.info));
    if (m.status === 'ambiguous') {
      shut(control, ctx);
      return failed(`several answers fit ${level.query}`, current, 'needs_review');
    }
    if (m.status !== 'matched') continue;
    const chosen = options[m.index]!;
    simulateClick(chosen.el);
    if (await taken(control, chosen.info.label, ctx)) {
      shut(control, ctx);
      return { ok: true, observed: chosen.info.label };
    }
    shut(control, ctx);
    return failed('the list did not take the choice', readBox(control));
  }
  shut(control, ctx);
  return current ? failed('kept what the page already shows', current, 'needs_review') : failed(`nothing on the list for ${intent.query}`, null, 'no_option');
}

// ---- a place: a tree in the dropdown -------------------------------------------------------------------------------

const nameOf = (node: Element) => clean(node.querySelector(NAME)?.textContent);
function above(node: Element): string[] {
  const names: string[] = [];
  for (let up = node.parentElement?.closest(NODE); up; up = up.parentElement?.closest(NODE)) names.push(nameOf(up));
  return names;
}
/** The tree writes a place bare: 深圳, not 深圳市. */
const spellings = (query: string): string[] => [...new Set([query, query.replace(/(特别行政区|自治区|自治州|地区|省|市|区|县)$/, '')])].filter(Boolean);

async function fillPlace(control: Control, intent: Extract<FillIntent, { kind: 'choice' }>, ctx: DriverContext): Promise<FillResult> {
  const current = readBox(control);
  const field = fieldOf(control);
  if (!field) {
    shut(control, ctx);
    return failed('the places have no search', current);
  }
  const levels: Level[] = [intent, ...(intent.wider ?? [])];
  for (const [i, level] of levels.entries()) {
    const wider = levels.slice(i + 1);
    for (const words of spellings(level.query)) {
      type(field, words);
      const nodes = () =>
        Array.from(dropdownOf(control)?.querySelectorAll(NODE) ?? []).filter(
          (n) => fits(level, nameOf(n)) && wider.every((w) => above(n).some((name) => fits(w, name))),
        );
      await waitFor(() => nodes().length > 0 || null, { timeout: FILTER_MS, signal: ctx.signal, root: ctx.doc });
      const hits = nodes();
      if (hits.length > 1) {
        shut(control, ctx);
        return failed(`several places fit ${level.query}`, current, 'needs_review');
      }
      if (hits.length === 0) continue;
      const name = nameOf(hits[0]!);
      simulateClick(hits[0]!.querySelector(NAME)!);
      if (await taken(control, name, ctx)) {
        shut(control, ctx);
        return { ok: true, observed: name };
      }
      shut(control, ctx);
      return failed('the places did not take the choice', readBox(control));
    }
  }
  setNativeValue(field, '');
  fireInput(field, '');
  shut(control, ctx);
  return current ? failed('kept what the page already shows', current, 'needs_review') : failed(`no place on the list for ${intent.query}`, null, 'no_option');
}

// ---- a school: the site's search ----------------------------------------------------------------------------------

async function fillSchool(control: Control, intent: Extract<FillIntent, { kind: 'choice' }>, ctx: DriverContext): Promise<FillResult> {
  const current = readBox(control);
  if (current && fits(intent, current)) return { ok: true, observed: current };
  const field = fieldOf(control);
  if (!field) return failed('the school box has no input', current);
  type(field, intent.query);
  const options = () => Array.from(dropdownOf(control)?.querySelectorAll<HTMLElement>(ITEM) ?? []).map((el) => ({ el, info: { label: clean(el.textContent) } }));
  const matchNow = () => intent.match(options().map((o) => o.info));
  // The site searches as it is typed into; its answer may be a moment coming.
  await waitFor(() => matchNow().status === 'matched' || null, { timeout: SEARCH_MS, signal: ctx.signal, root: ctx.doc });
  const m = matchNow();
  if (m.status === 'ambiguous') {
    shut(control, ctx);
    return failed('several schools fit', readBox(control), 'needs_review');
  }
  if (m.status === 'matched') {
    const chosen = options()[m.index]!;
    simulateClick(chosen.el);
    const ok = await taken(control, chosen.info.label, ctx);
    shut(control, ctx);
    return ok ? { ok: true, observed: chosen.info.label } : failed('the search did not take the choice', readBox(control));
  }
  // A school the site does not know: the box keeps it as written.
  shut(control, ctx);
  const kept = await taken(control, intent.query, ctx);
  return kept ? { ok: true, observed: intent.query } : failed('the school box did not keep what was typed', readBox(control));
}

// ---- a span of months ---------------------------------------------------------------------------------------------

const PANEL = '.atsx-date-picker-period-month-panel';
const PANEL_LIST = '.atsx-date-picker-period-month-panel-list';
const PANEL_ITEM = '.atsx-date-picker-period-month-panel-list-item';
const monthOf = (d: DatePart) => `${d.year}-${String(d.month).padStart(2, '0')}`;
const ends = (control: Control) => Array.from(control.el.querySelectorAll<HTMLElement>('.atsx-date-picker-period-month-label'));

function shownEnd(label: HTMLElement | undefined): string {
  const year = clean(label?.querySelector('[class*="label-year"]')?.textContent);
  const month = clean(label?.querySelector('[class*="label-month"]')?.textContent);
  return /^\d{4}$/.test(year) && /^\d{1,2}$/.test(month) ? `${year}-${month.padStart(2, '0')}` : '';
}

function readPeriod(control: Control): string | null {
  const [from, to] = ends(control).map(shownEnd);
  return from || to ? `${from ?? ''} – ${to ?? ''}`.trim() : null;
}

function panelFor(label: HTMLElement): HTMLElement | null {
  const cy = label.getAttribute('data-cy');
  const doc = label.ownerDocument;
  return cy ? doc.querySelector<HTMLElement>(`[data-cy="${CSS.escape(`${cy}Dropdown`)}"]`) : null;
}
const openPanels = (doc: Document) => doc.querySelectorAll(PANEL).length > 0;

async function setEnd(label: HTMLElement, when: DatePart, ctx: DriverContext): Promise<boolean> {
  // The end's panel opens by itself once the start is picked; a click would only be needed when it has not.
  let panel = await waitFor(() => panelFor(label), { timeout: 300, signal: ctx.signal, root: ctx.doc });
  if (!panel) {
    simulateClick(label);
    panel = await waitFor(() => panelFor(label), { timeout: OPENS_MS, signal: ctx.signal, root: ctx.doc });
  }
  if (!panel) return false;
  const [years, months] = Array.from(panel.querySelectorAll(PANEL_LIST));
  const year = Array.from(years?.querySelectorAll<HTMLElement>(PANEL_ITEM) ?? []).find((y) => Number(clean(y.textContent)) === when.year);
  if (!year) return false;
  // The year first: a month counts for nothing until there is one.
  simulateClick(year);
  const month = Array.from(months?.querySelectorAll<HTMLElement>(PANEL_ITEM) ?? []).find((m) => Number(clean(m.textContent)) === when.month);
  if (!month) return false;
  simulateClick(month);
  return (await waitFor(() => shownEnd(label) === monthOf(when) || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc })) === true;
}

async function fillPeriod(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const current = readPeriod(control);
  const [startLabel, endLabel] = ends(control);
  if (!startLabel || !endLabel) return failed('the span has no ends', current);
  const close = () => {
    if (openPanels(ctx.doc)) shutDropdown(ctx.doc, () => openPanels(ctx.doc));
  };
  if (intent.kind === 'dateFrom') {
    const ok = shownEnd(startLabel) === monthOf(intent.start) || (await setEnd(startLabel, intent.start, ctx));
    close();
    // Filled as far as it can be: the end is for the applicant to say, on a form that has no word for "still going".
    return ok ? failed('still going, and the form has no word for that', readPeriod(control), 'needs_review') : failed(`the start would not take ${monthOf(intent.start)}`, readPeriod(control));
  }
  if (intent.kind !== 'dateRange') return failed(`a ${intent.kind} answer on a span of months`, current);
  const want = `${monthOf(intent.start)} – ${monthOf(intent.end)}`;
  if (current === want) return { ok: true, observed: current };
  for (const [label, when] of [[startLabel, intent.start], [endLabel, intent.end]] as const) {
    if (!(await setEnd(label, when, ctx))) {
      close();
      return failed(`the span would not take ${monthOf(when)}`, readPeriod(control));
    }
  }
  close();
  return { ok: true, observed: readPeriod(control) };
}

// ---- the drivers ---------------------------------------------------------------------------------------------------

const guarded = async (run: () => Promise<FillResult>, read: () => string | null): Promise<FillResult> => {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), read());
  }
};

const on = (root: string) => (c: Control) => c.el.matches(root);

export const feishuDesktopDrivers: Driver[] = [
  { id: 'feishu-atsx-box', lib: 'feishu', kinds: ['select'], match: on('.atsx-select'), fill: (c, i, ctx) => guarded(() => fillBox(c, i, ctx), () => readBox(c)), read: readBox },
  {
    id: 'feishu-atsx-period',
    lib: 'feishu',
    kinds: ['date'],
    match: on('.atsx-date-picker-period-month'),
    fill: (c, i, ctx) => guarded(() => fillPeriod(c, i, ctx), () => readPeriod(c)),
    read: readPeriod,
  },
];
