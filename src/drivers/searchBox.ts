// Text boxes that keep only a result picked from their search, with no ARIA roles to go by. An adapter
// names the parts (Control.search). The text in the box proves nothing until the page has taken a result.
import type { Control, OptionInfo } from '../engine/types';
import { clickWithoutSubmit, sameChoice, verdict } from './aria';
import { visibleOptions, type DropdownOption } from './dropdown';
import { fireBlur, fireChange, fireInput, focusElement, pressKey, setNativeValue } from './events';
import type { Driver, DriverContext, FillIntent, FillResult } from './types';
import { waitFor } from './wait';

const LOAD_MS = 3000;
const SETTLE_MS = 800;
const AFTER_LEAVING_MS = 60;

const failed = (detail: string, observed: string | null): FillResult => ({ ok: false, observed, outcome: 'action_failed', detail });

const readValue = (control: Control): string | null => (control.el as HTMLInputElement).value.trim() || null;

function results(control: Control): DropdownOption[] {
  const scope = control.el.closest(control.search?.within ?? 'body');
  return scope ? visibleOptions(scope, control.search?.option ?? '') : [];
}

function hiddenInput(control: Control): HTMLInputElement | null {
  const selector = control.search?.picked;
  return selector ? (control.el.getRootNode() as Document | ShadowRoot).querySelector<HTMLInputElement>(selector) : null;
}

/**
 * The page must hold the place the box shows: another script may have written a different one there.
 * With no hidden input to check, the text left in the box is all there is to go by.
 */
function pageTook(control: Control): boolean {
  if (!control.search?.picked) return true;
  const shown = (control.el as HTMLInputElement).value.trim();
  return !!shown && (hiddenInput(control)?.value ?? '').includes(shown);
}

async function fill(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'choice') return failed(`unsupported intent for a search box: ${intent.kind}`, readValue(control));
  const input = control.el as HTMLInputElement;
  const infos = (o: DropdownOption[]): OptionInfo[] => o.map((x) => x.info);
  const shown = readValue(control);
  if (shown && pageTook(control) && intent.match([{ label: shown }]).status === 'matched') return { ok: true, observed: shown };

  const wait = <T>(check: () => T | null, timeout: number): Promise<T | null> =>
    waitFor(check, { timeout: Math.min(ctx.timeoutMs, timeout), root: input.ownerDocument, signal: ctx.signal });
  const before = input.value;
  const hidden = hiddenInput(control);
  const hiddenBefore = hidden?.value ?? '';
  // Leaving first, since a page may empty the box then. No input event after: that would open the list again.
  const putBack = (): void => {
    fireBlur(input);
    setNativeValue(input, before);
    if (hidden) hidden.value = hiddenBefore;
  };

  focusElement(input);
  setNativeValue(input, intent.query);
  fireInput(input, intent.query);
  // Some of these search on the key press and not on the input event.
  pressKey(input, intent.query.slice(-1));

  const answered = await wait(() => {
    const now = results(control);
    return intent.match(infos(now)).status !== 'none' ? now : null;
  }, LOAD_MS);
  const options = answered ?? results(control);
  const picked = verdict(intent.match(infos(options)), options, null);
  if ('fail' in picked) {
    putBack();
    return { ...picked.fail, observed: readValue(control) };
  }

  clickWithoutSubmit(options.find((o) => o.info.label === picked.label)!.el);
  const took = await wait(() => (pageTook(control) && sameChoice(input.value.trim(), picked.label) ? true : null), SETTLE_MS);
  if (!took) {
    putBack();
    return failed(`result "${picked.label}" was not taken`, readValue(control));
  }
  // As a person editing it would: a page may keep a changed field from being overwritten later.
  fireChange(input);
  fireBlur(input);
  await new Promise((resolve) => setTimeout(resolve, AFTER_LEAVING_MS));
  const kept = pageTook(control) && sameChoice(input.value.trim(), picked.label);
  return kept ? { ok: true, observed: readValue(control) } : failed('the value did not survive leaving the field', readValue(control));
}

export const searchBoxDriver: Driver = {
  id: 'search-box',
  lib: 'search',
  kinds: ['select'],
  match: (control) => !!control.search,
  fill: async (control, intent, ctx) => {
    try {
      return await fill(control, intent, ctx);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error), readValue(control));
    }
  },
  read: readValue,
};
