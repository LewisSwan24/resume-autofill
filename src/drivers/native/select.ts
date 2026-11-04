// Native driver: <select>.
import { isPlaceholderOption } from '../../dictionary/options';
import type { Control, OptionInfo } from '../../engine/types';
import { fireBlur, fireChange, focusElement, makeEvent } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { failed, matchersOf, pickOptions, settle, squash } from './shared';

// ------------------------------------------------------------------ select

function selectOptions(select: HTMLSelectElement): OptionInfo[] {
  return Array.from(select.options).map((o) => ({
    label: squash(o.label || o.textContent),
    value: o.value,
    disabled: o.disabled,
  }));
}

function selectedIndexes(select: HTMLSelectElement): number[] {
  return Array.from(select.options).flatMap((o, i) => (o.selected ? [i] : []));
}

export function readSelect(select: HTMLSelectElement): string | null {
  const labels = selectedIndexes(select)
    .map((i) => select.options[i]!)
    .filter((o) => !isPlaceholderOption({ label: squash(o.label || o.textContent), value: o.value }))
    .map((o) => squash(o.label || o.textContent));
  return labels.length > 0 ? labels.join(', ') : null;
}

export async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const select = control.el as HTMLSelectElement;
  const matchers = matchersOf(intent);
  if (!matchers || matchers.length === 0) return failed(`unsupported intent for select: ${intent.kind}`);
  if (!select.multiple && matchers.length > 1) return failed('several values for a single-select');

  const picked = pickOptions(matchers, selectOptions(select));
  if ('result' in picked) return { ...picked.result, observed: readSelect(select) };

  focusElement(select);
  // Use `selected` only: assigning `.value` afterwards would jump to the first option with a duplicate value.
  Array.from(select.options).forEach((o, i) => {
    if (select.multiple) o.selected = picked.indexes.includes(i);
    else if (i === picked.indexes[0]) o.selected = true;
  });
  select.dispatchEvent(makeEvent(select, ['Event'], 'input'));
  fireChange(select);
  fireBlur(select);

  const want = [...picked.indexes].sort((a, b) => a - b).join(',');
  const ok = await settle(select, ctx, () => selectedIndexes(select).join(',') === want);
  return ok ? { ok: true, observed: readSelect(select) } : failed('selection did not stick', readSelect(select));
}
