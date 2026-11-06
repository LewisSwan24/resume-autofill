// Beisen's (北森, zhiye.com) Phoenix widgets, on React 16 with rc-trigger popups. Every list, date, place and
// constant is the same box until it is opened. The page knows which (cmp_type BC_DropDownList, BC_DateTime,
// BC_PopArea, BC_PopConstant), but only in React's own properties, which a content script cannot see. What the box
// opens in a layer at the end of <body> says which it is:
//   - a list, drawn a few rows at a time, with a search above it;
//   - a date: a day calendar that takes the date written out, or a month panel stepped a year at a time;
//   - a picker: entries on the left that may go down levels (省 > 市 > 区, 职类 > 职位), a pick circle beside
//     each, what is picked on the right, and 取消 / 确定 below. Its search reaches every level at once.
// A click can draw the list again, so every step looks its entries up afresh.
import type { Control } from '../engine/types';
import { findDropdownNear, shutDropdown, visibleOptions } from './dropdown';
import { fireInput, focusElement, pressKey, setNativeValue, simulateClick, typeText } from './events';
import type { DatePart, Driver, DriverContext, FillIntent, FillResult, OptionMatcher } from './types';
import { waitFor } from './wait';

const LAYER = '.common-unmodeled-layer__layerContent';
const OPTION = '.phoenix-selectList__listItem';
const LIST_SEARCH = '.phoenix-selectList__searchWrapper input';
// The picker's parts carry no library prefix (area-item-container, list-item-container): matched by what they contain.
const PICKER = '[class*="select-data-container"]';
const PICKER_ITEM = '[class*="left-container"] [class*="item-container"]';
const PICKER_LABEL = '[class*="text-label"]';
const PICKER_PICK = '[class*="icon-container"] svg';
const PICKER_SEARCH = '[class*="search"] input';
const BUTTON = '[class*="button__content"]';
const TAG = '.phoenix-select__tag';
const RADIO = '.phoenix-radio';

const OPEN_MS = 1500;
const SEARCH_MS = 2500;
const SETTLE_MS = 1500;
/** Kept back from the step's time for confirming or cancelling at the end. */
const TIDY_MS = 900;
/** Far enough for any birth date from where the panel starts. */
const MAX_YEAR_STEPS = 150;

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();
const boxOf = (control: Control): HTMLInputElement | null => control.el.querySelector<HTMLInputElement>('.phoenix-select__input');
const tagsOf = (control: Control): string[] => Array.from(control.el.querySelectorAll(TAG)).map((t) => clean(t.textContent)).filter(Boolean);
/** What the box holds: its words, or the tags of a box that takes several. */
const readBox = (control: Control): string | null => {
  const tags = tagsOf(control);
  return tags.length > 0 ? tags.join('、') : clean(boxOf(control)?.value) || null;
};

const settled = async (probe: () => boolean, ctx: DriverContext): Promise<boolean> =>
  (await waitFor(() => probe() || null, { timeout: SETTLE_MS, signal: ctx.signal, root: ctx.doc })) === true;

/** The panel this box opened. Every panel sits in the same kind of layer, so the nearest open one is it. */
const panelOf = (control: Control, ctx: DriverContext, inside: string): HTMLElement | null => {
  const layer = findDropdownNear(control.el, LAYER, { doc: ctx.doc });
  return layer?.querySelector(inside) ? layer : null;
};

async function open(control: Control, ctx: DriverContext, inside: string): Promise<HTMLElement | null> {
  // A box that takes several drops its input once it holds tags: the box itself opens it then.
  const box = boxOf(control) ?? control.el.querySelector<HTMLElement>('.phoenix-select__content') ?? control.el;
  focusElement(box);
  simulateClick(box);
  return waitFor(() => panelOf(control, ctx, inside), { timeout: OPEN_MS, signal: ctx.signal, root: ctx.doc });
}

const shut = (control: Control, ctx: DriverContext) => shutDropdown(ctx.doc, () => findDropdownNear(control.el, LAYER, { doc: ctx.doc }) !== null);

