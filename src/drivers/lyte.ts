// Zoho's Lyte lists. A press on the list's combobox moves its box of items to the end of <body>; a press on an item
// takes it. A list shows its one answer as a label, a list that takes several shows each as a tag and stays open, and
// the phone's list of countries shows the chosen country's code.
import type { Control, OptionInfo } from '../engine/types';
import { findDropdownNear, shutDropdown, type DropdownOption } from './dropdown';
import { simulateClick } from './events';
import type { Driver, DriverContext, FillIntent, FillResult, OptionMatcher } from './types';
import { waitFor } from './wait';

const BOX = 'lyte-drop-box:not(.lyteDropdownHidden)';
const ITEM = 'lyte-drop-item';
const OPENS_MS = 1500;
const TAKES_MS = 1500;

const failed = (detail: string, observed: string | null, outcome: FillResult['outcome'] = 'action_failed'): FillResult => ({ ok: false, observed, outcome, detail });
const clean = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim();

const isPhone = (control: Control): boolean => control.el.closest('crux-phone-component') !== null;
const tagsOf = (control: Control): string[] =>
  Array.from(control.el.querySelectorAll('ul.lyteMultipleSelect > li[data-value]')).map((li) => li.getAttribute('data-value') ?? clean(li.textContent));

/** What the list shows: its answer, its answers one after another, or the phone's code; null for -None-. */
function readList(control: Control): string | null {
  if (control.multiple) return tagsOf(control).join('、') || null;
  if (isPhone(control)) return clean(control.el.querySelector('.flag-drop-code')?.textContent).replace(/^\((.*)\)$/, '$1') || null;
  return clean(control.el.querySelector('.lyteDropdownLabel')?.textContent) || null;
}

/** The phone's items hold a country and its code apart: "Australia +61". */
function optionsIn(box: Element): DropdownOption[] {
  return Array.from(box.querySelectorAll<HTMLElement>(ITEM)).flatMap((el) => {
    const parts = Array.from(el.querySelectorAll('span')).map((s) => clean(s.textContent)).filter(Boolean);
    const label = parts.length > 0 ? parts.join(' ') : clean(el.textContent);
    if (!label || label === '-None-') return [];
    const value = el.getAttribute('data-value') ?? undefined;
    const info: OptionInfo = value === undefined ? { label } : { label, value };
    return [{ el, info }];
  });
}

async function open(control: Control, ctx: DriverContext): Promise<HTMLElement | null> {
  const opener = control.el.querySelector('.lyteDummyEventContainer') ?? control.el.querySelector('lyte-drop-button') ?? control.el;
  simulateClick(opener);
  return waitFor(() => findDropdownNear(control.el, BOX, { doc: ctx.doc }), { timeout: OPENS_MS, signal: ctx.signal, root: ctx.doc });
}

const shut = (control: Control, ctx: DriverContext) => shutDropdown(ctx.doc, () => findDropdownNear(control.el, BOX, { doc: ctx.doc }) !== null);

/** Whether the list now shows the item picked. */
function shows(control: Control, item: DropdownOption): boolean {
  const value = item.info.value ?? item.info.label;
  if (control.multiple) return tagsOf(control).includes(value);
  if (isPhone(control)) return control.el.querySelector(`lyte-yield[selected-value="${CSS.escape(value)}"]`) !== null;
  return readList(control) === item.info.label;
}

async function pick(control: Control, box: Element, match: OptionMatcher, query: string, ctx: DriverContext): Promise<FillResult | null> {
  const options = optionsIn(box);
  const m = match(options.map((o) => o.info));
  if (m.status === 'ambiguous') return failed('several options fit', readList(control), 'needs_review');
  if (m.status !== 'matched') return failed(`nothing on the list for ${query}`, readList(control), 'no_option');
  const item = options[m.index]!;
  if (shows(control, item)) return null;
  item.el.scrollIntoView?.({ block: 'nearest' });
  simulateClick(item.el);
  const taken = await waitFor(() => shows(control, item) || null, { timeout: TAKES_MS, signal: ctx.signal, root: ctx.doc });
  return taken ? null : failed('the list did not take the choice', readList(control));
}

async function fillList(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const wanted =
    intent.kind === 'choice' ? [{ query: intent.query, match: intent.match }] : intent.kind === 'multi' && control.multiple ? intent.items : null;
  if (!wanted) return failed(`a ${intent.kind} answer on a ${control.multiple ? 'list of several' : 'list'}`, readList(control));
  try {
    for (const { query, match } of wanted) {
      // A list that takes one shuts once it has taken it; one that takes several stays open, and a press would shut it.
      const box = findDropdownNear(control.el, BOX, { doc: ctx.doc }) ?? (await open(control, ctx));
      if (!box) return failed('the list did not open', readList(control));
      const result = await pick(control, box, match, query, ctx);
      if (result) return result;
    }
    return { ok: true, observed: readList(control) };
  } finally {
    shut(control, ctx);
  }
}

const guarded = async (run: () => Promise<FillResult>, read: () => string | null): Promise<FillResult> => {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), read());
  }
};

export const lyteDrivers: Driver[] = [
  {
    id: 'lyte-list',
    lib: 'lyte',
    kinds: ['select'],
    match: () => true,
    fill: (c, i, ctx) => guarded(() => fillList(c, i, ctx), () => readList(c)),
    read: readList,
  },
];
