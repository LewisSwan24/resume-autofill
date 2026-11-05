// Element Plus driver: el-date-picker (year / month / date), and its ranges with their two inputs.
import type { Control } from '../../engine/types';
import { isVisible } from '../../engine/visibility';
import { findDropdownNear } from '../dropdown';
import { valuesEquivalent } from '../equivalence';
import { fireBlur, fireInput, focusElement, pressKey, setNativeValue, simulateClick, winOf } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { nextFrame, waitFor } from '../wait';
import { closePopper, failed, isPopperLive, popperById, scrollIntoView, squash } from './shared';

// ------------------------------------------------------------------ el-date-picker

type Granularity = 'day' | 'month' | 'year';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function dateText(intent: Extract<FillIntent, { kind: 'date' }>, g: Granularity): string {
  const y = pad(intent.year, 4);
  if (g === 'year') return y;
  const ym = `${y}-${pad(intent.month)}`;
  return g === 'month' ? ym : `${ym}-${pad(intent.day ?? 1)}`;
}

function datePopper(root: HTMLElement, input: HTMLInputElement | null): HTMLElement | null {
  const doc = root.ownerDocument;
  return (
    popperById(doc, input?.getAttribute('aria-controls')) ??
    popperById(doc, root.getAttribute('aria-describedby')) ??
    findDropdownNear(root, '.el-picker__popper')
  );
}

const visibleEl = (scope: ParentNode, selector: string): HTMLElement | null =>
  Array.from(scope.querySelectorAll<HTMLElement>(selector)).find((e) => isVisible(e)) ?? null;

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthOf(label: string): number | null {
  const digits = /\d{1,2}/.exec(label);
  if (digits) return Number(digits[0]);
  const idx = MONTHS_EN.findIndex((m) => label.toLowerCase().includes(m));
  return idx >= 0 ? idx + 1 : null;
}

const yearIn = (text: string | null | undefined): number => Number(/\d{4}/.exec(text ?? '')?.[0] ?? NaN);

/**
 * Attempt 2: navigate the panel like a user — year label → decade arrows → year cell → month cell →
 * day cell. The view is re-read after every click, so it works from whichever view the panel opens in.
 * Stops as soon as `done()` holds or the panel offers no way forward.
 */
async function pickViaPanel(
  popper: HTMLElement,
  target: { year: number; month: number; day: number },
  done: () => boolean,
): Promise<void> {
  const win = winOf(popper);
  let monthTried = false;
  for (let step = 0; step < 30 && !done(); step++) {
    const labels = Array.from(popper.querySelectorAll<HTMLElement>('.el-date-picker__header-label')).filter((l) =>
      isVisible(l),
    );
    const shownYear = yearIn(labels[0]?.textContent);
    const yearTable = visibleEl(popper, '.el-year-table');
    const monthTable = visibleEl(popper, '.el-month-table');
    const dateTable = visibleEl(popper, '.el-date-table');

    if (yearTable) {
      const cells = Array.from(yearTable.querySelectorAll<HTMLElement>('td')).map((td) => ({
        td,
        year: yearIn(td.textContent),
      }));
      const hit = cells.find((c) => c.year === target.year && !c.td.classList.contains('disabled'));
      if (hit) {
        simulateClick(hit.td);
      } else {
        const years = cells.map((c) => c.year).filter((n) => !Number.isNaN(n));
        const earlier = years.length > 0 && target.year < Math.min(...years);
        const arrow = popper.querySelector<HTMLElement>(
          earlier ? '.el-date-picker__prev-btn .d-arrow-left' : '.el-date-picker__next-btn .d-arrow-right',
        );
        if (!arrow) return;
        simulateClick(arrow);
      }
    } else if (monthTable) {
      if (shownYear !== target.year && !Number.isNaN(shownYear)) {
        if (!labels[0]) return;
        simulateClick(labels[0]);
      } else {
        const cell = monthTable.querySelectorAll<HTMLElement>('td')[target.month - 1];
        if (!cell || cell.classList.contains('disabled')) return;
        simulateClick(cell);
      }
    } else if (dateTable) {
      const shownMonth = monthOf(labels[1]?.textContent ?? '');
      if (shownYear !== target.year) {
        if (!labels[0]) return;
        simulateClick(labels[0]);
      } else if (shownMonth !== target.month && !monthTried) {
        monthTried = true;
        if (!labels[1]) return;
        simulateClick(labels[1]);
      } else {
        const day = Array.from(dateTable.querySelectorAll<HTMLElement>('td.available')).find(
          (td) =>
            !td.classList.contains('prev-month') &&
            !td.classList.contains('next-month') &&
            squash(td.textContent) === String(target.day),
        );
        if (!day) return;
        simulateClick(day);
      }
    } else {
      return;
    }
    await nextFrame(win);
  }
}