const emptied = (input: HTMLInputElement) => {
  if (!input.value) return;
  setNativeValue(input, '');
  fireInput(input, null, 'deleteContentBackward');
};

// ---- a list ------------------------------------------------------------------------------------------------------

async function pickFromList(control: Control, panel: HTMLElement, intent: { query: string; match: OptionMatcher }, ctx: DriverContext): Promise<FillResult> {
  let options = visibleOptions(panel, OPTION);
  let m = intent.match(options.map((o) => o.info));
  // Only the rows in view are drawn: what is not among them may still be further down, and the search finds it.
  const search = panel.querySelector<HTMLInputElement>(LIST_SEARCH);
  if (m.status === 'none' && search) {
    typeText(search, intent.query);
    await waitFor(
      () => {
        options = visibleOptions(panel, OPTION);
        m = intent.match(options.map((o) => o.info));
        return m.status !== 'none' || null;
      },
      { timeout: SEARCH_MS, signal: ctx.signal, root: ctx.doc },
    );
  }
  if (m.status !== 'matched') {
    if (search) emptied(search);
    shut(control, ctx);
    return m.status === 'ambiguous'
      ? failed('several options fit', readBox(control), 'needs_review')
      : failed(`nothing on the list for ${intent.query}`, readBox(control), 'no_option');
  }
  const chosen = options[m.index]!;
  simulateClick(chosen.el);
  const taken = await settled(() => readBox(control) === chosen.info.label, ctx);
  if (panelOf(control, ctx, OPTION)) shut(control, ctx);
  return taken ? { ok: true, observed: chosen.info.label } : failed('the list did not take the choice', readBox(control));
}

// ---- a picker -------------------------------------------------------------------------------------------------------

/** The entries on the left as they are now. A search result names its path beside it: only the label is the entry. */
const entries = (panel: Element) =>
  Array.from(panel.querySelectorAll<HTMLElement>(PICKER_ITEM)).map((el) => ({ el, info: { label: clean((el.querySelector(PICKER_LABEL) ?? el).textContent) } }));

const pickedText = (panel: Element): string => clean(panel.querySelector(PICKER)?.textContent);
const button = (panel: Element, words: string) => Array.from(panel.querySelectorAll(BUTTON)).find((b) => clean(b.textContent) === words);

type Asked = { query: string; match: OptionMatcher };
type Entry = { label: string; el: HTMLElement };
type Found = Entry | 'ambiguous' | null;
/** Time left in the step: a search that finds nothing must still leave room to cancel. */
type Budget = () => number;
const within = (ms: number, left: Budget) => Math.max(0, Math.min(ms, left()));

/** The entries once the list has come in: it is drawn a moment after the panel opens, and after each step. */
const listed = (panel: HTMLElement, ctx: DriverContext, ms: number) =>
  waitFor(() => (entries(panel).length > 0 ? entries(panel) : null), { timeout: ms, signal: ctx.signal, root: ctx.doc });

function among(now: ReturnType<typeof entries>, asked: Asked): Found {
  const m = asked.match(now.map((e) => e.info));
  if (m.status === 'matched') return { label: now[m.index]!.info.label, el: now[m.index]!.el };
  return m.status === 'ambiguous' ? 'ambiguous' : null;
}

/** Click the circle beside an entry and wait for it to show on the right. */
async function pickEntry(panel: HTMLElement, entry: Entry, ctx: DriverContext): Promise<boolean> {
  const circle = entry.el.querySelector(PICKER_PICK);
  if (!circle) return false;
  simulateClick(circle);
  return settled(() => pickedText(panel).includes(entry.label), ctx);
}

const isEntry = (f: Found): f is Entry => f !== null && f !== 'ambiguous';

