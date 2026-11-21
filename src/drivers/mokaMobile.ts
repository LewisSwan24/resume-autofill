// Moka's application form on a phone (/m/..., one step of the form at a time). A list is a readonly 「请选择」 input:
// a tap opens a sheet inside the field, a tap on a row only marks it (several on a multi list), and the input takes the
// marked rows on 确认. A date is a box with no input at all: a tap opens wheels inside it, a column per part, each a
// list the page moves with the finger, 30px a row, listening for touches only once its loading cover is gone. The
// value follows the finger as it moves, and 确定 writes YYYY-MM into the box. A list keeps another answer it already
// holds and asks for a look; a date is set to the resume's month whatever it shows, as the other date drivers do.
import type { Control, OptionInfo } from '../engine/types';
import { simulateClick } from './events';
import type { DatePart, Driver, DriverContext, FillIntent, FillResult, OptionMatcher } from './types';
import { waitFor } from './wait';
import { touchEvent } from './wheel';

const OPENS_MS = 1500;
const SETTLES_MS = 1500;
/** The page covers its wheels for half a second after they open; touches before that go nowhere. */
const READY_MS = 2000;
/** Where the page cannot say (no layout), the row its own code moves by. */
const ROW = 30;
const MOVES = 6;
const MOVE_MS = 16;
/** How the page joins the rows of a multi list in its input. */
const JOIN = '，';

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const shown = (el: Element | null | undefined): boolean => {
  if (!el) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el as HTMLElement);
  return !style || style.display !== 'none';
};

// ---- a list in a sheet ---------------------------------------------------------------------------------------------

const SHEET = '[class*="mobile-dialog-"]';
const ROWS = '[class*="list-view-item-"]';
const MARKED = /list-item-selected/;

const inputOf = (control: Control): HTMLInputElement | null => control.el.querySelector<HTMLInputElement>(':scope > input');
const readList = (control: Control): string | null => clean(inputOf(control)?.value) || null;
const answersIn = (value: string | null): string[] => (value ? value.split(JOIN).map(clean).filter(Boolean) : []);

/** The sheet's own buttons, by what they say: 取消, 清除, 确认. */
function button(sheet: Element, says: string): HTMLElement | null {
  const bar = sheet.querySelector('[class*="top-bar-"]') ?? sheet;
  return Array.from(bar.querySelectorAll<HTMLElement>(':scope > *')).find((b) => clean(b.textContent) === says) ?? null;
}

async function closeSheet(control: Control, sheet: HTMLElement, ctx: DriverContext): Promise<void> {
  if (!sheet.isConnected) return;
  const cancel = button(sheet, '取消');
  if (cancel) simulateClick(cancel);
  await waitFor(() => !sheet.isConnected || !control.el.contains(sheet) || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc });
}

/** The single answer itself: the matcher may not merely find something like it among what is there. */
const holds = (match: OptionMatcher, label: string): boolean => {
  const m = match([{ label }]);
  return m.status === 'matched' && m.confidence >= 0.9;
};

