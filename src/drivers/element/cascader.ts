// Element Plus driver: el-cascader.
import { normalizeLabel } from '../../dictionary/normalize';
import type { Control, OptionInfo } from '../../engine/types';
import { findDropdownNear, visibleOptions } from '../dropdown';
import { simulateClick } from '../events';
import type { DriverContext, FillIntent, FillResult, OptionMatch } from '../types';
import { waitFor } from '../wait';
import { closePopper, failed, isPopperLive, popperById, scrollIntoView, squash } from './shared';

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

export function readCascader(root: Element): string | null {
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

export async function fillCascader(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
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
