// Feishu recruiting forms. Lists are a read-only box or a search box with a panel at the end of <body>; dates are
// boxes that take typing and keep it only on Enter. An answer already there is left as it is: these forms open
// filled in from the last application, and picking the same thing again gains nothing.
import type { Control } from '../engine/types';
import { closeDropdown, findDropdownNear, shutDropdown, visibleOptions } from './dropdown';
import { fireBlur, fireChange, fireInput, focusElement, pressKey, setNativeValue, simulateClick, typeText } from './events';
import type { DatePart, Driver, DriverContext, FillIntent, FillResult } from './types';
import { waitFor } from './wait';

const PANEL = '.ud__select__dropdown';
const OPTION = '.ud__select__list__item';
const CHOSEN = '.ud__select__selector__selectItem';
const OPENS_BY_ITSELF_MS = 500;
const SEARCH_MS = 3000;
const MIN_SEARCH_MS = 300;
const TIDY_MS = 300;
/** Above anything mere containment can reach. */
const THE_VERY_THING = 0.9;

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();
const inputOf = (el: Element): HTMLInputElement | null => el.querySelector('input');

function readList(control: Control): string | null {
  const chosen = Array.from(control.el.querySelectorAll(CHOSEN)).map((c) => clean(c.textContent)).filter(Boolean);
  if (chosen.length > 0) return chosen.join('、');
  return clean(inputOf(control.el)?.value) || null;
}

type Level = Pick<Extract<FillIntent, { kind: 'choice' }>, 'query' | 'match'>;

async function fillList(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`a ${intent.kind} answer on a single list`, readList(control));
  const current = readList(control);
  const until = Date.now() + ctx.timeoutMs - TIDY_MS;
  const levels: Level[] = [intent, ...(intent.wider ?? [])];
  const fallbacks: Level[] = intent.fallbacks ?? [];
  // Only the thing itself: 浙江大学城市学院 merely contains 浙江大学.
  const holds = (level: Level) => {
    const same = level.match([{ label: current! }]);
    return same.status === 'matched' && same.confidence >= THE_VERY_THING;
  };
  if (current && [...levels, ...fallbacks].some(holds)) return { ok: true, observed: current };
  // Something else is there: only the answer itself may replace it, since a wider one would say less.
  const tried = current ? [intent] : levels;
  // The step's time has to reach the last level, and leave a moment to tidy up. The resume's other answers get what
  // is left after that, so a long list of them never cuts short the search for the first.
  const searchMs = Math.min(SEARCH_MS, Math.max(MIN_SEARCH_MS, (ctx.timeoutMs - TIDY_MS) / tried.length - OPENS_BY_ITSELF_MS));
  for (const level of tried) {
    const result = await pickLevel(control, level, current, searchMs, ctx);
    if (result.outcome !== 'no_option') return result;
  }
  for (const level of current ? [] : fallbacks) {
    const left = until - Date.now() - OPENS_BY_ITSELF_MS;
    if (left < MIN_SEARCH_MS) break;
    const result = await pickLevel(control, level, current, Math.min(searchMs, left), ctx);
    if (result.outcome !== 'no_option') return result;
  }
  return current
    ? failed('kept what the page already shows', current, 'needs_review')
    : failed(`nothing on the list for ${intent.query}`, null, 'no_option');
}

async function pickLevel(control: Control, intent: Level, current: string | null, searchMs: number, ctx: DriverContext): Promise<FillResult> {
  const input = inputOf(control.el);
  const wasInBox = input?.value ?? '';
  const searches = !!input && !input.readOnly;
  const trigger = control.el.querySelector('.ud__select__selector') ?? input ?? control.el;
  if (input) focusElement(input);
  simulateClick(trigger);
  const near = () => findDropdownNear(control.el, PANEL, { doc: ctx.doc });
  let panel = await waitFor(near, { timeout: OPENS_BY_ITSELF_MS, signal: ctx.signal, root: ctx.doc });
  if (searches && (!panel || visibleOptions(panel, OPTION).length === 0 || current !== null)) {
    typeText(input!, intent.query);
    panel = await waitFor(
      () => {
        const open = near();
        return open && visibleOptions(open, OPTION).some((o) => intent.match([o.info]).status === 'matched') ? open : null;
      },
      { timeout: searchMs, signal: ctx.signal, root: ctx.doc },
    );
  }
  const restore = () => {
    if (searches && input && input.value !== wasInBox) {
      setNativeValue(input, wasInBox);
      fireInput(input, null, 'deleteContentBackward');
    }
    shutDropdown(ctx.doc, () => near() !== null);
  };
  if (!panel) {
    restore();
    return failed(`nothing on the list for ${intent.query}`, readList(control), 'no_option');
  }
  const options = visibleOptions(panel, OPTION);
  const m = intent.match(options.map((o) => o.info));
  if (m.status !== 'matched') {
    restore();
    return m.status === 'ambiguous'
      ? failed('several options fit', readList(control), 'needs_review')
      : failed(`nothing on the list for ${intent.query}`, readList(control), 'no_option');
  }
  const chosen = options[m.index]!;
  simulateClick(chosen.el);
  const taken = await waitFor(() => readList(control) === chosen.info.label || null, { timeout: 1500, signal: ctx.signal, root: ctx.doc });
  shutDropdown(ctx.doc, () => near() !== null);
  return taken ? { ok: true, observed: chosen.info.label } : failed('the list did not take the choice', readList(control));
}

