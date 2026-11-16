// Native driver: date and month inputs, plus paired native date-range containers.
import type { Control } from '../../engine/types';
import { fireBlur, fireChange, fireInput, focusElement, setNativeValue } from '../events';
import type { DatePart, DriverContext, FillIntent, FillResult } from '../types';
import { failed, settle } from './shared';
import { textOf } from './text';

// ------------------------------------------------------------------ date

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function isoFromPart(part: DatePart, type: string): string {
  const ym = `${pad(part.year, 4)}-${pad(part.month)}`;
  return type === 'month' ? ym : `${ym}-${pad(part.day ?? 1)}`;
}

function isoFor(intent: FillIntent, type: string): string | null {
  if (intent.kind === 'date') return isoFromPart(intent, type);
  const raw = textOf(intent);
  if (raw !== null && (type === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(raw)) return raw;
  return null;
}

async function writeDateInput(el: HTMLInputElement, iso: string, ctx: DriverContext): Promise<boolean> {
  focusElement(el);
  setNativeValue(el, iso);
  fireInput(el, iso, 'insertReplacementText');
  fireChange(el);
  fireBlur(el);
  return settle(el, ctx, () => el.value === iso);
}

export function readDateRange(root: HTMLElement): string | null {
  const [start, end] = root.querySelectorAll<HTMLInputElement>('input');
  const sv = start?.value ?? '';
  const ev = end?.value ?? '';
  return sv || ev ? `${sv} ~ ${ev}` : null;
}

async function fillNativeRange(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'dateRange' && intent.kind !== 'dateFrom') {
    return failed(`cannot express ${intent.kind} intent as date range`);
  }
  const [startEl, endEl] = Array.from(control.el.querySelectorAll<HTMLInputElement>('input'));
  if (!startEl || !endEl) return failed('date range inputs not found');
  const startType = (startEl.type || '').toLowerCase();
  const endType = (endEl.type || '').toLowerCase();
  if ((startType !== 'date' && startType !== 'month') || (endType !== 'date' && endType !== 'month')) {
    return failed(`not date/month range inputs (${startType}, ${endType})`);
  }
  const startIso = isoFromPart(intent.start, startType);
  const endIso = intent.kind === 'dateRange' ? isoFromPart(intent.end, endType) : '';

  const okStart = await writeDateInput(startEl, startIso, ctx);
  if (!okStart) return failed('start date rejected', readDateRange(control.el));
  const okEnd = await writeDateInput(endEl, endIso, ctx);
  return okEnd ? { ok: true, observed: readDateRange(control.el) } : failed('end date rejected', readDateRange(control.el));
}

export async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (control.dateRange) return fillNativeRange(control, intent, ctx);
  const el = control.el as HTMLInputElement;
  const type = (el.type || '').toLowerCase();
  if (type !== 'date' && type !== 'month') return failed(`not a date input (${type})`);
  const iso = isoFor(intent, type);
  if (!iso) return failed(`cannot express ${intent.kind} intent as ${type}`);
  const ok = await writeDateInput(el, iso, ctx);
  return ok ? { ok: true, observed: el.value } : failed('date value rejected', el.value);
}
