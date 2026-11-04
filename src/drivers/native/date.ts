// Native driver: date and month inputs.
import type { Control } from '../../engine/types';
import { fireBlur, fireChange, fireInput, focusElement, setNativeValue } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { failed, settle } from './shared';
import { textOf } from './text';

// ------------------------------------------------------------------ date

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function isoFor(intent: FillIntent, type: string): string | null {
  if (intent.kind === 'date') {
    const ym = `${pad(intent.year, 4)}-${pad(intent.month)}`;
    return type === 'month' ? ym : `${ym}-${pad(intent.day ?? 1)}`;
  }
  const raw = textOf(intent);
  if (raw !== null && (type === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(raw)) return raw;
  return null;
}

export async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const el = control.el as HTMLInputElement;
  const type = (el.type || '').toLowerCase();
  if (type !== 'date' && type !== 'month') return failed(`not a date input (${type})`);
  const iso = isoFor(intent, type);
  if (!iso) return failed(`cannot express ${intent.kind} intent as ${type}`);
  focusElement(el);
  setNativeValue(el, iso);
  fireInput(el, iso, 'insertReplacementText');
  fireChange(el);
  fireBlur(el);
  const ok = await settle(el, ctx, () => el.value === iso);
  return ok ? { ok: true, observed: el.value } : failed('date value rejected', el.value);
}