/** Search every level at once for an answer and pick it. The search is emptied again afterwards. */
async function searchAndPick(panel: HTMLElement, asked: Asked, ctx: DriverContext, left: Budget): Promise<Found> {
  const search = panel.querySelector<HTMLInputElement>(PICKER_SEARCH);
  if (!search || left() <= 0) return null;
  typeText(search, asked.query);
  // The results come in when they come in: wait for a fit while the step has time, and take what is there then.
  const hit = await waitFor(() => {
    const f = among(entries(panel), asked);
    return isEntry(f) ? f : null;
  }, { timeout: within(SEARCH_MS, left), signal: ctx.signal, root: ctx.doc });
  const found = hit ?? among(entries(panel), asked);
  const ok = isEntry(found) && (await pickEntry(panel, found, ctx));
  emptied(search);
  return ok ? found : found === 'ambiguous' ? 'ambiguous' : null;
}

/** An answer shown on the list as it stands, or else found by the search. */
async function shownOrSearched(panel: HTMLElement, asked: Asked, ctx: DriverContext, left: Budget): Promise<Found> {
  const now = await listed(panel, ctx, within(OPEN_MS, left));
  const shown = now ? among(now, asked) : null;
  if (isEntry(shown) && (await pickEntry(panel, shown, ctx))) return shown;
  const searched = await searchAndPick(panel, asked, ctx, left);
  return isEntry(searched) ? searched : shown === 'ambiguous' || searched === 'ambiguous' ? 'ambiguous' : null;
}

/** Walk down from the widest level, picking each on the way: the place is in hand if the next level is not there. */
async function walkDown(panel: HTMLElement, levels: Asked[], ctx: DriverContext, left: Budget): Promise<{ label: string; narrowest: boolean } | null> {
  let picked: { label: string; narrowest: boolean } | null = null;
  let next = 0;
  while (next < levels.length) {
    const now = await listed(panel, ctx, within(OPEN_MS, left));
    if (!now) break;
    let found: (Entry & { j: number }) | null = null;
    for (let j = next; j < levels.length && !found; j++) {
      const f = among(now, levels[j]!);
      if (isEntry(f)) found = { ...f, j };
    }
    if (!found || !(await pickEntry(panel, found, ctx))) break;
    picked = { label: found.label, narrowest: found.j === levels.length - 1 };
    next = found.j + 1;
    if (next >= levels.length) break;
    // Picking draws the list again: find the entry afresh before stepping into it.
    const label = found.label;
    const down = entries(panel).find((e) => e.info.label === label)?.el.querySelector(PICKER_LABEL);
    if (!down) break;
    const before = entries(panel).map((e) => e.info.label).join();
    simulateClick(down);
    // The next level is in once the list says something other than this one did.
    const moved = await waitFor(() => {
      const shown = entries(panel).map((e) => e.info.label).join();
      return shown && shown !== before ? true : null;
    }, { timeout: within(OPEN_MS, left), signal: ctx.signal, root: ctx.doc });
    if (!moved) break;
  }
  return picked;
}

function cancelPicker(control: Control, panel: HTMLElement, ctx: DriverContext): void {
  const no = button(panel, '取消');
  if (no) simulateClick(no);
  shut(control, ctx);
}

async function confirm(control: Control, panel: HTMLElement, wanted: string[], ctx: DriverContext): Promise<boolean> {
  const ok = button(panel, '确定');
  if (!ok) {
    cancelPicker(control, panel, ctx);
    return false;
  }
  simulateClick(ok);
  const taken = await settled(() => {
    const tags = tagsOf(control);
    return wanted.every((w) => (tags.length > 0 ? tags.includes(w) : readBox(control) === w));
  }, ctx);
  if (panelOf(control, ctx, PICKER)) cancelPicker(control, panel, ctx);
  return taken;
}

