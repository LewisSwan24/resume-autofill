// antd v5 Select (single / multiple / showSearch) and Cascader drivers.
import { matchOption } from '../dictionary/options';
import type { Control, OptionInfo } from '../engine/types';
import { visibleOptions, type DropdownOption } from './dropdown';
import { fireInput, focusElement, setNativeValue, simulateClick } from './events';
import {
  CASCADER_POPUP,
  OPEN_CLASS,
  SELECT_POPUP,
  closePopup,
  currentPopup,
  failed,
  normText,
  openPopup,
  readSelection,
  readSelectionItems,
  searchInputOf,
  squash,
} from './antdShared';
import { valuesEquivalent } from './equivalence';
import type { Driver, DriverContext, FillIntent, FillResult, OptionMatch, OptionMatcher } from './types';
import { waitFor } from './wait';
import { scrollVirtualDropdown } from './virtualScroll';
import { waitCascaderLevelReady } from './asyncCascader';

const OPTION = '.ant-select-item-option';
const SELECTED = 'ant-select-item-option-selected';

const withLabel = (o: DropdownOption): DropdownOption => {
  const title = o.el.getAttribute('title');
  return title ? { el: o.el, info: { ...o.info, label: squash(title) } } : o;
};

/** Rendered, enabled options of a popup. Labels come from `title` (plain text) when present. */
const popupOptions = (popup: Element): DropdownOption[] => visibleOptions(popup, OPTION).map(withLabel);

const infosOf = (opts: DropdownOption[]): OptionInfo[] => opts.map((o) => o.info);

interface Session {
  root: HTMLElement;
  ctx: DriverContext;
  searchable: boolean;
  multiple: boolean;
}

const popupOf = (s: Session): HTMLElement | null => currentPopup(s.root, SELECT_POPUP);

function typeInto(input: HTMLInputElement, text: string): void {
  focusElement(input);
  setNativeValue(input, text);
  fireInput(input, text);
}

/** Scroll the rc-virtual-list holder with fixed-point termination; stops early once `matcher` hits. */
async function gatherByScrolling(popup: HTMLElement, matcher: OptionMatcher, signal?: AbortSignal): Promise<DropdownOption[]> {
  const res = await scrollVirtualDropdown(popup, matcher, {
    scrollContainerSelector: '.rc-virtual-list-holder',
    optionSelector: OPTION,
    mapOption: withLabel,
    ...(signal ? { signal } : {}),
  });
  return res.options;
}

type Resolved = { label: string } | { fail: FillResult };

function verdict(m: OptionMatch, opts: DropdownOption[]): Resolved {
  if (m.status === 'matched') {
    const hit = opts[m.index];
    return hit ? { label: hit.info.label } : { fail: failed('matched option vanished') };
  }
  if (m.status === 'ambiguous') {
    const labels = [...new Set(m.candidates.map((i) => opts[i]?.info.label).filter((l): l is string => !!l))];
    return { fail: { ok: false, observed: null, outcome: 'needs_review', candidates: labels } };
  }
  return { fail: { ok: false, observed: null, outcome: 'no_option', detail: 'no matching option' } };
}

/**
 * Decide which option label a matcher picks, without selecting anything.
 * Order: rendered options → (searchable) type the query → (not searchable) scroll the virtual list.
 */
async function resolveLabel(s: Session, query: string, match: OptionMatcher): Promise<Resolved> {
  const popup = popupOf(s);
  if (!popup) return { fail: failed('dropdown closed') };
  let opts = popupOptions(popup);
  let m = match(infosOf(opts));
  if (m.status === 'none') {
    const input = searchInputOf(s.root);
    if (s.searchable && input && squash(query)) {
      typeInto(input, query);
      const hit = await waitFor(
        () => {
          const now = popupOf(s);
          if (!now) return null;
          const o = popupOptions(now);
          return match(infosOf(o)).status !== 'none' ? o : null;
        },
        { timeout: Math.min(s.ctx.timeoutMs, 1200), root: s.root.ownerDocument, signal: s.ctx.signal },
      );
      const now = popupOf(s);
      opts = hit ?? (now ? popupOptions(now) : []);
      m = match(infosOf(opts));
    } else if (!s.searchable) {
      const all = await gatherByScrolling(popup, match, s.ctx.signal);
      if (all.length > opts.length) {
        opts = all;
        m = match(infosOf(opts));
      }
    }
  }
  return verdict(m, opts);
}