/** What a range shows, in the same form the report gives: "2022-03 ~ 2022-06". Null when empty. */
export function readRange(root: HTMLElement): string | null {
  const [start, end] = root.querySelectorAll('input');
  return start?.value || end?.value ? `${start?.value ?? ''} ~ ${end?.value ?? ''}` : null;
}

/** Typing is all there is: a range whose inputs cannot be typed in is left to the applicant. */
async function fillRange(control: Control, intent: Extract<FillIntent, { kind: 'dateRange' }>, ctx: DriverContext): Promise<FillResult> {
  const root = control.el;
  const [startInput, endInput] = Array.from(root.querySelectorAll<HTMLInputElement>('input'));
  if (!startInput || !endInput) return failed('range picker has no inputs');
  if (startInput.readOnly) return failed('range picker cannot be typed in');
  const g: Granularity = control.dateGranularity ?? 'day';
  const from = dateText({ kind: 'date', ...intent.start }, g);
  const to = dateText({ kind: 'date', ...intent.end }, g);
  const committed = (): boolean => valuesEquivalent(from, startInput.value) && valuesEquivalent(to, endInput.value);
  const popper = (): HTMLElement | null => datePopper(root, startInput);
  const live = (): HTMLElement | null => {
    const p = popper();
    return isPopperLive(p) ? p : null;
  };
  try {
    scrollIntoView(root);
    if (!live()) {
      focusElement(startInput);
      simulateClick(startInput);
    }
    await waitFor(live, { timeout: Math.min(ctx.timeoutMs, 1500), root: ctx.doc, signal: ctx.signal });
    for (const [input, text] of [[startInput, from], [endInput, to]] as const) {
      focusElement(input);
      setNativeValue(input, text);
      fireInput(input, text);
      input.dispatchEvent(new (winOf(input).Event)('change', { bubbles: true }));
    }
    pressKey(endInput, 'Enter');
    const ok = (await waitFor(() => (committed() && !live() ? true : null), { timeout: 1200, root: ctx.doc, signal: ctx.signal })) !== null;
    if (!ok) {
      await closePopper(endInput, root, popper, ctx);
      return failed('typed dates were not accepted', readRange(root));
    }
    fireBlur(endInput);
    return { ok: true, observed: readRange(root) };
  } catch (error) {
    await closePopper(endInput, root, popper, ctx).catch(() => undefined);
    throw error;
  }
}

export async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind === 'dateRange') return fillRange(control, intent, ctx);
  if (intent.kind !== 'date') return failed(`unsupported intent for el-date-picker: ${intent.kind}`);
  const root = control.el;
  const input =
    root.querySelector<HTMLInputElement>('input.el-input__inner') ?? root.querySelector<HTMLInputElement>('input');
  if (!input) return failed('date picker has no input');
  const g: Granularity = control.dateGranularity ?? 'day';
  const text = dateText(intent, g);
  const popper = (): HTMLElement | null => datePopper(root, input);
  const live = (): HTMLElement | null => {
    const p = popper();
    return isPopperLive(p) ? p : null;
  };
  const committed = (): boolean => valuesEquivalent(text, input.value);

  try {
    scrollIntoView(root);
    if (!live()) {
      focusElement(input);
      simulateClick(input);
    }
    const opened = await waitFor(live, { timeout: Math.min(ctx.timeoutMs, 1500), root: ctx.doc, signal: ctx.signal });

    if (ctx.attempt === 1) {
      // Type the formatted value and confirm with Enter. A value in the wrong display format is not
      // parsed, leaves the popper open and is reverted on close, so "closed + equal" proves the commit.
      setNativeValue(input, text);
      fireInput(input, text);
      pressKey(input, 'Enter');
    } else {
      if (!opened) return failed('date popper did not open');
      await pickViaPanel(opened, { year: intent.year, month: intent.month, day: intent.day ?? 1 }, committed);
    }
    const ok = (await waitFor(() => (committed() && !live() ? true : null), { timeout: 1200, root: ctx.doc, signal: ctx.signal })) !== null;
    if (!ok) {
      await closePopper(input, root, popper, ctx);
      const why = ctx.attempt === 1 ? 'typed date was not accepted' : 'panel selection did not commit';
      return failed(why, input.value || null);
    }
    fireBlur(input);
    return { ok: true, observed: input.value };
  } catch (error) {
    await closePopper(input, root, popper, ctx).catch(() => undefined);
    throw error;
  }
}