// ---- dates -------------------------------------------------------------------------------------------------------

const monthOf = (d: DatePart) => `${d.year}-${String(d.month).padStart(2, '0')}`;
/** As the box's format asks: a box for a year alone (YYYY, as 获奖时间) takes the year, any other the month. */
const dateFor = (input: HTMLInputElement, d: DatePart) => (/^y{4}$/i.test(input.placeholder.trim()) ? String(d.year) : monthOf(d));

async function typeDate(input: HTMLInputElement, text: string, ctx: DriverContext): Promise<boolean> {
  if (input.value === text) return true;
  focusElement(input);
  setNativeValue(input, text);
  fireInput(input, text);
  pressKey(input, 'Enter');
  fireChange(input);
  fireBlur(input);
  closeDropdown(ctx.doc);
  return (await waitFor(() => input.value === text || null, { timeout: 800, signal: ctx.signal, root: ctx.doc })) === true;
}

async function clearDate(input: HTMLInputElement, ctx: DriverContext): Promise<void> {
  if (!input.value) return;
  const cross = input.closest('.ud__input')?.querySelector('.ud__input__clear-icon');
  if (cross) simulateClick(cross);
  await waitFor(() => input.value === '' || null, { timeout: 800, signal: ctx.signal, root: ctx.doc });
}

const readDates = (control: Control): string | null => {
  const shown = Array.from(control.el.querySelectorAll('input')).map((i) => i.value.trim());
  return shown.some(Boolean) ? shown.join(' ~ ') : null;
};

async function fillDates(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const inputs = Array.from(control.el.querySelectorAll('input'));
  if (intent.kind === 'dateFrom' && inputs.length === 2) {
    // Typing nothing brings the old date back; the box's own cross is what clears it.
    await clearDate(inputs[1]!, ctx);
    if (!(await typeDate(inputs[0]!, monthOf(intent.start), ctx))) return failed(`the date box did not keep ${monthOf(intent.start)}`, readDates(control));
    // Filled as far as it can be: the end is for the applicant to say, on a form that has no word for "still going".
    return failed('still going, and the form has no word for that', readDates(control), 'needs_review');
  }
  const wants = intent.kind === 'date' && inputs.length === 1 ? [dateFor(inputs[0]!, intent)] : intent.kind === 'dateRange' && inputs.length === 2 ? [monthOf(intent.start), monthOf(intent.end)] : null;
  if (!wants) return failed(`a ${intent.kind} answer on ${inputs.length} boxes`, readDates(control));
  for (const [i, want] of wants.entries()) {
    if (!(await typeDate(inputs[i]!, want, ctx))) return failed(`the date box did not keep ${want}`, readDates(control));
  }
  return { ok: true, observed: readDates(control) };
}

// ---- the drivers ---------------------------------------------------------------------------------------------------

const guarded = async (run: () => Promise<FillResult>, read: () => string | null): Promise<FillResult> => {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), read());
  }
};

export const feishuDrivers: Driver[] = [
  {
    id: 'feishu-list',
    lib: 'feishu',
    kinds: ['select'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillList(c, i, ctx), () => readList(c)),
    read: readList,
  },
  {
    id: 'feishu-date',
    lib: 'feishu',
    kinds: ['date'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillDates(c, i, ctx), () => readDates(c)),
    read: readDates,
  },
];