async function fillList(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const wanted = intent.kind === 'choice' ? [{ query: intent.query, match: intent.match }] : intent.kind === 'multi' ? intent.items : null;
  if (!wanted) return failed(`a ${intent.kind} answer on a list`, readList(control));
  const multiple = control.multiple === true;
  const current = readList(control);
  const already = answersIn(current);
  const missing = wanted.filter((w) => !already.some((a) => holds(w.match, a)));
  if (missing.length === 0) return { ok: true, observed: current };
  // One answer only, and another one is there: the page's own answer stays.
  if (!multiple && current) return failed('kept what the page already shows', current, 'needs_review');
  const input = inputOf(control);
  if (!input) return failed('the list has no input', current);
  simulateClick(input);
  const sheet = await waitFor(() => control.el.querySelector<HTMLElement>(SHEET), { timeout: OPENS_MS, signal: ctx.signal, root: control.el });
  if (!sheet) return failed('the list did not open', current);
  const rows = Array.from(sheet.querySelectorAll<HTMLElement>(ROWS));
  const options: OptionInfo[] = rows.map((r) => ({ label: clean(r.querySelector('[class*="content-"]')?.textContent ?? r.textContent) }));
  const tap: HTMLElement[] = [];
  const unmatched: string[] = [];
  for (const w of multiple ? missing : missing.slice(0, 1)) {
    const m = w.match(options);
    if (m.status === 'ambiguous') {
      await closeSheet(control, sheet, ctx);
      return failed(`several options fit ${w.query}`, current, 'needs_review');
    }
    if (m.status !== 'matched') unmatched.push(w.query);
    else if (!MARKED.test(rows[m.index]!.className) && !tap.includes(rows[m.index]!)) tap.push(rows[m.index]!);
  }
  // Only some of a multi answer is on the list: what it has is marked, and the applicant is asked about the rest. A
  // second fill finds those marked already and says the same.
  const partial = (now: string | null) => failed(`not on the list: ${unmatched.join(', ')}`, now, 'needs_review');
  if (tap.length === 0) {
    await closeSheet(control, sheet, ctx);
    const held = missing.length < wanted.length;
    return held && unmatched.length > 0 ? partial(current) : failed(`nothing on the list for ${unmatched.join(', ')}`, current, 'no_option');
  }
  for (const row of tap) {
    simulateClick(row);
    if (!(await waitFor(() => MARKED.test(row.className) || null, { timeout: SETTLES_MS, signal: ctx.signal, root: sheet }))) {
      await closeSheet(control, sheet, ctx);
      return failed('the list would not mark the answer', current);
    }
  }
  const ok = button(sheet, '确认');
  if (!ok) {
    await closeSheet(control, sheet, ctx);
    return failed('the list has no 确认', current);
  }
  simulateClick(ok);
  const taken = (): boolean => {
    const now = answersIn(readList(control));
    return tap.every((row) => now.includes(clean(row.querySelector('[class*="content-"]')?.textContent ?? row.textContent)));
  };
  if (!(await waitFor(() => taken() || null, { timeout: SETTLES_MS, signal: ctx.signal, root: ctx.doc }))) {
    await closeSheet(control, sheet, ctx);
    return failed('the list did not take the answer', readList(control));
  }
  if (unmatched.length > 0) return partial(readList(control));
  return { ok: true, observed: readList(control) };
}

// ---- dates on wheels -----------------------------------------------------------------------------------------------

const BOX = '.mobile-text-input';
const PANEL = '[class*="selector-panel-"]';
const COVER = '[class*="loading-cover-"]';
const MONTH = /(\d{4})-(\d{2})/;

const ym = (d: DatePart) => `${d.year}-${String(d.month).padStart(2, '0')}`;
const boxes = (control: Control): HTMLElement[] => Array.from(control.el.querySelectorAll<HTMLElement>(BOX));
/** What a box shows, without the age a birth date has after it. */
const readBox = (box: HTMLElement | undefined): string | null => MONTH.exec(box?.querySelector('.mobile-text-input__input')?.textContent ?? '')?.[0] ?? null;

function readDate(control: Control): string | null {
  const parts = boxes(control).map(readBox);
  if (parts.every((p) => !p)) return null;
  return parts.length === 2 ? `${parts[0] ?? ''} ~ ${parts[1] ?? ''}` : parts[0]!;
}

const columns = (panel: Element): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>('[data-column]'));
const itemsOf = (column: Element): HTMLElement[] => Array.from(column.querySelectorAll<HTMLElement>('[data-list] > li'));
const activeIn = (column: Element): number => itemsOf(column).findIndex((li) => li.dataset.active === 'true' || /item-active/.test(li.className));

/** Row height as laid out, else as the page's code has it. */
function rowOf(column: Element): number {
  const h = itemsOf(column)[0]?.getBoundingClientRect().height ?? 0;
  return h > 0 ? h : ROW;
}

/** A finger on the column, moved by `dy` and lifted: the page moves its list with it. */
async function drag(column: HTMLElement, dy: number, signal?: AbortSignal): Promise<void> {
  const r = column.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  column.dispatchEvent(touchEvent(column, 'touchstart', x, y0, false));
  for (let i = 1; i <= MOVES; i++) {
    if (signal?.aborted) return;
    await sleep(MOVE_MS);
    column.dispatchEvent(touchEvent(column, 'touchmove', x, y0 + (dy * i) / MOVES, false));
  }
  column.dispatchEvent(touchEvent(column, 'touchend', x, y0 + dy, true));
}