function clearSearch(s: Session): void {
  const input = searchInputOf(s.root);
  if (input && input.value !== '') {
    setNativeValue(input, '');
    fireInput(input, null, 'deleteContentBackward');
  }
}

/** Scroll a virtual list until the option with `label` is rendered. */
async function revealOption(popup: HTMLElement, label: string): Promise<HTMLElement | null> {
  const find = (): HTMLElement | null => popupOptions(popup).find((o) => o.info.label === label)?.el ?? null;
  const holder = popup.querySelector<HTMLElement>('.rc-virtual-list-holder');
  if (!holder) return find();
  holder.scrollTop = 0;
  for (let guard = 0; guard < 200; guard++) {
    const hit = find();
    if (hit) return hit;
    if (holder.scrollTop + holder.clientHeight >= holder.scrollHeight - 1) return null;
    const before = popupOptions(popup)[0]?.info.label;
    holder.scrollTop += Math.max(holder.clientHeight * 0.8, 32);
    await waitFor(() => popupOptions(popup)[0]?.info.label !== before || null, { timeout: 300, root: popup });
  }
  return null;
}

/** Click the option labelled `label` (typing / scrolling to render it if needed). Multi: skip already-selected ones. */
async function clickLabel(s: Session, label: string): Promise<boolean> {
  const find = (): HTMLElement | null => {
    const popup = popupOf(s);
    return popup ? (popupOptions(popup).find((o) => o.info.label === label)?.el ?? null) : null;
  };
  const doc = s.root.ownerDocument;
  let el = await waitFor(find, { timeout: 300, root: doc, signal: s.ctx.signal });
  if (!el) {
    const input = searchInputOf(s.root);
    if (s.searchable && input) {
      typeInto(input, label);
      el = await waitFor(find, { timeout: Math.min(s.ctx.timeoutMs, 1200), root: doc, signal: s.ctx.signal });
    } else {
      const popup = popupOf(s);
      el = popup ? await revealOption(popup, label) : null;
    }
  }
  if (!el) return false;
  if (s.multiple && el.classList.contains(SELECTED)) return true;
  simulateClick(el);
  return true;
}

/** Multiple select: drop selected tags that are not wanted (exact-set semantics, like the native driver). */
function removeExtras(root: HTMLElement, wanted: string[]): void {
  const keep = new Set(wanted.map(normText));
  for (const item of Array.from(root.querySelectorAll<HTMLElement>('.ant-select-selection-item'))) {
    const label = squash(item.getAttribute('title') ?? item.textContent);
    if (keep.has(normText(label))) continue;
    const remove = item.querySelector<HTMLElement>('.ant-select-selection-item-remove');
    if (remove) simulateClick(remove);
  }
}

