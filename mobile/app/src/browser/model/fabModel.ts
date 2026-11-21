// What the 「一键填写」 FAB says and does. Pure; returns i18n keys and params, never display text.
import type { FabIcon } from '../native';
import type { FrameEntry } from './frames';
import { isRunActive, type RunState } from './fillRun';
import { groupOfOutcome } from './reportModel';

export type FabState = 'scanning' | 'ready' | 'none' | 'filling' | 'done' | 'more' | 'unavailable' | 'missing';
export type EngineState = 'waiting' | 'ready' | 'missing' | 'unsupported';
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}
/** What a tap does: run a fill, open the report, or explain why filling is not possible. */
export type FabTap = 'fill' | 'report' | 'explainUnsupported' | 'explainMissing';

export interface FabView {
  state: FabState;
  icon: FabIcon;
  text: Msg;
  subtext: Msg | null;
  /** Parts of the accessible name, joined with joinA11y after translation. */
  a11y: Msg[];
  tap: FabTap;
}

export interface FabInput {
  engine: EngineState;
  frames: readonly FrameEntry[];
  run: RunState;
  /** Within HELLO_TIMEOUT_MS after the page finished loading. */
  settling: boolean;
}

const view = (state: FabState, icon: FabIcon, text: Msg, subtext: Msg | null, tap: FabTap, a11y?: Msg[]): FabView => ({
  state,
  icon,
  text,
  subtext,
  a11y: a11y ?? (subtext ? [text, subtext] : [text]),
  tap,
});

const AUTOFILL: Msg = { key: 'fab.autofill' };

/** null: hidden (the top frame has not checked in yet). */
export function fabModel(input: FabInput): FabView | null {
  if (input.engine === 'unsupported') return view('unavailable', 'warning', { key: 'm.br.fab.unavailable' }, null, 'explainUnsupported');
  if (input.engine === 'missing') return view('missing', 'warning', { key: 'm.br.fab.missing' }, null, 'explainMissing');
  const live = input.frames.filter((f) => !f.incompatible);
  if (!live.some((f) => f.main)) return null;
  const run = input.run;

  if (isRunActive(run)) {
    const sub = run.phase === 'filling' && run.total > 1 ? { key: 'm.br.fab.part', params: { i: run.index, total: run.total } } : null;
    return view('filling', 'busy', { key: 'fab.filling' }, sub, 'fill');
  }

  const count = live.reduce((sum, f) => sum + f.count, 0);
  const ready = () =>
    view('ready', 'magic', AUTOFILL, { key: 'm.br.fab.count', params: { n: count } }, 'fill', [{ key: 'm.br.fab.a11y', params: { n: count } }]);
  // After undo the values are gone from the page: offer the fill again; the report stays on the toolbar.
  if (run.phase === 'done' && !run.undo) {
    // A multi-page form moved on without loading a new page: the next step may hold fewer fields than the last.
    const step = live.find((f) => f.main)?.step ?? null;
    if (count > 0 && step && run.stepAtFill && step !== run.stepAtFill) return ready();
    const grown = count - run.countAtFill;
    if (grown > 0 || live.length > run.framesAtFill) {
      const n = Math.max(0, grown);
      return view('more', 'magic', { key: 'm.br.fab.more' }, n > 0 ? { key: 'm.br.fab.moreSub', params: { n } } : null, 'fill');
    }
    const filled = run.report.fields.filter((f) => f.outcome === 'filled').length;
    const review = run.report.fields.filter((f) => groupOfOutcome(f.outcome) === 'attention').length;
    return view('done', 'report', { key: 'm.br.fab.report' }, { key: 'm.br.fab.reportSub', params: { filled, review } }, 'report');
  }

  if (count > 0) return ready();
  if (input.settling || !live.some((f) => f.scanned)) return view('scanning', 'magic', AUTOFILL, { key: 'm.br.fab.scanning' }, 'fill');
  return view('none', 'magic', AUTOFILL, { key: 'm.br.fab.none' }, 'fill');
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** One accessible name from translated parts: 「一键填写，正在识别表单」 / "Fill in one tap, Looking for the form". */
export function joinA11y(parts: readonly string[]): string {
  const clean = parts.filter((p) => p);
  return clean.join(clean.some((p) => CJK.test(p)) ? '，' : ', ');
}
