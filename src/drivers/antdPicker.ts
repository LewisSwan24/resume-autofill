// antd v5 DatePicker driver (picker = date | month | year; range pickers are unsupported upstream).
// Attempt 1: type the formatted value into the (non-readonly) input and press Enter.
// Attempt 2: open the panel and navigate it with the header buttons, then click the cell.
import type { Control } from '../engine/types';
import { closeDropdown, findDropdownNear } from './dropdown';
import { valuesEquivalent } from './equivalence';
import { fireBlur, fireInput, focusElement, pressKey, setNativeValue, simulateClick } from './events';
import { failed, isGone, squash } from './antdShared';
import type { Driver, DriverContext, FillIntent, FillResult } from './types';
import { waitFor } from './wait';

const POPUP = '.ant-picker-dropdown';
type Granularity = 'day' | 'month' | 'year';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

interface Target {
  year: number;
  month: number;
  day: number;
  granularity: Granularity;
  /** Text typed into the input, and the title of the panel cell to click. */
  text: string;
}

function targetOf(control: Control, intent: FillIntent): Target | null {
  if (intent.kind !== 'date') return null;
  const granularity = control.dateGranularity ?? 'day';
  const year = pad(intent.year, 4);
  const month = pad(intent.month);
  const day = intent.day ?? 1;
  const text = granularity === 'year' ? year : granularity === 'month' ? `${year}-${month}` : `${year}-${month}-${pad(day)}`;
  return { year: intent.year, month: intent.month, day, granularity, text };
}

const inputOf = (root: HTMLElement): HTMLInputElement | null => root.querySelector<HTMLInputElement>('input');
const readValue = (root: HTMLElement): string | null => {
  const v = inputOf(root)?.value ?? '';
  return v === '' ? null : v;
};

const popupFor = (root: HTMLElement): HTMLElement | null => findDropdownNear(root, POPUP);

async function openPanel(root: HTMLElement, input: HTMLInputElement, ctx: DriverContext): Promise<HTMLElement | null> {
  const existing = popupFor(root);
  if (existing) return existing;
  try {
    root.scrollIntoView({ block: 'center' });
  } catch {
    /* harmless */
  }
  simulateClick(input);
  focusElement(input);
  return waitFor(() => popupFor(root), { timeout: Math.min(ctx.timeoutMs, 1600), root: root.ownerDocument, signal: ctx.signal });
}

/** Leave the picker closed and wait for the panel's leave animation to finish. */
async function settleClosed(root: HTMLElement, input: HTMLInputElement, popup: HTMLElement | null, ctx: DriverContext) {
  const doc = root.ownerDocument;
  const open = (): boolean => (popup ? !isGone(popup) : popupFor(root) !== null);
  if (open()) {
    pressKey(input, 'Escape');
    const shut = await waitFor(() => !open() || null, { timeout: 500, root: doc });
    if (shut === null) closeDropdown(doc);
  }
  if (doc.activeElement === input) fireBlur(input);
  if (popup) await waitFor(() => isGone(popup) || null, { timeout: Math.min(ctx.timeoutMs, 1500), root: doc });
}

async function typeAndEnter(root: HTMLElement, input: HTMLInputElement, t: Target, ctx: DriverContext): Promise<boolean> {
  focusElement(input);
  setNativeValue(input, t.text);
  fireInput(input, t.text);
  pressKey(input, 'Enter');
  fireBlur(input);
  // The panel closes on a committed value; a rejected one is reverted on blur.
  const done = await waitFor(() => valuesEquivalent(t.text, readValue(root)) || null, {
    timeout: Math.min(ctx.timeoutMs, 800),
    root: root.ownerDocument,
    signal: ctx.signal,
  });
  return done !== null;
}

// ---- panel navigation (attempt 2)

const num = (el: Element | null | undefined): number | null => {
  const m = /\d{4}/.exec(el?.textContent ?? '');
  return m ? Number(m[0]) : null;
};

function shownYear(panel: Element, g: Granularity): number | null {
  if (g === 'year') return num(panel.querySelector('.ant-picker-decade-btn'));
  return num(panel.querySelector('.ant-picker-year-btn'));
}

function shownMonth(panel: Element): number | null {
  const m = /(\d{1,2})/.exec(panel.querySelector('.ant-picker-month-btn')?.textContent ?? '');
  return m ? Number(m[1]) : null;
}

const headerSignature = (panel: Element): string =>
  squash(panel.querySelector('.ant-picker-header-view')?.textContent ?? panel.querySelector('.ant-picker-header')?.textContent);

async function clickHeader(popup: HTMLElement, selector: string): Promise<boolean> {
  const btn = popup.querySelector<HTMLElement>(selector);
  if (!btn) return false;
  const before = headerSignature(popup);
  simulateClick(btn);
  const moved = await waitFor(() => headerSignature(popup) !== before || null, { timeout: 500, root: popup });
  return moved !== null;
}

async function navigateAndClick(popup: HTMLElement, t: Target, signal?: AbortSignal): Promise<boolean> {
  const cellTitle = t.text;
  for (let step = 0; step < 150; step++) {
    if (signal?.aborted) return false;
    const cell = popup.querySelector<HTMLElement>(`td.ant-picker-cell-in-view[title="${cellTitle}"]`);
    if (cell) {
      simulateClick(cell);
      return true;
    }
    const year = shownYear(popup, t.granularity);
    if (year === null) return false;
    let button: string;
    if (t.granularity === 'year') {
      button = t.year < year ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn';
    } else if (year !== t.year) {
      button = t.year < year ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn';
    } else {
      const month = shownMonth(popup);
      if (month === null || month === t.month) return false; // target month shown but cell missing
      button = t.month < month ? '.ant-picker-header-prev-btn' : '.ant-picker-header-next-btn';
    }
    if (!(await clickHeader(popup, button))) return false;
  }
  return false;
}

async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const root = control.el;
  const input = inputOf(root);
  const t = targetOf(control, intent);
  if (!input) return failed('picker input not found');
  if (!t) return failed(`unsupported intent for antd date picker: ${intent.kind}`);
  if (input.readOnly && ctx.attempt === 1) {
    // Typing is impossible on a readonly input: go straight to the panel on both attempts.
    ctx = { ...ctx, attempt: 2 };
  }

  let popup: HTMLElement | null = null;
  try {
    if (ctx.attempt === 1) {
      popup = await openPanel(root, input, ctx);
      const ok = await typeAndEnter(root, input, t, ctx);
      return ok ? { ok: true, observed: readValue(root) } : failed('typed date was not accepted', readValue(root));
    }
    popup = await openPanel(root, input, ctx);
    if (!popup) return failed('date panel did not open', readValue(root));
    const clicked = await navigateAndClick(popup, t, ctx.signal);
    if (!clicked) return failed(`date ${t.text} not reachable in the panel`, readValue(root));
    const ok = await waitFor(() => valuesEquivalent(t.text, readValue(root)) || null, {
      timeout: Math.min(ctx.timeoutMs, 800),
      root: root.ownerDocument,
      signal: ctx.signal,
    });
    return ok !== null ? { ok: true, observed: readValue(root) } : failed('panel click not committed', readValue(root));
  } finally {
    await settleClosed(root, input, popup, ctx);
  }
}

export const antdDateDriver: Driver = {
  id: 'antd-date',
  lib: 'antd',
  kinds: ['date'],
  match: (c) => c.el.classList.contains('ant-picker'),
  fill: async (c, i, ctx) => {
    try {
      return await fillDate(c, i, ctx);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error), readValue(c.el));
    }
  },
  read: (c) => readValue(c.el),
};