const sameItems = (observed: string[], wanted: string[]): boolean => {
  const a = observed.map(normText).sort();
  const b = wanted.map(normText).sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

function matchersOf(intent: FillIntent): { query: string; match: OptionMatcher }[] | null {
  if (intent.kind === 'choice') return [{ query: intent.query, match: intent.match }];
  if (intent.kind === 'multi') return intent.items;
  return null;
}

async function fillSelect(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const root = control.el;
  const wanted = matchersOf(intent);
  if (!wanted || wanted.length === 0) return failed(`unsupported intent for antd select: ${intent.kind}`);
  const multiple = root.classList.contains('ant-select-multiple');
  if (!multiple && wanted.length > 1) return failed('several values for a single-select');

  const popup = await openPopup(root, SELECT_POPUP, ctx);
  if (!popup) return failed('dropdown did not open', readSelection(root));
  const s: Session = { root, ctx, multiple, searchable: root.classList.contains('ant-select-show-search') };

  try {
    // Phase 1: resolve every value first, so a miss or an ambiguity changes nothing (all-or-nothing).
    const labels: string[] = [];
    for (const w of wanted) {
      if (ctx.signal?.aborted) return failed('aborted', readSelection(root));
      const r = await resolveLabel(s, w.query, w.match);
      if ('fail' in r) {
        clearSearch(s);
        return { ...r.fail, observed: readSelection(root) };
      }
      if (!labels.includes(r.label)) labels.push(r.label);
    }
    clearSearch(s);

    // Phase 2: select.
    for (const label of labels) {
      if (ctx.signal?.aborted) return failed('aborted', readSelection(root));
      if (!(await clickLabel(s, label))) return failed(`option "${label}" not clickable`, readSelection(root));
    }
    if (multiple) removeExtras(root, labels);

    const ok = await waitFor(() => sameItems(readSelectionItems(root), labels) || null, {
      timeout: Math.min(ctx.timeoutMs, 800),
      root: root.ownerDocument,
      signal: ctx.signal,
    });
    return ok !== null
      ? { ok: true, observed: readSelection(root) }
      : failed('selection did not stick', readSelection(root));
  } finally {
    clearSearch(s);
    await closePopup(root, popup, ctx);
  }
}

// ------------------------------------------------------------------ cascader

async function fillCascader(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const root = control.el;
  if (intent.kind !== 'cascade' || intent.path.length === 0) {
    return failed(`unsupported intent for antd cascader: ${intent.kind}`);
  }
  const popup = await openPopup(root, CASCADER_POPUP, ctx);
  if (!popup) return failed('dropdown did not open', readSelection(root));
  const doc = root.ownerDocument;
  const clicked: string[] = [];

  try {
    for (let level = 0; level < intent.path.length; level++) {
      if (ctx.signal?.aborted) return failed('aborted', readSelection(root));
      // A leaf click closes the popup: a path longer than the tree (e.g. a district for a 2-level list) ends here.
      if (level > 0 && !root.classList.contains(OPEN_CLASS)) break;
      const ready = await waitCascaderLevelReady(
        popup,
        level,
        { columnSelector: 'ul.ant-cascader-menu', itemSelector: 'li.ant-cascader-menu-item' },
        { timeoutMs: Math.min(ctx.timeoutMs, 1500), ...(ctx.signal ? { signal: ctx.signal } : {}) },
      );
      if (!ready) return failed(`menu column ${level + 1} did not appear`, readSelection(root));
      const opts = ready.options.map(withLabel);
      const m = matchOption(null, intent.path[level]!, infosOf(opts));
      const r = verdict(m, opts);
      if ('fail' in r) return { ...r.fail, observed: readSelection(root) };
      const item = opts[(m as { index: number }).index]!.el;
      simulateClick(item);
      clicked.push(r.label);
      if (level < intent.path.length - 1) {
        await waitFor(
          () =>
            !root.classList.contains(OPEN_CLASS) ||
            popup.querySelectorAll('ul.ant-cascader-menu').length > level + 1 ||
            null,
          { timeout: Math.min(ctx.timeoutMs, 1500), root: doc, signal: ctx.signal },
        );
      }
    }
    const expected = clicked.join(' / ');
    const ok = await waitFor(() => valuesEquivalent(expected, readSelection(root)) || null, {
      timeout: Math.min(ctx.timeoutMs, 800),
      root: doc,
      signal: ctx.signal,
    });
    return ok !== null
      ? { ok: true, observed: readSelection(root) }
      : failed(`cascader value not committed (clicked ${expected})`, readSelection(root));
  } finally {
    await closePopup(root, popup, ctx);
  }
}

// ------------------------------------------------------------------ drivers

async function guarded(run: () => Promise<FillResult>, control: Control): Promise<FillResult> {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), readSelection(control.el));
  }
}

export const antdSelectDriver: Driver = {
  id: 'antd-select',
  lib: 'antd',
  kinds: ['select'],
  match: (c) => c.el.classList.contains('ant-select') && !c.el.classList.contains('ant-cascader'),
  fill: (c, i, ctx) => guarded(() => fillSelect(c, i, ctx), c),
  read: (c) => readSelection(c.el),
};

export const antdCascaderDriver: Driver = {
  id: 'antd-cascader',
  lib: 'antd',
  kinds: ['cascader'],
  match: (c) => c.el.classList.contains('ant-cascader'),
  fill: (c, i, ctx) => guarded(() => fillCascader(c, i, ctx), c),
  read: (c) => readSelection(c.el),
};
