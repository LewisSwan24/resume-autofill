// Fixed-point bounded virtual-scroll dropdown explorer (antd rc-virtual-list / Element Plus scrollbar / ARIA listboxes).
import { visibleOptions, type DropdownOption } from './dropdown';
import type { OptionMatcher } from './types';
import { waitFor } from './wait';

export const MAX_VIRTUAL_SCROLL_STEPS = 25;
const DEFAULT_SCROLL_SETTLE_MS = 180;

export interface VirtualScrollOptions {
  /** Container that scrolls (`holder`, `.el-select-dropdown__wrap`, `.el-scrollbar__wrap`). */
  scrollContainerSelector?: string;
  /** Selector for rendered option nodes inside `popup`. */
  optionSelector: string;
  /** Optional custom label reader for option nodes (e.g. antd `title` attribute). */
  mapOption?: (opt: DropdownOption) => DropdownOption;
  maxSteps?: number;
  settleMs?: number;
  signal?: AbortSignal;
}

export interface VirtualScrollResult {
  options: DropdownOption[];
  stepsUsed: number;
  stoppedByFixedPoint: boolean;
}

const optionSig = (opts: readonly DropdownOption[]): string =>
  opts.map((o) => o.info.label).join('\u0000');

function findScrollContainer(popup: HTMLElement, selector?: string): HTMLElement {
  if (selector) {
    const found = popup.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return (
    popup.querySelector<HTMLElement>(
      '.rc-virtual-list-holder, .el-select-dropdown__wrap, .el-scrollbar__wrap, [role="listbox"]',
    ) ?? popup
  );
}

/**
 * Stepwise-scroll a virtualized dropdown container until either:
 * 1) `matcher` hits unambiguously, OR
 * 2) bottom is reached, OR
 * 3) fixed point is detected (2 consecutive scroll steps yield identical `scrollTop` & rendered option signature), OR
 * 4) `MAX_VIRTUAL_SCROLL_STEPS` (25) is reached.
 */
export async function scrollVirtualDropdown(
  popup: HTMLElement,
  matcher: OptionMatcher | null,
  opts: VirtualScrollOptions,
): Promise<VirtualScrollResult> {
  const mapOpt = opts.mapOption ?? ((o: DropdownOption) => o);
  const readVisible = () => visibleOptions(popup, opts.optionSelector).map(mapOpt);
  const holder = findScrollContainer(popup, opts.scrollContainerSelector);
  const maxSteps = Math.max(1, Math.min(opts.maxSteps ?? MAX_VIRTUAL_SCROLL_STEPS, MAX_VIRTUAL_SCROLL_STEPS));
  const settleMs = opts.settleMs ?? DEFAULT_SCROLL_SETTLE_MS;

  const collected = new Map<string, DropdownOption>();
  const recordAll = (list: readonly DropdownOption[]) => {
    for (const o of list) {
      if (!collected.has(o.info.label)) collected.set(o.info.label, o);
    }
  };

  let current = readVisible();
  recordAll(current);

  if (matcher) {
    const initialHit = matcher(current.map((o) => o.info));
    if (initialHit.status === 'matched') {
      return { options: Array.from(collected.values()), stepsUsed: 0, stoppedByFixedPoint: false };
    }
  }

  // Not actually scrollable (or all items fit in viewport): exit cleanly right away.
  if (holder.scrollHeight <= holder.clientHeight + 1 && maxSteps > 0) {
    // Still allow virtual lists with synthetic scrollHeight=0 in jsdom mocks ONLY if clientHeight > 0 triggers change;
    // when clientHeight === 0 (e.g. non-scrolling small fixture), return without spinning.
    if (holder.clientHeight <= 0 && holder.scrollHeight <= 0) {
      return { options: Array.from(collected.values()), stepsUsed: 0, stoppedByFixedPoint: true };
    }
  }

  holder.scrollTop = 0;
  holder.dispatchEvent(new Event('scroll', { bubbles: false }));

  let stepsUsed = 0;
  let lastSig = optionSig(current);
  let lastScrollTop = holder.scrollTop;
  let unchangedStreak = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) break;
    const atEnd = holder.scrollHeight > 0 && holder.scrollTop + holder.clientHeight >= holder.scrollHeight - 1;
    if (atEnd && step > 0) break;

    const delta = Math.max(holder.clientHeight * 0.8, 120);
    holder.scrollTop = lastScrollTop + delta;
    holder.dispatchEvent(new Event('scroll', { bubbles: false }));
    stepsUsed++;

    await waitFor(
      () => {
        const nextList = readVisible();
        const nextSig = optionSig(nextList);
        return nextSig !== lastSig ? true : null;
      },
      { timeout: settleMs, root: popup, ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    current = readVisible();
    recordAll(current);

    if (matcher) {
      const m = matcher(Array.from(collected.values()).map((o) => o.info));
      if (m.status === 'matched') {
        return { options: Array.from(collected.values()), stepsUsed, stoppedByFixedPoint: false };
      }
    }

    const nextSig = optionSig(current);
    const nextScrollTop = holder.scrollTop;
    if (nextSig === lastSig && nextScrollTop === lastScrollTop) {
      unchangedStreak++;
      if (unchangedStreak >= 1) {
        return { options: Array.from(collected.values()), stepsUsed, stoppedByFixedPoint: true };
      }
    } else {
      unchangedStreak = 0;
    }
    lastSig = nextSig;
    lastScrollTop = nextScrollTop;
  }

  return { options: Array.from(collected.values()), stepsUsed, stoppedByFixedPoint: false };
}
