// Feishu recruiting forms on a phone (/index/m/.../apply, the atsx- parts). Nothing there has an input: a tap opens a
// drawer at the end of <body>. Lists, months and month spans are rmc-picker wheels that count only once the drawer's 确定 is
// pressed; a school is a search box whose option, once tapped, is the answer. Only the inner part of a row listens:
// a tap on the outer .resumeSelect opens nothing. An answer already there is left as it is.
import type { Control, OptionInfo } from '../engine/types';
import { fireInput, focusElement, setNativeValue, simulateClick } from './events';
import type { DatePart, Driver, DriverContext, FillIntent, FillResult } from './types';
import { ANSWER_SETTLE_MS, animationsDone, waitFor, watchAnswers } from './wait';
import { turnWheel, wheelTexts } from './wheel';

const OPEN = '.atsx-drawer-open';
const OPENS_MS = 1500;
const SETTLES_MS = 1500;
const SEARCH_MS = 3000;
/** Longest a drawer is let slide in before its wheels are turned (it takes about a third of a second). */
const SLIDE_MS = 800;
const PLACEHOLDER = /^(?:请选择|请输入)$/;
/** Above anything mere containment can reach. */
const THE_VERY_THING = 0.9;

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();
const shown = (el: Element | null): string | null => {
  const text = clean(el?.textContent);
  return text && !PLACEHOLDER.test(text) ? text : null;
};

/** The open drawer holding `inner`; closed drawers stay in <body>, so the newest open one. */
function drawerWith(doc: Document, inner: string): HTMLElement | null {
  const open = Array.from(doc.querySelectorAll<HTMLElement>(OPEN)).filter((d) => d.querySelector(inner));
  return open[open.length - 1] ?? null;
}

async function opened(tap: Element, inner: string, ctx: DriverContext): Promise<HTMLElement | null> {
  simulateClick(tap);
  return waitFor(() => drawerWith(ctx.doc, inner), { timeout: OPENS_MS, signal: ctx.signal, root: ctx.doc });
}

/** Out the way a person would: its own 取消, else its cross. */
async function dismiss(drawer: HTMLElement, ctx: DriverContext): Promise<void> {
  if (!drawer.matches(OPEN)) return;
  const out = drawer.querySelector('[class*="header-dismiss"]') ?? drawer.querySelector('.atsx-drawer-close');
  if (out) simulateClick(out);
  await waitFor(() => !drawer.matches(OPEN), { timeout: SETTLES_MS, signal: ctx.signal, root: drawer });
}

async function confirm(drawer: HTMLElement, ctx: DriverContext, read: () => string | null, want: string): Promise<FillResult> {
  const ok = drawer.querySelector('[class*="header-ok"]');
  if (!ok) {
    await dismiss(drawer, ctx);
    return failed('the drawer has no 确定', read());
  }
  simulateClick(ok);
  const taken = await waitFor(() => read() === want || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc });
  if (!taken) await dismiss(drawer, ctx);
  return taken ? { ok: true, observed: want } : failed(`the form did not take ${want}`, read());
}

type Level = Pick<Extract<FillIntent, { kind: 'choice' }>, 'query' | 'match'>;

/** The answer itself, never something merely containing it (浙江大学城市学院 is not 浙江大学). */
function holds(levels: Level[], current: string): boolean {
  return levels.some((level) => {
    const same = level.match([{ label: current }]);
    return same.status === 'matched' && same.confidence >= THE_VERY_THING;
  });
}

/** The answer, its wider levels, then the resume's other answers: each one true, in the order to try them. */
const levelsOf = (intent: Extract<FillIntent, { kind: 'choice' }>): Level[] => [intent, ...(intent.wider ?? []), ...(intent.fallbacks ?? [])];

// ---- a list on a wheel -------------------------------------------------------------------------------------------

const LIST_DRAWER = '.atsx-mselect-popup-content';
const readList = (control: Control): string | null => shown(control.el.querySelector('.atsx-mselect-content'));

