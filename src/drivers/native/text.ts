// Native driver: <input> text and <textarea>.
import type { Control } from '../../engine/types';
import { valuesEquivalent } from '../equivalence';
import { fireBlur, fireChange, fireInput, focusElement, pressKey, setNativeValue, typeText } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { failed, settle } from './shared';

// ------------------------------------------------------------------ text / textarea

export async function fillText(control: Control, text: string, ctx: DriverContext): Promise<FillResult> {
  const el = control.el as HTMLInputElement | HTMLTextAreaElement;
  focusElement(el);
  if (ctx.attempt === 2) {
    typeText(el, text);
  } else {
    // An input mask (Cleave) reads a value it keeps from keydown, and throws on a change with none before it.
    pressKey(el, 'Unidentified');
    setNativeValue(el, text);
    fireInput(el, text);
  }
  fireChange(el);
  fireBlur(el);
  const ok = await settle(el, ctx, () => valuesEquivalent(text, el.value) || valuesEquivalent(text, withDialCode(el)));
  return ok ? { ok: true, observed: el.value } : failed('value did not stick', el.value);
}

/** intl-tel-input can keep the country in a list beside the box, and only the rest of the number in the box. */
function withDialCode(el: HTMLInputElement | HTMLTextAreaElement): string {
  const dial = el.closest('.iti')?.querySelector('.iti__country[aria-selected="true"]')?.getAttribute('data-dial-code');
  return dial ? `+${dial} ${el.value}` : el.value;
}

export function textOf(intent: FillIntent): string | null {
  switch (intent.kind) {
    case 'text':
      return intent.text;
    case 'choice':
    case 'multi':
    case 'date':
    case 'cascade':
      return intent.display;
    default:
      return null;
  }
}
