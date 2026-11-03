// Element Plus 2.x drivers (Task 16): el-select (single / multiple / filterable remote), el-cascader,
// el-date-picker (year / month / date) and el-upload. el-radio-group / el-checkbox wrap real <input>s,
// so the native driver keeps handling them.
//
// Element Plus teleports every popper to <body> and keeps closed ones in the DOM (display:none, plus
// a ~300 ms leave animation). The right popper is therefore resolved by id (the combobox's
// `aria-controls`, or the trigger's `aria-describedby`), never by "the visible one".
import { normalizeLabel } from '../dictionary/normalize';
import { isPlaceholderOption } from '../dictionary/options';
import type { Control, OptionInfo } from '../engine/types';
import { isVisible } from '../engine/visibility';
import { findDropdownNear, visibleOptions, type DropdownOption } from './dropdown';
import { valuesEquivalent } from './equivalence';
import {
  fireBlur,
  fireChange,
  fireInput,
  focusElement,
  makeEvent,
  pressKey,
  setNativeValue,
  simulateClick,
  typeText,
  winOf,
} from './events';
import { parseDataUrl } from './native';
import type { Driver, DriverContext, FillIntent, FillResult, OptionMatch, OptionMatcher } from './types';
import { nextFrame, waitFor } from './wait';

// ------------------------------------------------------------------ shared helpers

const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

const failed = (detail: string, observed: string | null = null): FillResult => ({
  ok: false,
  observed,
  outcome: 'action_failed',
  detail,
});

const LEAVING = /-leave(?:-active|-to|-from)?$/;

/** An open popper: displayed, not aria-hidden and not in its leave animation. */
function isPopperLive(el: Element | null): el is HTMLElement {
  if (!el || el.getAttribute('aria-hidden') === 'true') return false;
  for (const token of Array.from(el.classList)) if (LEAVING.test(token)) return false;
  return isVisible(el);
}

/** `.el-popper` that owns `id` (the popper itself, or a listbox inside it). */
function popperById(doc: Document, id: string | null | undefined): HTMLElement | null {
  return id ? (doc.getElementById(id)?.closest<HTMLElement>('.el-popper') ?? null) : null;
}

function scrollIntoView(el: HTMLElement): void {
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    /* ignore */
  }
}

/**
 * Close the popper: Escape on the field's input (twice: the first Escape of a filterable select only
 * clears its query), then — as the last resort — toggle it with a click on the control itself.
 * Never clicks anywhere else on the page. Finishes with a blur of the input.
 */
async function closePopper(
  input: HTMLElement | null,
  toggle: HTMLElement,
  getPopper: () => HTMLElement | null,
  ctx: DriverContext,
): Promise<void> {
  const gone = (): boolean => !isPopperLive(getPopper());
  const waitGone = async (ms: number): Promise<boolean> =>
    (await waitFor(() => gone() || null, { timeout: ms, root: ctx.doc })) !== null;
  if (!gone()) {
    for (let i = 0; i < 2 && !gone(); i++) {
      if (input) {
        focusElement(input);
        pressKey(input, 'Escape');
      }
      if (await waitGone(300)) break;
    }
    if (!gone()) {
      simulateClick(toggle);
      await waitGone(500);
    }
  }
  if (input) fireBlur(input);
}

type Picked = { indexes: number[] } | { result: FillResult };