async function fillPicker(control: Control, panel: HTMLElement, intent: FillIntent, ctx: DriverContext, left: Budget): Promise<FillResult> {
  if (intent.kind === 'multi') {
    const picked: string[] = [];
    for (const asked of intent.items) {
      const found = await shownOrSearched(panel, asked, ctx, left);
      if (isEntry(found)) picked.push(found.label);
    }
    if (picked.length === 0) {
      cancelPicker(control, panel, ctx);
      return failed(`nothing on the list for ${intent.display}`, readBox(control), 'no_option');
    }
    if (!(await confirm(control, panel, picked, ctx))) return failed('the picker did not take the answers', readBox(control));
    return picked.length === intent.items.length ? { ok: true, observed: readBox(control) } : failed('only some answers were on the list', readBox(control), 'needs_review');
  }
  if (intent.kind !== 'choice') {
    cancelPicker(control, panel, ctx);
    return failed(`a ${intent.kind} answer on a picker`, readBox(control));
  }
  let picked: { label: string; narrowest: boolean } | null = null;
  let ambiguous = false;
  if (intent.wider?.length) {
    // A place, walked down its levels; the search is for one the walk could not reach.
    picked = await walkDown(panel, [intent, ...intent.wider].reverse(), ctx, left);
    if (!picked?.narrowest) {
      const found = await searchAndPick(panel, intent, ctx, left);
      if (isEntry(found)) picked = { label: found.label, narrowest: true };
      ambiguous = found === 'ambiguous';
    }
  } else {
    const found = await shownOrSearched(panel, intent, ctx, left);
    if (isEntry(found)) picked = { label: found.label, narrowest: true };
    ambiguous = found === 'ambiguous';
  }
  if (!picked) {
    cancelPicker(control, panel, ctx);
    return ambiguous ? failed('several entries fit', readBox(control), 'needs_review') : failed(`nothing on the list for ${intent.query}`, readBox(control), 'no_option');
  }
  if (!(await confirm(control, panel, [picked.label], ctx))) return failed('the picker did not take the answer', readBox(control));
  // A wider level than the resume names is true, but short of the answer.
  return picked.narrowest ? { ok: true, observed: picked.label } : failed(`only as far as ${picked.label}`, picked.label, 'needs_review');
}

async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice' && intent.kind !== 'multi') return failed(`a ${intent.kind} answer on a list`, readBox(control));
  const until = Date.now() + ctx.timeoutMs - TIDY_MS;
  const left: Budget = () => until - Date.now();
  const panel = await open(control, ctx, `${PICKER}, .phoenix-selectList`);
  if (!panel) return failed('the list did not open', readBox(control));
  if (panel.querySelector(PICKER)) return fillPicker(control, panel, intent, ctx, left);
  if (intent.kind === 'multi') {
    shut(control, ctx);
    return failed('several answers on a list that takes one', readBox(control));
  }
  return pickFromList(control, panel, intent, ctx);
}

// ---- a date ---------------------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const CALENDAR = '[class*="phoenix-calendar"]';
const DAY_INPUT = 'input.phoenix-calendar-input';
const YEAR_SHOWN = '[class*="month-panel-year-select-content"]';
const MONTH_CELL = '[class*="month-panel-cell"]';

const shownYear = (panel: Element): number | null => {
  const m = /(\d{4})/.exec(panel.querySelector(YEAR_SHOWN)?.textContent ?? '');
  return m ? Number(m[1]) : null;
};

async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'date') return failed(`a ${intent.kind} answer on one date`, readBox(control));
  const panel = await open(control, ctx, CALENDAR);
  if (!panel) return failed('the date panel did not open', readBox(control));
  try {
    const typed = panel.querySelector<HTMLInputElement>(DAY_INPUT);
    if (typed) {
      // A day calendar takes the date written out, and Enter puts it in the box.
      const want = `${intent.year}-${pad(intent.month)}-${pad(intent.day ?? 1)}`;
      focusElement(typed);
      setNativeValue(typed, want);
      fireInput(typed, want);
      pressKey(typed, 'Enter');
      const taken = await settled(() => readBox(control) === want, ctx);
      return taken ? { ok: true, observed: want } : failed('the date panel did not take the date', readBox(control));
    }
    return await pickMonth(control, panel, intent, ctx);
  } finally {
    if (panelOf(control, ctx, CALENDAR)) shut(control, ctx);
  }
}

