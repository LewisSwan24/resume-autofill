// Workday's search-and-pick control: a plain input, a list that shows when it is clicked (or after typing
// and pressing Enter), and the choice shown as a pill. Text in the input is never an answer.
import type { Control } from '../../engine/types';
import { isVisible } from '../../engine/visibility';
import { clickWithoutSubmit, sameChoice, verdict } from '../aria';
import { visibleOptions, type DropdownOption } from '../dropdown';
import { fireInput, focusElement, pressKey, setNativeValue } from '../events';
import type { Driver, DriverContext, FillIntent, FillResult } from '../types';
import { waitFor } from '../wait';

const OPEN_MS = 800;
const SEARCH_MS = 2000;
const SETTLE_MS = 800;
const AFTER_LEAVING_MS = 60;

const failed = (detail: string, observed: string | null): FillResult => ({ ok: false, observed, outcome: 'action_failed', detail });

function chosen(control: Control): string[] {
  const p = control.prompt;
  const box = p && control.el.closest(p.within);
  if (!p || !box) return [];
  return Array.from(box.querySelectorAll(p.chosen))
    .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const readValue = (control: Control): string | null => chosen(control).join(', ') || null;

function openList(control: Control): HTMLElement | null {
  const selector = control.prompt?.list;
  if (!selector) return null;
  return Array.from(control.el.ownerDocument.querySelectorAll<HTMLElement>(selector)).find((l) => isVisible(l)) ?? null;
}

/** Only an end of the tree is an answer: a folder only opens another list. */
function answers(control: Control): DropdownOption[] {
  const p = control.prompt;
  const list = openList(control);
  if (!p || !list) return [];
  return visibleOptions(list, p.option).filter((o) => o.el.querySelector(p.leaf));
}

async function fill(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`unsupported intent for a prompt: ${intent.kind}`, readValue(control));
  const input = control.el as HTMLInputElement;
  const doc = input.ownerDocument;

  const already = chosen(control);
  if (already.length > 0) {
    if (intent.match(already.map((label) => ({ label }))).status === 'matched') return { ok: true, observed: readValue(control) };
    // These can hold several: another pick would add to what is there, not replace it.
    return { ok: false, observed: readValue(control), outcome: 'needs_review' };
  }

  const wait = <T>(check: () => T | null, timeout: number): Promise<T | null> =>
    waitFor(check, { timeout: Math.min(ctx.timeoutMs, timeout), root: doc, signal: ctx.signal });
  const look = (o: DropdownOption[]) => intent.match(o.map((x) => x.info));
  // Clicking on the page around it is what closes the list. Escape does not.
  const closeList = async (): Promise<boolean> => {
    if (!openList(control)) return true;
    clickWithoutSubmit(doc.body);
    return !!(await wait(() => (openList(control) ? null : true), OPEN_MS));
  };
  const leave = async (): Promise<void> => {
    if (input.value) {
      setNativeValue(input, '');
      fireInput(input, null, 'deleteContentBackward');
    }
    await closeList();
  };

  // Nothing ties a list to its field, so one left from the field before would be read as this one's.
  if (!(await closeList())) return failed('another list is still open', readValue(control));

  try {
    focusElement(input);
    clickWithoutSubmit(input);
    await wait(() => openList(control), OPEN_MS);
    let options = answers(control);
    if (look(options).status === 'none' && intent.query.trim()) {
      setNativeValue(input, intent.query);
      fireInput(input, intent.query);
      pressKey(input, 'Enter');
      options = (await wait(() => {
        if (chosen(control).length > 0) return [];
        const now = answers(control);
        return look(now).status !== 'none' ? now : null;
      }, SEARCH_MS)) ?? answers(control);
      // The page may pick a lone result by itself, which nobody here has approved.
      const taken = chosen(control);
      if (taken.length > 0) {
        return intent.match(taken.map((label) => ({ label }))).status === 'matched'
          ? { ok: true, observed: readValue(control) }
          : { ok: false, observed: readValue(control), outcome: 'needs_review' };
      }
    }
    // "The site has no such answer" is only true of a list that was read.
    if (!openList(control)) return failed('list did not open', readValue(control));
    const picked = verdict(look(options), options, null);
    if ('fail' in picked) return { ...picked.fail, observed: readValue(control) };

    clickWithoutSubmit(options.find((o) => o.info.label === picked.label)!.el);
    const took = await wait(() => (chosen(control).some((v) => sameChoice(v, picked.label)) ? true : null), SETTLE_MS);
    if (!took) return failed(`"${picked.label}" was not taken`, readValue(control));
  } finally {
    await leave();
  }
  await new Promise((resolve) => setTimeout(resolve, AFTER_LEAVING_MS));
  const shown = readValue(control);
  return shown ? { ok: true, observed: shown } : failed('the value did not survive leaving the field', shown);
}

export const workdayPromptDriver: Driver = {
  id: 'workday-prompt',
  lib: 'workday',
  kinds: ['select'],
  match: (control) => !!control.prompt,
  fill: async (control, intent, ctx) => {
    try {
      return await fill(control, intent, ctx);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error), readValue(control));
    }
  },
  read: readValue,
};