/** Run every matcher: all-or-nothing, ambiguity → needs_review, miss → no_option. Never picks a guess. */
function pickAll(matchers: OptionMatcher[], options: OptionInfo[]): Picked {
  const indexes: number[] = [];
  const ambiguous: number[] = [];
  let missing = 0;
  for (const match of matchers) {
    const m = match(options);
    if (m.status === 'ambiguous') ambiguous.push(...m.candidates);
    else if (m.status === 'none') missing++;
    else {
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

// ------------------------------------------------------------------ el-select

const SELECT_ITEM = '.el-select-dropdown__item';
const LOADING_TEXT = /加载|loading/i;
/** Longest wait for results after typing a query, and how long an unchanged non-matching list counts as final. */
const SEARCH_MS = 2500;
const SETTLE_MS = 450;

interface SelectEnv {
  root: HTMLElement;
  trigger: HTMLElement;
  input: HTMLInputElement | null;
  ctx: DriverContext;
  deadline: number;
}

function selectParts(root: HTMLElement): { trigger: HTMLElement; input: HTMLInputElement | null } {
  const input =
    root.querySelector<HTMLInputElement>('input.el-select__input') ??
    root.querySelector<HTMLInputElement>('input.el-input__inner, input');
  const trigger =
    root.querySelector<HTMLElement>('.el-select__wrapper') ?? root.querySelector<HTMLElement>('.el-input') ?? root;
  return { trigger, input };
}

function selectPopper(env: Pick<SelectEnv, 'root' | 'trigger' | 'input'>): HTMLElement | null {
  const doc = env.root.ownerDocument;
  return (
    popperById(doc, env.input?.getAttribute('aria-controls')) ??
    popperById(doc, env.trigger.getAttribute('aria-describedby')) ??
    findDropdownNear(env.trigger, '.el-select__popper, .el-select-dropdown')
  );
}

function livePopper(env: SelectEnv): HTMLElement | null {
  const p = selectPopper(env);
  return isPopperLive(p) ? p : null;
}

const remaining = (env: SelectEnv): number => Math.max(100, env.deadline - Date.now());

/** Single-select: shown label; multiple: tag texts joined by ", "; null while nothing is selected. */
function readSelect(root: Element): string | null {
  const tags = Array.from(root.querySelectorAll('.el-select__selection .el-tag'))
    .map((t) => squash(t.querySelector('.el-select__tags-text')?.textContent ?? t.textContent))
    .filter(Boolean);
  if (tags.length > 0) return tags.join(', ');
  // The label of the selected option sits in the placeholder node; `is-transparent` marks a real placeholder.
  const shown = squash(root.querySelector('.el-select__placeholder:not(.is-transparent)')?.textContent);
  if (shown) return shown;
  const legacy = squash(root.querySelector<HTMLInputElement>('input.el-input__inner')?.value);
  return legacy || null;
}

/** Element Plus renders the combobox input readonly unless the select is filterable. */
function isFilterable(input: HTMLInputElement | null): boolean {
  return !!input && !input.readOnly;
}

async function openSelect(env: SelectEnv, probeMs: number): Promise<HTMLElement | null> {
  if (!livePopper(env)) {
    scrollIntoView(env.trigger);
    simulateClick(env.ctx.attempt === 2 && env.input ? env.input : env.trigger);
  }
  return waitFor(() => livePopper(env), { timeout: probeMs, root: env.ctx.doc, signal: env.ctx.signal });
}

function currentOptions(env: SelectEnv): DropdownOption[] {
  const p = livePopper(env);
  return p ? visibleOptions(p, SELECT_ITEM) : [];
}

type Chosen = { el: HTMLElement; label: string } | { result: FillResult };

/** Type the query into the select's own input (input events only — no Enter, no change). */
function typeQuery(env: SelectEnv, query: string): void {
  const input = env.input;
  if (!input) return;
  focusElement(input);
  if (env.ctx.attempt === 2) {
    typeText(input, query);
  } else {
    setNativeValue(input, query);
    fireInput(input, query);
  }
}

/** Find the option the matcher wants; a filterable select gets the query typed when nothing matches yet. */
async function chooseOption(env: SelectEnv, matcher: OptionMatcher, query: string): Promise<Chosen> {
  let options = currentOptions(env);
  let picked = pickAll([matcher], options.map((o) => o.info));
  const miss = 'result' in picked && picked.result.outcome === 'no_option';
  if (miss && isFilterable(env.input) && query.trim() !== '') {
    typeQuery(env, query);
    // A remote search shows nothing for its 300 ms debounce, then "加载中" inside `.el-select-dropdown__empty`,
    // then either options or the empty text ("无数据" / "无匹配数据"). Stop at the first definitive answer.
    let signature = '';
    let since = 0;
    const hit = await waitFor(
      () => {
        const popper = livePopper(env);
        if (!popper) return null;
        const empty = squash(popper.querySelector('.el-select-dropdown__empty')?.textContent);
        if (popper.querySelector('.el-select-dropdown__loading') || LOADING_TEXT.test(empty)) return null;
        const opts = visibleOptions(popper, SELECT_ITEM);
        const p = pickAll([matcher], opts.map((o) => o.info));
        if ('indexes' in p || p.result.outcome === 'needs_review') return { opts, p };
        if (empty && opts.length === 0) return { opts, p };
        // Options that match nothing: give up once the list has stopped changing.
        const now = Date.now();
        const sig = opts.map((o) => o.info.label).join('\u0000');
        if (sig !== signature) {
          signature = sig;
          since = now;
        }
        return opts.length > 0 && now - since >= SETTLE_MS ? { opts, p } : null;
      },
      { timeout: Math.min(remaining(env), SEARCH_MS), root: env.ctx.doc, signal: env.ctx.signal },
    );
    if (hit) {
      options = hit.opts;
      picked = hit.p;
    }
  }
  if ('result' in picked) return { result: picked.result };
  const chosen = options[picked.indexes[0]!];
  if (!chosen) return { result: { ok: false, observed: null, outcome: 'no_option' } };
  return { el: chosen.el, label: chosen.info.label };
}

async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const root = control.el;
  let items: { query: string; match: OptionMatcher }[];
  if (intent.kind === 'choice') items = [{ query: intent.query, match: intent.match }];
  else if (intent.kind === 'multi') items = intent.items;
  else return failed(`unsupported intent for el-select: ${intent.kind}`);
  if (items.length === 0) return failed('no value to select');
  const multiple = !!control.multiple || intent.kind === 'multi';
  if (!multiple && items.length > 1) return failed('several values for a single-select');

  const { trigger, input } = selectParts(root);
  const env: SelectEnv = { root, trigger, input, ctx, deadline: Date.now() + ctx.timeoutMs };
  const close = (): Promise<void> => closePopper(input, trigger, () => selectPopper(env), ctx);
  const abort = async (result: FillResult): Promise<FillResult> => {
    await close();
    return { ...result, observed: readSelect(root) };
  };

  try {
    // A remote filterable select shows no popper until options exist, so do not wait long for one.
    const filterable = isFilterable(input);
    const popper = await openSelect(env, filterable ? Math.min(ctx.timeoutMs, 400) : ctx.timeoutMs);
    if (!popper && !filterable) return abort(failed('dropdown did not open'));

    for (const item of items) {
      if (ctx.signal?.aborted) return abort(failed('aborted'));
      const chosen = await chooseOption(env, item.match, item.query);
      if ('result' in chosen) return abort(chosen.result);
      const { el, label } = chosen;
      if (!el.isConnected || !isVisible(el)) return abort(failed('option disappeared before the click'));
      // In a multiple select a click on a selected option would deselect it.
      if (!(multiple && el.classList.contains('is-selected'))) simulateClick(el);
      const shown = await waitFor(
        () => {
          const value = readSelect(root);
          if (value === null) return null;
          const have = normalizeLabel(value);
          const want = normalizeLabel(label);
          return (multiple ? have.includes(want) : have === want) ? value : null;
        },
        { timeout: Math.min(remaining(env), 1500), root: ctx.doc, signal: ctx.signal },
      );
      if (shown === null) return abort(failed('selection did not show in the control'));
    }
    await close();
    return { ok: true, observed: readSelect(root) };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

// ------------------------------------------------------------------ el-cascader

const CASCADER_NODE = 'li.el-cascader-node';

function cascaderPopper(root: HTMLElement): HTMLElement | null {
  const doc = root.ownerDocument;
  return (
    popperById(doc, root.getAttribute('aria-describedby')) ??
    popperById(doc, root.querySelector('input')?.getAttribute('aria-controls')) ??
    findDropdownNear(root, '.el-cascader__dropdown')
  );
}

function readCascader(root: Element): string | null {
  const tags = Array.from(root.querySelectorAll('.el-cascader__tags .el-tag'))
    .map((t) => squash(t.textContent))
    .filter(Boolean);
  if (tags.length > 0) return tags.join(', ');
  return squash(root.querySelector<HTMLInputElement>('input')?.value) || null;
}

/** Region names compare without separators and administrative suffixes: "浙江省" ≈ "浙江". */
const stripSep = (s: string): string => normalizeLabel(s).replace(/[\s/／>\-、,，]/g, '');
const stripRegion = (s: string): string =>
  stripSep(s).replace(/(特别行政区|自治区|自治州|自治县|省|市|区|县|盟|旗)$/u, '');

/** Match one path level: exact, then suffix-insensitive; several hits in a tier → ambiguous, never a guess. */
function matchLevel(label: string, options: OptionInfo[]): OptionMatch {
  for (const norm of [stripSep, stripRegion]) {
    const want = norm(label);
    if (!want) continue;
    const hits = options.flatMap((o, i) => (!o.disabled && norm(o.label) === want ? [i] : []));
    if (hits.length === 1) return { status: 'matched', index: hits[0]!, confidence: norm === stripSep ? 1 : 0.9 };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
  }
  return { status: 'none' };
}

async function fillCascader(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'cascade') return failed(`unsupported intent for el-cascader: ${intent.kind}`);
  const path = intent.path.filter((p) => p.trim() !== '');
  if (path.length === 0) return failed('empty cascade path');
  const root = control.el;
  const input = root.querySelector<HTMLInputElement>('input');
  const deadline = Date.now() + ctx.timeoutMs;
  const left = (): number => Math.max(100, deadline - Date.now());
  const live = (): HTMLElement | null => {
    const p = cascaderPopper(root);
    return isPopperLive(p) ? p : null;
  };
  const close = (): Promise<void> => closePopper(input, root, () => cascaderPopper(root), ctx);
  const abort = async (result: FillResult): Promise<FillResult> => {
    await close();
    return { ...result, observed: readCascader(root) };
  };

  try {
    if (!live()) {
      scrollIntoView(root);
      simulateClick(ctx.attempt === 2 && input ? input : root);
    }
    const popper = await waitFor(live, { timeout: left(), root: ctx.doc, signal: ctx.signal });
    if (!popper) return failed('cascader did not open');

    const clicked: string[] = [];
    for (let level = 0; level < path.length; level++) {
      if (ctx.signal?.aborted) return abort(failed('aborted'));
      const menu = await waitFor(
        () => {
          const m = popper.querySelectorAll<HTMLElement>('.el-cascader-menu')[level];
          return m && m.querySelector(CASCADER_NODE) ? m : null;
        },
        { timeout: left(), root: ctx.doc, signal: ctx.signal },
      );
      if (!menu) return abort(failed(`column ${level + 1} did not render`));
      const options = visibleOptions(menu, CASCADER_NODE).map((o) => ({
        el: o.el,
        info: { label: squash(o.el.querySelector('.el-cascader-node__label')?.textContent ?? o.el.textContent) },
      }));
      const m = matchLevel(path[level]!, options.map((o) => o.info));
      if (m.status === 'none') {
        return abort({ ok: false, observed: null, outcome: 'no_option', detail: `no "${path[level]}" in column ${level + 1}` });
      }
      if (m.status === 'ambiguous') {
        return abort({
          ok: false,
          observed: null,
          outcome: 'needs_review',
          candidates: m.candidates.map((i) => options[i]?.info.label ?? ''),
        });
      }
      const node = options[m.index]!;
      const isLeaf = node.el.getAttribute('aria-haspopup') !== 'true';
      const last = level === path.length - 1;
      // Never click a leaf with path left over: that would commit a shorter, wrong region.
      if (isLeaf && !last) {
        return abort({ ok: false, observed: null, outcome: 'no_option', detail: 'path is deeper than the option tree' });
      }
      if (!isLeaf && last) {
        return abort({ ok: false, observed: null, outcome: 'no_option', detail: 'path stops above a leaf' });
      }
      clicked.push(node.info.label);
      simulateClick(node.el);
      if (!last) {
        const next = await waitFor(
          () => {
            const col = popper.querySelectorAll('.el-cascader-menu')[level + 1];
            return col && col.querySelector(CASCADER_NODE) ? col : null;
          },
          { timeout: left(), root: ctx.doc, signal: ctx.signal },
        );
        if (!next) return abort(failed(`column ${level + 2} did not load`));
      }
    }
    const want = stripSep(clicked.join(''));
    const shown = await waitFor(() => (stripSep(readCascader(root) ?? '') === want ? readCascader(root) : null), {
      timeout: Math.min(left(), 1500),
      root: ctx.doc,
      signal: ctx.signal,
    });
    if (shown === null) return abort(failed('selection did not show in the control'));
    await close();
    return { ok: true, observed: readCascader(root) };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

// ------------------------------------------------------------------ el-date-picker

type Granularity = 'day' | 'month' | 'year';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function dateText(intent: Extract<FillIntent, { kind: 'date' }>, g: Granularity): string {
  const y = pad(intent.year, 4);
  if (g === 'year') return y;
  const ym = `${y}-${pad(intent.month)}`;
  return g === 'month' ? ym : `${ym}-${pad(intent.day ?? 1)}`;
}

function datePopper(root: HTMLElement, input: HTMLInputElement | null): HTMLElement | null {
  const doc = root.ownerDocument;
  return (
    popperById(doc, input?.getAttribute('aria-controls')) ??
    popperById(doc, root.getAttribute('aria-describedby')) ??
    findDropdownNear(root, '.el-picker__popper')
  );
}

const visibleEl = (scope: ParentNode, selector: string): HTMLElement | null =>
  Array.from(scope.querySelectorAll<HTMLElement>(selector)).find((e) => isVisible(e)) ?? null;

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthOf(label: string): number | null {
  const digits = /\d{1,2}/.exec(label);
  if (digits) return Number(digits[0]);
  const idx = MONTHS_EN.findIndex((m) => label.toLowerCase().includes(m));
  return idx >= 0 ? idx + 1 : null;
}

const yearIn = (text: string | null | undefined): number => Number(/\d{4}/.exec(text ?? '')?.[0] ?? NaN);

/**
 * Attempt 2: navigate the panel like a user — year label → decade arrows → year cell → month cell →
 * day cell. The view is re-read after every click, so it works from whichever view the panel opens in.
 * Stops as soon as `done()` holds or the panel offers no way forward.
 */
async function pickViaPanel(
  popper: HTMLElement,
  target: { year: number; month: number; day: number },
  done: () => boolean,
): Promise<void> {
  const win = winOf(popper);
  let monthTried = false;
  for (let step = 0; step < 30 && !done(); step++) {
    const labels = Array.from(popper.querySelectorAll<HTMLElement>('.el-date-picker__header-label')).filter((l) =>
      isVisible(l),
    );
    const shownYear = yearIn(labels[0]?.textContent);
    const yearTable = visibleEl(popper, '.el-year-table');
    const monthTable = visibleEl(popper, '.el-month-table');
    const dateTable = visibleEl(popper, '.el-date-table');

    if (yearTable) {
      const cells = Array.from(yearTable.querySelectorAll<HTMLElement>('td')).map((td) => ({
        td,
        year: yearIn(td.textContent),
      }));
      const hit = cells.find((c) => c.year === target.year && !c.td.classList.contains('disabled'));
      if (hit) {
        simulateClick(hit.td);
      } else {
        const years = cells.map((c) => c.year).filter((n) => !Number.isNaN(n));
        const earlier = years.length > 0 && target.year < Math.min(...years);
        const arrow = popper.querySelector<HTMLElement>(
          earlier ? '.el-date-picker__prev-btn .d-arrow-left' : '.el-date-picker__next-btn .d-arrow-right',
        );
        if (!arrow) return;
        simulateClick(arrow);
      }
    } else if (monthTable) {
      if (shownYear !== target.year && !Number.isNaN(shownYear)) {
        if (!labels[0]) return;
        simulateClick(labels[0]);
      } else {
        const cell = monthTable.querySelectorAll<HTMLElement>('td')[target.month - 1];
        if (!cell || cell.classList.contains('disabled')) return;
        simulateClick(cell);
      }
    } else if (dateTable) {
      const shownMonth = monthOf(labels[1]?.textContent ?? '');
      if (shownYear !== target.year) {
        if (!labels[0]) return;
        simulateClick(labels[0]);
      } else if (shownMonth !== target.month && !monthTried) {
        monthTried = true;
        if (!labels[1]) return;
        simulateClick(labels[1]);
      } else {
        const day = Array.from(dateTable.querySelectorAll<HTMLElement>('td.available')).find(
          (td) =>
            !td.classList.contains('prev-month') &&
            !td.classList.contains('next-month') &&
            squash(td.textContent) === String(target.day),
        );
        if (!day) return;
        simulateClick(day);
      }
    } else {
      return;
    }
    await nextFrame(win);
  }
}

async function fillDate(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'date') return failed(`unsupported intent for el-date-picker: ${intent.kind}`);
  const root = control.el;
  const input =
    root.querySelector<HTMLInputElement>('input.el-input__inner') ?? root.querySelector<HTMLInputElement>('input');
  if (!input) return failed('date picker has no input');
  const g: Granularity = control.dateGranularity ?? 'day';
  const text = dateText(intent, g);
  const popper = (): HTMLElement | null => datePopper(root, input);
  const live = (): HTMLElement | null => {
    const p = popper();
    return isPopperLive(p) ? p : null;
  };
  const committed = (): boolean => valuesEquivalent(text, input.value);

  try {
    scrollIntoView(root);
    if (!live()) {
      focusElement(input);
      simulateClick(input);
    }
    const opened = await waitFor(live, { timeout: Math.min(ctx.timeoutMs, 1500), root: ctx.doc, signal: ctx.signal });

    if (ctx.attempt === 1) {
      // Type the formatted value and confirm with Enter. A value in the wrong display format is not
      // parsed, leaves the popper open and is reverted on close, so "closed + equal" proves the commit.
      setNativeValue(input, text);
      fireInput(input, text);
      pressKey(input, 'Enter');
    } else {
      if (!opened) return failed('date popper did not open');
      await pickViaPanel(opened, { year: intent.year, month: intent.month, day: intent.day ?? 1 }, committed);
    }
    const ok = (await waitFor(() => (committed() && !live() ? true : null), { timeout: 1200, root: ctx.doc, signal: ctx.signal })) !== null;
    if (!ok) {
      await closePopper(input, root, popper, ctx);
      const why = ctx.attempt === 1 ? 'typed date was not accepted' : 'panel selection did not commit';
      return failed(why, input.value || null);
    }
    fireBlur(input);
    return { ok: true, observed: input.value };
  } catch (error) {
    await closePopper(input, root, popper, ctx).catch(() => undefined);
    throw error;
  }
}

// ------------------------------------------------------------------ el-upload

/** File names in the upload list (a sibling of the `.el-upload` trigger, inside the same form item). */
function readUpload(root: Element): string | null {
  const scope = root.closest('.el-form-item__content') ?? root.parentElement ?? root;
  const names = Array.from(scope.querySelectorAll('.el-upload-list__item-name'))
    .map((n) => squash(n.textContent))
    .filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

async function fillUpload(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'file') return failed(`unsupported intent for el-upload: ${intent.kind}`);
  const root = control.el;
  const input = root.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) return failed('upload has no file input');
  const win = winOf(input);
  const { name, type, dataUrl } = intent.file;
  // Already listed (a second fill run): el-upload is additive, so uploading again would duplicate the file.
  const listed = readUpload(root);
  if (listed !== null && listed.split(', ').some((n) => normalizeLabel(n) === normalizeLabel(name))) {
    return { ok: true, observed: listed };
  }
  const parsed = parseDataUrl(dataUrl);
  const file = new win.File([parsed.bytes as BlobPart], name, { type: type || parsed.mime });
  const DT = (win as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  if (typeof DT !== 'function') return failed('DataTransfer is not available');
  const dt = new DT();
  dt.items.add(file);
  input.files = dt.files;
  // Element Plus reads the files in its `change` handler (and then clears the input).
  input.dispatchEvent(makeEvent(input, ['Event'], 'input'));
  fireChange(input);
  const shown = await waitFor(
    () => {
      const v = readUpload(root);
      return v !== null && v.split(', ').some((n) => normalizeLabel(n) === normalizeLabel(name)) ? v : null;
    },
    { timeout: Math.min(ctx.timeoutMs, 2000), root: ctx.doc, signal: ctx.signal },
  );
  return shown !== null
    ? { ok: true, observed: shown }
    : failed('file did not appear in the upload list', readUpload(root));
}

// ------------------------------------------------------------------ drivers

function make(
  id: string,
  kind: Control['kind'],
  fill: Driver['fill'],
  read: (root: Element) => string | null,
): Driver {
  return {
    id,
    lib: 'element',
    kinds: [kind],
    match: (c) => c.lib === 'element' && c.kind === kind,
    async fill(control, intent, ctx) {
      try {
        return await fill(control, intent, ctx);
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error), read(control.el));
      }
    },
    read: (c) => read(c.el),
  };
}

const readDate = (root: Element): string | null =>
  squash(root.querySelector<HTMLInputElement>('input')?.value) || null;

export const elementDrivers: Driver[] = [
  make('element-select', 'select', fillSelect, readSelect),
  make('element-cascader', 'cascader', fillCascader, readCascader),
  make('element-date', 'date', fillDate, readDate),
  make('element-upload', 'file', fillUpload, readUpload),
];