async function fillList(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`a ${intent.kind} answer on a list`, readList(control));
  const current = readList(control);
  const levels = levelsOf(intent);
  if (current && holds(levels, current)) return { ok: true, observed: current };
  const drawer = await opened(control.el.querySelector('.atsx-mselect-content') ?? control.el, LIST_DRAWER, ctx);
  if (!drawer) return failed('the list did not open', current);
  const picker = drawer.querySelector<HTMLElement>('.rmc-picker');
  if (!picker) {
    await dismiss(drawer, ctx);
    return failed('the list has no wheel', current);
  }
  const options: OptionInfo[] = wheelTexts(picker).map((label) => ({ label }));
  // Something else is there: only the answer itself may replace it, since a wider one would say less.
  for (const level of current ? [intent] : levels) {
    const m = level.match(options);
    if (m.status === 'ambiguous') {
      await dismiss(drawer, ctx);
      return failed('several options fit', current, 'needs_review');
    }
    if (m.status !== 'matched') continue;
    if (!(await turnWheel(picker, m.index, { signal: ctx.signal }))) {
      await dismiss(drawer, ctx);
      return failed('the wheel would not turn to the answer', current);
    }
    return confirm(drawer, ctx, () => readList(control), options[m.index]!.label);
  }
  await dismiss(drawer, ctx);
  return current ? failed('kept what the page already shows', current, 'needs_review') : failed(`nothing on the list for ${intent.query}`, null, 'no_option');
}

// ---- a span of months --------------------------------------------------------------------------------------------

const PERIOD_DRAWER = '.atsx-mperiod-popup-content';
const monthOf = (d: DatePart) => `${d.year}-${String(d.month).padStart(2, '0')}`;
const readPeriod = (control: Control): string | null => {
  const text = shown(control.el.querySelector('.atsx-mperiod-text'));
  return text ? text.replace(/\s*[–~-]\s*(?=\d{4})/, ' – ') : null;
};

async function setMonth(drawer: HTMLElement, when: DatePart, ctx: DriverContext): Promise<boolean> {
  const pickers = Array.from(drawer.querySelectorAll<HTMLElement>('.rmc-picker'));
  const year = drawer.querySelector<HTMLElement>('[class*="year-picker"]') ?? pickers[0];
  const month = drawer.querySelector<HTMLElement>('[class*="month-picker"]') ?? pickers[1];
  if (!year || !month) return false;
  const y = wheelTexts(year).findIndex((t) => Number(t) === when.year);
  const m = wheelTexts(month).findIndex((t) => Number(t) === when.month);
  if (y < 0 || m < 0) return false;
  // The months a wheel offers can depend on the year, so the year goes first.
  return (await turnWheel(year, y, { signal: ctx.signal })) && (await turnWheel(month, m, { signal: ctx.signal }));
}

async function toSide(drawer: HTMLElement, side: 'start' | 'end', ctx: DriverContext): Promise<boolean> {
  const tab = drawer.querySelector(`[class*="footer_wrapper__${side}Time"]`);
  if (!tab) return side === 'start';
  if (!tab.classList.contains('footerTimeclicked')) simulateClick(tab);
  return (await waitFor(() => tab.classList.contains('footerTimeclicked'), { timeout: SETTLES_MS, signal: ctx.signal, root: drawer })) === true;
}

async function fillPeriod(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const current = readPeriod(control);
  // Still going: the wheel has no word for that, and any month put in its place would be untrue.
  if (intent.kind === 'dateFrom') return failed('still going, and the form has no word for that', current, 'needs_review');
  if (intent.kind !== 'dateRange') return failed(`a ${intent.kind} answer on a span of months`, current);
  const want = `${monthOf(intent.start)} – ${monthOf(intent.end)}`;
  if (current === want) return { ok: true, observed: current };
  const drawer = await opened(control.el.querySelector('.atsx-mperiod-content') ?? control.el, PERIOD_DRAWER, ctx);
  if (!drawer) return failed('the dates did not open', current);
  // A span's drawer does not hear its wheels while it slides in: turned then, the start stays this month, later than
  // any end, and the first 确定 is refused (开始时间不能晚于结束时间), seen on the phone replays.
  await animationsDone(drawer, SLIDE_MS, ctx.signal);
  for (const [side, when] of [['start', intent.start], ['end', intent.end]] as const) {
    if (!(await toSide(drawer, side, ctx)) || !(await setMonth(drawer, when, ctx))) {
      await dismiss(drawer, ctx);
      return failed(`the wheels would not turn to ${monthOf(when)}`, current);
    }
  }
  return confirm(drawer, ctx, () => readPeriod(control), want);
}

// ---- one month, or one year ----------------------------------------------------------------------------------------

