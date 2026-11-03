// Native driver: <input>, <textarea>, <select>, radio / checkbox groups, date / month inputs,
// contenteditable editors and file inputs. Every fill verifies by reading the control back.
import { isPlaceholderOption } from '../dictionary/options';
import { groupInputs } from '../engine/discover';
import type { Control, ControlKind, OptionInfo } from '../engine/types';
import { valuesEquivalent } from './equivalence';
import {
  fireBlur,
  fireChange,
  fireInput,
  focusElement,
  makeEvent,
  setNativeValue,
  simulateClick,
  typeText,
  winOf,
} from './events';
import type { Driver, DriverContext, FillIntent, FillResult, OptionMatcher } from './types';
import { waitFor } from './wait';

/** How long a failed read-back may keep re-checking before the attempt is declared failed. */
const SETTLE_MS = 300;

const NATIVE_KINDS: ControlKind[] = ['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'file', 'richtext'];

const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const stripSpace = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

const failed = (detail: string, observed: string | null = null): FillResult => ({
  ok: false,
  observed,
  outcome: 'action_failed',
  detail,
});

/** Re-check `probe` for a short while: frameworks (React / Vue) may reconcile the DOM a tick later. */
async function settle(el: Element, ctx: DriverContext, probe: () => boolean): Promise<boolean> {
  if (probe()) return true;
  const hit = await waitFor(() => probe() || null, {
    timeout: Math.min(SETTLE_MS, ctx.timeoutMs),
    root: el.ownerDocument,
  });
  return hit !== null;
}

// ------------------------------------------------------------------ option matching

type Picked = { indexes: number[] } | { result: FillResult };

function matchersOf(intent: FillIntent): OptionMatcher[] | null {
  if (intent.kind === 'choice') return [intent.match];
  if (intent.kind === 'multi') return intent.items.map((i) => i.match);
  return null;
}

/**
 * Run every matcher against the options. All-or-nothing: any ambiguity → needs_review, any miss →
 * no_option, and in both cases nothing may be selected.
 */
function pickOptions(matchers: OptionMatcher[], options: OptionInfo[]): Picked {
  const indexes: number[] = [];
  const ambiguous: number[] = [];
  let missing = 0;
  for (const match of matchers) {
    const m = match(options);
    if (m.status === 'ambiguous') {
      ambiguous.push(...m.candidates);
    } else if (m.status === 'none') {
      missing++;
    } else {
      const opt = options[m.index];
      if (!opt || opt.disabled || isPlaceholderOption(opt)) missing++;
      else if (!indexes.includes(m.index)) indexes.push(m.index);
    }
  }
  if (ambiguous.length > 0) {
    const labels = [...new Set(ambiguous.map((i) => options[i]?.label).filter((l): l is string => !!l))];
    return { result: { ok: false, observed: null, outcome: 'needs_review', candidates: labels } };
  }
  if (missing > 0) return { result: { ok: false, observed: null, outcome: 'no_option', detail: 'no matching option' } };
  return { indexes };
}

// ------------------------------------------------------------------ text / textarea

async function fillText(control: Control, text: string, ctx: DriverContext): Promise<FillResult> {
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

function textOf(intent: FillIntent): string | null {
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

async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
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

function readSelect(select: HTMLSelectElement): string | null {
  const labels = selectedIndexes(select)
    .map((i) => select.options[i]!)
    .filter((o) => !isPlaceholderOption({ label: squash(o.label || o.textContent), value: o.value }))
    .map((o) => squash(o.label || o.textContent));
  return labels.length > 0 ? labels.join(', ') : null;
}

async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
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

function readChecked(control: Control): string | null {
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

async function fillRadio(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
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

async function fillCheckbox(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
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

// ------------------------------------------------------------------ richtext

function selectAllContent(el: HTMLElement): void {
  const sel = winOf(el).getSelection?.();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Dispatch a paste carrying text/plain. Returns true when a handler cancelled it (= took over the paste). */
function dispatchPaste(el: HTMLElement, text: string): boolean {
  const win = winOf(el);
  const DT = (win as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  let clipboardData: unknown = null;
  if (typeof DT === 'function') {
    try {
      const dt = new DT();
      dt.setData('text/plain', text);
      clipboardData = dt;
    } catch {
      clipboardData = null;
    }
  }
  clipboardData ??= {
    types: ['text/plain'],
    files: [],
    items: [],
    getData: (type: string) => (type === 'text/plain' || type === 'text' ? text : ''),
    setData: () => undefined,
  };
  const event = makeEvent(el, ['ClipboardEvent', 'Event'], 'paste', { clipboardData });
  if ((event as unknown as { clipboardData?: unknown }).clipboardData == null) {
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  }
  return !el.dispatchEvent(event);
}

function execInsertText(el: HTMLElement, text: string): boolean {
  const doc = el.ownerDocument;
  if (typeof doc.execCommand !== 'function') return false;
  try {
    return doc.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

async function fillRichtext(control: Control, text: string, ctx: DriverContext): Promise<FillResult> {
  const el = control.el;
  const present = (): boolean => stripSpace(el.textContent ?? '').includes(stripSpace(text));
  if (ctx.attempt === 2) simulateClick(el);
  focusElement(el);
  selectAllContent(el);
  // Strategy ladder: simulated paste → execCommand → direct textContent. The first two run the
  // editor's own input pipeline (Quill / Slate / ProseMirror listen to paste and beforeinput).
  if (ctx.attempt === 1) dispatchPaste(el, text);
  if (!present()) {
    selectAllContent(el);
    execInsertText(el, text);
  }
  if (!present()) {
    el.textContent = text;
    fireInput(el, text);
  }
  fireChange(el);
  fireBlur(el);
  const ok = await settle(el, ctx, present);
  const observed = squash(el.textContent);
  return ok ? { ok: true, observed } : failed('editor content did not match', observed);
}

// ------------------------------------------------------------------ file

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64 / base64url without atob or fetch. Throws on a stray character. */
export function decodeBase64(input: string): Uint8Array {
  const s = input.replace(/[\s=]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('invalid base64 data');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, n);
}

/** Parse `data:[<mime>][;base64],<payload>` into bytes. */
export function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^,]*?),([\s\S]*)$/i.exec(dataUrl.trim());
  if (!m) throw new Error('not a data URL');
  const meta = m[1]!;
  const payload = m[2]!;
  const isBase64 = /;base64$/i.test(meta);
  const mime = meta.replace(/;base64$/i, '').split(';')[0] ?? '';
  if (isBase64) return { mime, bytes: decodeBase64(payload.includes('%') ? decodeURIComponent(payload) : payload) };
  const text = decodeURIComponent(payload);
  const bytes =
    typeof TextEncoder === 'function' ? new TextEncoder().encode(text) : Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  return { mime, bytes };
}

function readFiles(control: Control): string | null {
  const files = (control.el as HTMLInputElement).files;
  if (!files || files.length === 0) return null;
  return Array.from(files, (f) => f.name).join(', ');
}

async function fillFile(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'file') return failed(`unsupported intent for file input: ${intent.kind}`);
  const input = control.el as HTMLInputElement;
  const win = winOf(input);
  const { name, type, dataUrl } = intent.file;
  const parsed = parseDataUrl(dataUrl);
  const file = new win.File([parsed.bytes as BlobPart], name, { type: type || parsed.mime });

  const DT = (win as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  let assigned = false;
  if (typeof DT === 'function') {
    try {
      const dt = new DT();
      dt.items.add(file);
      input.files = dt.files;
      assigned = input.files?.length === 1;
    } catch {
      assigned = false;
    }
  }
  if (!assigned) {
    // No DataTransfer (very old engines, jsdom): expose a FileList-shaped object on the instance.
    const list = Object.assign([file], { item: (i: number) => list[i] ?? null });
    Object.defineProperty(input, 'files', { configurable: true, get: () => list });
  }
  fireInput(input);
  fireChange(input);
  const ok = await settle(input, ctx, () => readFiles(control) === name);
  return ok ? { ok: true, observed: readFiles(control) } : failed('file was not attached', readFiles(control));
}

// ------------------------------------------------------------------ driver

function read(control: Control): string | null {
  const el = control.el;
  switch (control.kind) {
    case 'text':
    case 'textarea':
    case 'date':
      return (el as HTMLInputElement).value;
    case 'select':
      return readSelect(el as HTMLSelectElement);
    case 'radio':
      return readChecked(control);
    case 'checkbox': {
      const inputs = groupInputs(control);
      return inputs.length === 1 && !control.multiple ? String(inputs[0]!.checked) : readChecked(control);
    }
    case 'richtext':
      return squash(el.textContent);
    case 'file':
      return readFiles(control);
    default:
      return null;
  }
}

async function fill(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  try {
    switch (control.kind) {
      case 'text':
      case 'textarea':
      case 'richtext': {
        const text = textOf(intent);
        if (text === null) return failed(`unsupported intent for ${control.kind}: ${intent.kind}`);
        return control.kind === 'richtext' ? await fillRichtext(control, text, ctx) : await fillText(control, text, ctx);
      }
      case 'date':
        return await fillDate(control, intent, ctx);
      case 'select':
        return await fillSelect(control, intent, ctx);
      case 'radio':
        return await fillRadio(control, intent, ctx);
      case 'checkbox':
        return await fillCheckbox(control, intent, ctx);
      case 'file':
        return await fillFile(control, intent, ctx);
      default:
        return failed(`native driver cannot fill ${control.kind}`);
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), safeRead(control));
  }
}

function safeRead(control: Control): string | null {
  try {
    return read(control);
  } catch {
    return null;
  }
}

export const nativeDriver: Driver = {
  id: 'native',
  lib: 'native',
  kinds: NATIVE_KINDS,
  // Radio / checkbox widgets of UI libraries wrap real <input>s, so they stay drivable natively
  // unless a library driver registers itself and takes precedence.
  match: (control) =>
    NATIVE_KINDS.includes(control.kind) &&
    (control.lib === 'native' || control.kind === 'radio' || control.kind === 'checkbox'),
  fill,
  read,
};