async function pickMonth(control: Control, panel: HTMLElement, date: DatePart, ctx: DriverContext): Promise<FillResult> {
  for (let step = 0; step < MAX_YEAR_STEPS; step++) {
    const year = shownYear(panel);
    if (year === null) return failed('the panel shows no year', readBox(control));
    if (year === date.year) break;
    const arrow = panel.querySelector(year < date.year ? '[class*="month-panel-next-year-btn"]' : '[class*="month-panel-prev-year-btn"]');
    if (!arrow) return failed('the panel has no way to the year', readBox(control));
    simulateClick(arrow);
    const moved = await waitFor(() => shownYear(panel) !== year || null, { timeout: 800, signal: ctx.signal, root: ctx.doc });
    if (!moved) return failed('the panel would not change year', readBox(control));
  }
  if (shownYear(panel) !== date.year) return failed(`could not reach ${date.year}`, readBox(control));
  const cell = Array.from(panel.querySelectorAll(MONTH_CELL)).find((c) => clean(c.textContent) === `${date.month}月`);
  if (!cell || /disabled/.test(cell.className)) return failed('the panel shows no month to pick', readBox(control));
  simulateClick(cell.querySelector('a') ?? cell);
  const want = `${date.year}-${pad(date.month)}`;
  const taken = await settled(() => readBox(control) === want, ctx);
  return taken ? { ok: true, observed: want } : failed('the panel did not take the month', readBox(control));
}

// ---- answers side by side ----------------------------------------------------------------------------------------------

const radios = (control: Control) =>
  Array.from(control.el.querySelectorAll<HTMLElement>(RADIO)).map((el) => ({ el, info: { label: clean(el.querySelector('[class*="radio__radio-text"]')?.textContent ?? el.textContent) } }));

/** No input behind them: a picked answer says so only in its classes. */
const isOn = (el: Element): boolean => [el, ...Array.from(el.querySelectorAll('*'))].some((n) => /(?:^|[-_])(?:checked|active|selected)\b/i.test(n.getAttribute('class') ?? ''));

const readRadios = (control: Control): string | null => radios(control).find((r) => isOn(r.el))?.info.label ?? null;

async function fillRadios(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`a ${intent.kind} answer on side-by-side answers`, readRadios(control));
  const all = radios(control);
  const m = intent.match(all.map((r) => r.info));
  if (m.status !== 'matched') {
    return m.status === 'ambiguous'
      ? failed('several answers fit', readRadios(control), 'needs_review')
      : failed(`no answer for ${intent.query}`, readRadios(control), 'no_option');
  }
  const chosen = all[m.index]!;
  if (readRadios(control) === chosen.info.label) return { ok: true, observed: chosen.info.label };
  simulateClick(chosen.el.querySelector('[class*="radio__wrapper"]') ?? chosen.el);
  const taken = await settled(() => readRadios(control) === chosen.info.label, ctx);
  return taken ? { ok: true, observed: chosen.info.label } : failed(`answer "${chosen.info.label}" did not stick`, readRadios(control));
}

// ---- the drivers ------------------------------------------------------------------------------------------------------------

const guarded = async (run: () => Promise<FillResult>, read: () => string | null): Promise<FillResult> => {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), read());
  }
};

export const beisenDrivers: Driver[] = [
  {
    id: 'beisen-select',
    lib: 'beisen',
    kinds: ['select'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillSelect(c, i, ctx), () => readBox(c)),
    read: readBox,
  },
  {
    id: 'beisen-date',
    lib: 'beisen',
    kinds: ['date'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillDate(c, i, ctx), () => readBox(c)),
    read: readBox,
  },
  {
    id: 'beisen-radio',
    lib: 'beisen',
    kinds: ['radio'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillRadios(c, i, ctx), () => readRadios(c)),
    read: readRadios,
  },
];