const MONTH_DRAWER = '.atsx-mdatepicker-popup-content';
/** A date has a year in it. A page that cannot show the date it holds writes Invalid date there instead. */
const readMonth = (control: Control): string | null => {
  const text = shown(control.el.querySelector('.atsx-mdatepicker-text'));
  return text && /\d{4}/.test(text) ? text : null;
};
/** The date, as far as the box shows it: a box that takes only a year (获奖时间) shows the year alone. */
const holdsDate = (text: string | null, when: DatePart): boolean => {
  const year = /^(\d{4})年?$/.exec((text ?? '').trim());
  if (year) return Number(year[1]) === when.year;
  const m = /(\d{4})\D+(\d{1,2})/.exec(text ?? '');
  return !!m && Number(m[1]) === when.year && Number(m[2]) === when.month;
};

async function setYear(drawer: HTMLElement, year: number, ctx: DriverContext): Promise<boolean> {
  const wheel = drawer.querySelector<HTMLElement>('[class*="year-picker"]') ?? drawer.querySelector<HTMLElement>('.rmc-picker');
  const y = wheel ? wheelTexts(wheel).findIndex((t) => Number(t) === year) : -1;
  return !!wheel && y >= 0 && turnWheel(wheel, y, { signal: ctx.signal });
}

async function fillMonth(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const current = readMonth(control);
  if (intent.kind !== 'date') return failed(`a ${intent.kind} answer on a month`, current);
  const want = monthOf(intent);
  if (holdsDate(current, intent)) return { ok: true, observed: current };
  const drawer = await opened(control.el.querySelector('.atsx-mdatepicker-content') ?? control.el, MONTH_DRAWER, ctx);
  if (!drawer) return failed('the date did not open', current);
  const ok = drawer.querySelector('[class*="header-ok"]');
  // Some ask only for the year: the drawer then has no month wheel.
  const yearOnly = !drawer.querySelector('[class*="month-picker"]');
  if (!ok || !(await (yearOnly ? setYear(drawer, intent.year, ctx) : setMonth(drawer, intent, ctx)))) {
    await dismiss(drawer, ctx);
    return failed(`the wheels would not turn to ${yearOnly ? intent.year : want}`, current);
  }
  simulateClick(ok);
  const taken = await waitFor(() => holdsDate(readMonth(control), intent) || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc });
  if (!taken) await dismiss(drawer, ctx);
  return taken ? { ok: true, observed: readMonth(control) } : failed(`the form did not take ${want}`, readMonth(control));
}

// ---- a school: search in a drawer ----------------------------------------------------------------------------------

const SEARCH_DRAWER = '.atsx-m-input-select-input';
const SEARCH_OPTION = '.atsx-m-input-select-option';
const readSearch = (control: Control): string | null => shown(control.el.querySelector('.atsx-m-input-select-hasValue'));
/** What a page shows while its search is still out: a spinner or a loading line. */
const SEARCHING = '[class*="spin" i], [class*="loading" i]';

function stillSearching(drawer: HTMLElement): boolean {
  const win = drawer.ownerDocument.defaultView;
  return Array.from(drawer.querySelectorAll<HTMLElement>(SEARCHING)).some((el) => {
    if (el.closest('[hidden]')) return false;
    const style = win?.getComputedStyle(el);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  });
}