async function turn(column: HTMLElement, value: number, ctx: DriverContext): Promise<boolean> {
  const target = itemsOf(column).findIndex((li) => Number(li.dataset.value ?? li.textContent) === value);
  if (target < 0) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const from = activeIn(column);
    if (from === target) return true;
    // Later rows are further down: the finger goes up to bring them to the band.
    await drag(column, (Math.max(0, from) - target) * rowOf(column), ctx.signal);
    if (await waitFor(() => activeIn(column) === target || null, { timeout: SETTLES_MS, signal: ctx.signal, root: column })) return true;
  }
  return activeIn(column) === target;
}

async function setBox(box: HTMLElement, when: DatePart, ctx: DriverContext): Promise<string | null> {
  const want = ym(when);
  if (readBox(box) === want) return null;
  // Only the part showing the value listens; the label beside it and the box around it open nothing.
  simulateClick(box.querySelector('.mobile-text-input__input') ?? box);
  const panel = await waitFor(() => box.querySelector<HTMLElement>(PANEL), { timeout: OPENS_MS, signal: ctx.signal, root: box });
  if (!panel) return 'the wheels did not open';
  const close = async () => {
    const cancel = panel.querySelector('[class*="btn-cancel"]');
    if (cancel && panel.isConnected) simulateClick(cancel);
    await waitFor(() => !panel.isConnected || null, { timeout: SETTLES_MS, signal: ctx.signal, root: box });
  };
  if (!(await waitFor(() => !shown(panel.querySelector(COVER)) || null, { timeout: READY_MS, signal: ctx.signal, root: panel }))) {
    await close();
    return 'the wheels stayed covered';
  }
  const [year, month] = columns(panel);
  // The months a wheel offers can depend on the year, so the year goes first.
  if (!year || !month || !(await turn(year, when.year, ctx)) || !(await turn(month, when.month, ctx))) {
    await close();
    return `the wheels would not turn to ${want}`;
  }
  const ok = panel.querySelector('[class*="btn-confirm"]');
  if (!ok) {
    await close();
    return 'the wheels have no 确定';
  }
  simulateClick(ok);
  if (!(await waitFor(() => readBox(box) === want || null, { timeout: SETTLES_MS, signal: ctx.signal, root: box }))) {
    await close();
    return `the box did not take ${want}`;
  }
  return null;
}

async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const [first, second] = boxes(control);
  const plan: [HTMLElement, DatePart][] | null =
    intent.kind === 'date' && first && !second
      ? [[first, intent]]
      : (intent.kind === 'dateRange' || intent.kind === 'dateFrom') && first && second
        ? [[first, intent.start], ...(intent.kind === 'dateRange' ? ([[second, intent.end]] as [HTMLElement, DatePart][]) : [])]
        : null;
  if (!plan) return failed(`a ${intent.kind} answer on ${boxes(control).length} date boxes`, readDate(control));
  for (const [box, when] of plan) {
    const problem = await setBox(box, when, ctx);
    if (problem) return failed(problem, readDate(control));
  }
  // Still going: the wheels have no word for that, and any month put in its place would be untrue.
  if (intent.kind === 'dateFrom') return failed('still going, and the form has no word for that', readDate(control), 'needs_review');
  return { ok: true, observed: readDate(control) };
}

// ---- the drivers ---------------------------------------------------------------------------------------------------

const guarded = async (run: () => Promise<FillResult>, read: () => string | null): Promise<FillResult> => {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), read());
  }
};

const isPhoneList = (c: Control) => c.el.matches('[class*="applyField-"] > *') && c.el.querySelector(':scope > input[readonly]') !== null;
const isPhoneDate = (c: Control) => c.el.matches('.old-style-hack');

export const mokaMobileDrivers: Driver[] = [
  { id: 'moka-m-list', lib: 'moka', kinds: ['select'], match: isPhoneList, fill: (c, i, ctx) => guarded(() => fillList(c, i, ctx), () => readList(c)), read: readList },
  { id: 'moka-m-date', lib: 'moka', kinds: ['date'], match: isPhoneDate, fill: (c, i, ctx) => guarded(() => fillDate(c, i, ctx), () => readDate(c)), read: readDate },
];
