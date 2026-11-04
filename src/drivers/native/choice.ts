// Native driver: radio and checkbox groups.
import { groupInputs } from '../../engine/discover';
import type { Control, OptionInfo } from '../../engine/types';
import { simulateClick } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { failed, matchersOf, pickOptions, settle, squash } from './shared';

// ------------------------------------------------------------------ radio / checkbox

function inputLabel(input: HTMLInputElement): string {
  const label = input.labels?.[0] ?? input.closest('label');
  return (
    squash(label?.textContent) ||
    squash(input.nextSibling?.textContent) ||
    squash(input.getAttribute('aria-label')) ||
    squash(input.title) ||
    input.value
  );
}

function inputOptions(control: Control, inputs: HTMLInputElement[]): OptionInfo[] {
  const known = control.options && control.options.length === inputs.length ? control.options : null;
  return inputs.map((input, i) => ({
    label: known?.[i]?.label ?? inputLabel(input),
    value: input.value,
    disabled: input.disabled,
  }));
}

export function readChecked(control: Control): string | null {
  const labels = groupInputs(control)
    .filter((i) => i.checked)
    .map(inputLabel);
  return labels.length > 0 ? labels.join(', ') : null;
}

/**
 * Click (never assign `.checked`, so React / Vue see a real activation) until `input.checked === wanted`.
 * Attempt 1 clicks the input, then its label; attempt 2 reverses the order.
 */
function ensureChecked(input: HTMLInputElement, wanted: boolean, attempt: 1 | 2): void {
  if (input.checked === wanted) return;
  const label = input.labels?.[0] ?? input.closest('label');
  const order = attempt === 1 ? [input, label] : [label, input];
  for (const target of order) {
    if (!target) continue;
    simulateClick(target);
    if (input.checked === wanted) return;
  }
}

export async function fillRadio(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const matchers = matchersOf(intent);
  if (!matchers || matchers.length !== 1) return failed(`unsupported intent for radio: ${intent.kind}`);
  const inputs = groupInputs(control);
  const picked = pickOptions(matchers, inputOptions(control, inputs));
  if ('result' in picked) return { ...picked.result, observed: readChecked(control) };
  const target = inputs[picked.indexes[0]!]!;
  ensureChecked(target, true, ctx.attempt);
  const ok = await settle(target, ctx, () => target.checked);
  return ok ? { ok: true, observed: readChecked(control) } : failed('radio did not become checked', readChecked(control));
}

export async function fillCheckbox(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const inputs = groupInputs(control);
  if (intent.kind === 'check') {
    const input = inputs[0];
    if (!input || inputs.length !== 1) return failed('check intent needs a single checkbox');
    ensureChecked(input, intent.checked, ctx.attempt);
    const ok = await settle(input, ctx, () => input.checked === intent.checked);
    const observed = String(input.checked);
    return ok ? { ok: true, observed } : failed('checkbox state did not change', observed);
  }

  const matchers = matchersOf(intent);
  if (!matchers || matchers.length === 0) return failed(`unsupported intent for checkbox: ${intent.kind}`);
  const picked = pickOptions(matchers, inputOptions(control, inputs));
  if ('result' in picked) return { ...picked.result, observed: readChecked(control) };
  // Exact set: tick the matched boxes, clear the others (disabled boxes cannot change, so they are ignored).
  inputs.forEach((input, i) => {
    if (!input.disabled) ensureChecked(input, picked.indexes.includes(i), ctx.attempt);
  });
  const ok = await settle(control.el, ctx, () =>
    inputs.every((input, i) => input.disabled || input.checked === picked.indexes.includes(i)),
  );
  return ok ? { ok: true, observed: readChecked(control) } : failed('checkbox group did not settle', readChecked(control));
}