async function fillSearch(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`a ${intent.kind} answer on a search`, readSearch(control));
  const current = readSearch(control);
  if (current && holds(levelsOf(intent), current)) return { ok: true, observed: current };
  const tap = control.el.querySelector('.atsx-m-input-select-placeholder, .atsx-m-input-select-hasValue') ?? control.el;
  const drawer = await opened(tap, SEARCH_DRAWER, ctx);
  if (!drawer) return failed('the search did not open', current);
  const box = drawer.querySelector<HTMLInputElement>(SEARCH_DRAWER)!;
  focusElement(box);
  const answer = watchAnswers(ctx.doc);
  setNativeValue(box, intent.query);
  fireInput(box, intent.query);
  const options = () =>
    Array.from(drawer.querySelectorAll<HTMLElement>(SEARCH_OPTION)).map((el) => ({ el, info: { label: clean(el.textContent) } }));
  const matchNow = () => intent.match(options().map((o) => o.info));
  // The site searches as it is typed into; its answer may be a moment coming. Once it has come and been drawn, the
  // list is all there will be.
  await waitFor(() => matchNow().status === 'matched' || answer.answered(ANSWER_SETTLE_MS), { timeout: SEARCH_MS, signal: ctx.signal, root: drawer });
  answer.stop();
  const m = matchNow();
  if (m.status === 'ambiguous') {
    await dismiss(drawer, ctx);
    return failed('several schools fit', current, 'needs_review');
  }
  if (m.status === 'matched') {
    const chosen = options()[m.index]!;
    simulateClick(chosen.el);
    const taken = await waitFor(() => readSearch(control) === chosen.info.label || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc });
    if (taken) return { ok: true, observed: chosen.info.label };
    await dismiss(drawer, ctx);
    return failed('the search did not take the choice', readSearch(control));
  }
  // Still searching when the time is up: no telling yet whether the site knows the school, and writing it as typed
  // could put in a name the site would have given its own way.
  if (stillSearching(drawer)) {
    await dismiss(drawer, ctx);
    return failed('the search did not answer in time', current, 'needs_review');
  }
  // A school the site does not know: the box takes it as written.
  return confirm(drawer, ctx, () => readSearch(control), intent.query);
}

// ---- a place from a list of cities ----------------------------------------------------------------------------------

const TREE_DRAWER = '.atsx-mSelectTreePopup-content';
const TREE_OPTION = '.atsx-mSelectTreePopup-content-single';
/** Empty, the box holds a 请选择 block; chosen, only the bare name. */
const readTree = (control: Control): string | null => shown(control.el);

async function fillTree(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const query = intent.kind === 'choice' ? intent : null;
  if (!query) return failed(`a ${intent.kind} answer on a list of places`, readTree(control));
  const current = readTree(control);
  if (current && holds(levelsOf(query), current)) return { ok: true, observed: current };
  const drawer = await opened(control.el, TREE_DRAWER, ctx);
  if (!drawer) return failed('the places did not open', current);
  const options = Array.from(drawer.querySelectorAll<HTMLElement>(TREE_OPTION)).map((el) => ({
    el,
    info: { label: clean(el.querySelector('[class*="singleLeft"] > span')?.textContent ?? el.textContent) },
  }));
  for (const level of current ? [query] : levelsOf(query)) {
    const m = level.match(options.map((o) => o.info));
    if (m.status === 'ambiguous') break;
    if (m.status !== 'matched') continue;
    const chosen = options[m.index]!;
    // The row's left part, the name, is what listens: a tap on the row around it does nothing.
    simulateClick(chosen.el.querySelector('[class*="singleLeft"]') ?? chosen.el);
    const taken = await waitFor(() => readTree(control) === chosen.info.label || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc });
    if (taken) return { ok: true, observed: chosen.info.label };
    // A level below (country, then city) is a walk this driver does not take.
    await dismiss(drawer, ctx);
    return failed('the place has more levels than one', readTree(control), 'needs_review');
  }
  await dismiss(drawer, ctx);
  return current ? failed('kept what the page already shows', current, 'needs_review') : failed(`nothing on the list for ${query.query}`, null, 'no_option');
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

export const feishuMobileDrivers: Driver[] = [
  { id: 'feishu-m-list', lib: 'feishu', kinds: ['select'], match: on('.atsx-mselect'), fill: (c, i, ctx) => guarded(() => fillList(c, i, ctx), () => readList(c)), read: readList },
  { id: 'feishu-m-period', lib: 'feishu', kinds: ['date'], match: on('.atsx-mperiod'), fill: (c, i, ctx) => guarded(() => fillPeriod(c, i, ctx), () => readPeriod(c)), read: readPeriod },
  { id: 'feishu-m-month', lib: 'feishu', kinds: ['date'], match: on('.atsx-mdatepicker'), fill: (c, i, ctx) => guarded(() => fillMonth(c, i, ctx), () => readMonth(c)), read: readMonth },
  { id: 'feishu-m-search', lib: 'feishu', kinds: ['select'], match: on('.atsx-m-input-select-warp'), fill: (c, i, ctx) => guarded(() => fillSearch(c, i, ctx), () => readSearch(c)), read: readSearch },
  { id: 'feishu-m-tree', lib: 'feishu', kinds: ['select'], match: on('.atsx-mSelectTreeInput'), fill: (c, i, ctx) => guarded(() => fillTree(c, i, ctx), () => readTree(c)), read: readTree },
];
