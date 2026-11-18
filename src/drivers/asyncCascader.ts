// Async multi-column Cascader level synchronization (bounded 1200ms per hop MutationObserver wait).
import { visibleOptions, type DropdownOption } from './dropdown';
import { waitFor } from './wait';

export const ASYNC_CASCADER_LEVEL_MS = 1200;
const LOADING_NODE_RE = /^(?:loading|加载中|请稍候|\.\.\.)$/i;

export interface CascaderColumnSpec {
  columnSelector: string;
  itemSelector: string;
  loadingSelector?: string;
}

/**
 * Wait for a lazy-loaded Cascader column (`levelIndex`) to finish async population with at least one
 * non-loading option node (capped cleanly at `timeoutMs`, default 1200ms).
 */
export async function waitCascaderLevelReady(
  popup: HTMLElement,
  levelIndex: number,
  spec: CascaderColumnSpec,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ column: HTMLElement; options: DropdownOption[] } | null> {
  const timeout = Math.min(opts.timeoutMs ?? ASYNC_CASCADER_LEVEL_MS, ASYNC_CASCADER_LEVEL_MS);
  const hit = await waitFor(
    () => {
      const cols = popup.querySelectorAll<HTMLElement>(spec.columnSelector);
      const col = cols[levelIndex];
      if (!col) return null;
      if (spec.loadingSelector && col.querySelector(spec.loadingSelector)) return null;
      const items = visibleOptions(col, spec.itemSelector).filter(
        (o) => !LOADING_NODE_RE.test(o.info.label.trim()),
      );
      return items.length > 0 ? { column: col, options: items } : null;
    },
    { timeout, root: popup, ...(opts.signal ? { signal: opts.signal } : {}) },
  );
  return hit;
}
