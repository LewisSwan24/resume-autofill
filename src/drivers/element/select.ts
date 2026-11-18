// Element Plus driver: el-select (single / multiple / filterable remote).
import { normalizeLabel } from '../../dictionary/normalize';
import type { Control } from '../../engine/types';
import { isVisible } from '../../engine/visibility';
import { findDropdownNear, visibleOptions, type DropdownOption } from '../dropdown';
import { fireInput, focusElement, setNativeValue, simulateClick, typeText } from '../events';
import type { DriverContext, FillIntent, FillResult, OptionMatcher } from '../types';
import { waitFor } from '../wait';
import { scrollVirtualDropdown } from '../virtualScroll';
import { closePopper, failed, isPopperLive, pickAll, popperById, scrollIntoView, squash } from './shared';

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
export function readSelect(root: Element): string | null {
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
  if (miss && !isFilterable(env.input)) {
    const popper = livePopper(env);
    if (popper) {
      const scrolled = await scrollVirtualDropdown(popper, matcher, {
        scrollContainerSelector: '.el-select-dropdown__wrap, .el-scrollbar__wrap',
        optionSelector: SELECT_ITEM,
        ...(env.ctx.signal ? { signal: env.ctx.signal } : {}),
      });
      if (scrolled.options.length > options.length) {
        options = scrolled.options;
        picked = pickAll([matcher], options.map((o) => o.info));
      }
    }
  }
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

export async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
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
