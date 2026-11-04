// Native driver: <input> text and <textarea>.
import type { Control } from '../../engine/types';
import { valuesEquivalent } from '../equivalence';
import { fireBlur, fireChange, fireInput, focusElement, setNativeValue, typeText } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { failed, settle } from './shared';

// ------------------------------------------------------------------ text / textarea

export async function fillText(control: Control, text: string, ctx: DriverContext): Promise<FillResult> {
  const el = control.el as HTMLInputElement | HTMLTextAreaElement;
  focusElement(el);
  if (ctx.attempt === 2) {
    typeText(el, text);
  } else {
    setNativeValue(el, text);
    fireInput(el, text);
  }
  fireChange(el);
  fireBlur(el);
  const ok = await settle(el, ctx, () => valuesEquivalent(text, el.value));
  return ok ? { ok: true, observed: el.value } : failed('value did not stick', el.value);
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
