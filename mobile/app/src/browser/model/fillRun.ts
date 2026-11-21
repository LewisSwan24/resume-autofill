// One fill run: ask every checked-in frame what it needs, plan, maybe ask before a very large hand-over,
// fill frame by frame (main first), merge the reports. One tap = one run; nothing the page sends can start one.
// Undo of the last run lives here too. The session owns the frames, the reply book and the native plugin; this module
// only drives them through RunContext.
import { mergeFrameReports, type FramePart } from '../../../../../src/background/merge';
import type { FileData } from '../../../../../src/drivers/types';
import type { FrameNeeds } from '../../../../../src/engine/fieldDeps';
import type { FieldReport, FillReport } from '../../../../../src/engine/types';
import { countOutcomes } from '../../../../../src/fill/report';
import type { Resume } from '../../../../../src/schema/resume';
import type { SensitiveFieldMode } from '../../../../../src/schema/sensitive';
import { encode, PROTOCOL_VERSION, type AppCommandInput } from '../../../../bridge/protocol';
import type { FileInfo } from '../../store/fileStore';
import { LARGE_NEEDS } from './constants';
import { ownSite, siteHost } from './frameSites';
import type { FrameEntry, ReplyBook, RequestKind } from './frames';
import { buildResumeSubset } from '../../../../../src/background/subset';
import { countLeaves, handedOver, planFrames, type HandedOver } from './fillPlan';
import { withTimeout } from './withTimeout';

/** Row keys `${frame}:${fieldId}`. */
export interface UndoResult {
  restored: string[];
  manual: string[];
  addedCards: number;
}

export type RunState =
  | { phase: 'idle' }
  | { phase: 'asking'; runId: string }
  | { phase: 'confirmLarge'; runId: string; leaves: number }
  /** Frames of other sites asked for data: the person decides before anything is sent. */
  | { phase: 'confirmSites'; runId: string; hosts: string[] }
  | { phase: 'filling'; runId: string; index: number; total: number }
  | {
      phase: 'done';
      runId: string;
      report: FillReport;
      /** Frames that received a fill (undo goes to exactly these). */
      frames: number[];
      handedOver: HandedOver;
      countAtFill: number;
      framesAtFill: number;
      undo: UndoResult | null;
      /** Frames that got the payload but sent no report (timed out or the report was dropped): they may have changed. */
      unanswered: number;
      /** The fill language had no resume of its own. */
      fallback: boolean;
      /** Filled with the made-up sample resume. */
      sample: boolean;
    }
  | { phase: 'failed'; code: 'no_resume' | 'no_frames' | 'failed' };

export const isRunActive = (run: RunState): boolean =>
  run.phase === 'asking' || run.phase === 'confirmLarge' || run.phase === 'confirmSites' || run.phase === 'filling';

export const rowKey = (frame: number, fieldId: string): string => `${frame}:${fieldId}`;

export interface RunContext {
  generation(): number;
  /** Compatible frames of the current generation. */
  frames(): readonly FrameEntry[];
  post(frame: number, generation: number, data: string): Promise<boolean>;
  book: ReplyBook;
  newId(): string;
  timeouts: { needs: number; fill: number; undo: number };
  /** File data for the page, or null when missing, unreadable or too big. */
  loadFile(id: string): Promise<{ info: FileInfo; data: FileData } | null>;
  getRun(): RunState;
  setRun(run: RunState): void;
  /** Resolves true to go on with a large hand-over. */
  confirmLarge(leaves: number): Promise<boolean>;
  /** Resolves true to fill the frames of these other sites too; false fills only the page's own site. */
  confirmSites(hosts: string[]): Promise<boolean>;
}

/** Main frame first, then by frame key. */
export const fillOrder = (frames: readonly FrameEntry[]): FrameEntry[] =>
  [...frames].filter((f) => !f.incompatible).sort((a, b) => Number(b.main) - Number(a.main) || a.frame - b.frame);

/** Send one command and wait for its answer; null on no delivery, timeout, cancellation. */
export async function askFrame(
  ctx: Pick<RunContext, 'newId' | 'book' | 'post'>,
  frame: number,
  generation: number,
  kind: RequestKind,
  command: (reqId: string) => AppCommandInput,
  ms: number,
) {
  const reqId = ctx.newId();
  const answer = ctx.book.wait(frame, reqId, kind);
  let delivered = false;
  try {
    delivered = await ctx.post(frame, generation, encode(command(reqId)));
  } catch {
    delivered = false;
  }
  if (!delivered) {
    ctx.book.forget(reqId);
    return null;
  }
  try {
    return await withTimeout(answer, ms);
  } catch {
    ctx.book.forget(reqId);
    return null;
  }
}

const v = PROTOCOL_VERSION as 1;

/** Runs to the end (done, failed or idle after a refused large hand-over). Never throws. */
export async function executeRun(
  ctx: RunContext,
  pick: { resume: Resume; sample: boolean; fallback: boolean; sensitiveFields?: SensitiveFieldMode },
): Promise<void> {
  const sensitive = pick.sensitiveFields === 'fill' ? { sensitiveFields: 'fill' as const } : {};
  const runId = ctx.newId();
  const generation = ctx.generation();
  const alive = () => {
    const run = ctx.getRun();
    return ctx.generation() === generation && 'runId' in run && run.runId === runId && isRunActive(run);
  };
  ctx.setRun({ phase: 'asking', runId });

  const frames = fillOrder(ctx.frames());
  if (frames.length === 0) {
    ctx.setRun({ phase: 'failed', code: 'no_frames' });
    return;
  }

  // 1. needs, in parallel
  const answers = await Promise.all(
    frames.map((f) => askFrame(ctx, f.frame, generation, 'needs', (reqId) => ({ v, kind: 'needs', reqId }), ctx.timeouts.needs)),
  );
  if (!alive()) return;
  const needsByFrame = new Map<number, FrameNeeds>();
  frames.forEach((f, i) => {
    const a = answers[i];
    if (a?.kind === 'needs') needsByFrame.set(f.frame, a.needs);
  });
  let plans = planFrames(pick.resume, needsByFrame, sensitive);
  if (plans.length === 0) {
    ctx.setRun({ phase: 'failed', code: 'no_frames' });
    return;
  }

  // 2. frames of another site than the page get data only when the person says so by name
  const originOf = new Map(frames.map((f) => [f.frame, f.origin]));
  const mainOf = new Map(frames.map((f) => [f.frame, f.main]));
  const mainOrigin = frames.find((f) => f.main)?.origin ?? '';
  const isOther = (frame: number) => !ownSite(mainOrigin, originOf.get(frame) ?? '');
  const hostsOf = (list: typeof plans) => [...new Set(list.filter((p) => isOther(p.frame)).map((p) => siteHost(originOf.get(p.frame) ?? '')))];
  const otherHosts = hostsOf(plans);
  if (otherHosts.length > 0) {
    ctx.setRun({ phase: 'confirmSites', runId, hosts: otherHosts });
    const go = await ctx.confirmSites(otherHosts);
    if (!alive()) return;
    if (!go) {
      plans = plans.filter((p) => !isOther(p.frame));
      if (plans.length === 0) {
        ctx.setRun({ phase: 'idle' });
        return;
      }
    }
  }

  // 3. a very large hand-over waits for the person
  const leaves = countLeaves(plans.map((p) => p.needs), pick.resume);
  if (leaves > LARGE_NEEDS) {
    ctx.setRun({ phase: 'confirmLarge', runId, leaves });
    const go = await ctx.confirmLarge(leaves);
    if (!alive()) return;
    if (!go) {
      ctx.setRun({ phase: 'idle' });
      return;
    }
  }

  // 4. fill, one frame at a time
  const parts: FramePart[] = [];
  const filled: number[] = [];
  const sentPlans: typeof plans = [];
  const fileInfos: Record<string, FileInfo> = {};
  let mainUrl: string | null = null;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!;
    ctx.setRun({ phase: 'filling', runId, index: i + 1, total: plans.length });
    const files: Record<string, FileData> = {};
    for (const id of plan.fileIds) {
      const loaded = await ctx.loadFile(id).catch(() => null);
      if (loaded) {
        files[id] = loaded.data;
        fileInfos[id] = loaded.info;
      }
    }
    if (!alive()) return;
    // The decision above was about the frame's origin then. A frame that left (bye) or came back as another document
    // since gets nothing; the page side also refuses a fill whose origin is not its own (it may not have said bye).
    const origin = originOf.get(plan.frame) ?? '';
    const now = ctx.frames().find((f) => f.frame === plan.frame);
    if (!now || now.origin !== origin || now.main !== mainOf.get(plan.frame)) continue;
    const answer = await askFrame(
      ctx,
      plan.frame,
      generation,
      'fill',
      (reqId) => ({ v, kind: 'fill', reqId, runId, origin, resume: plan.resume, files, ...sensitive }),
      ctx.timeouts.fill,
    );
    if (!alive()) return;
    if (answer?.kind === 'error' && answer.code === 'wrong_origin') continue;
    // A frame that got the payload may have changed, even when it timed out: undo goes there too.
    filled.push(plan.frame);
    sentPlans.push(plan);
    if (answer?.kind === 'report' && answer.runId === runId) {
      parts.push({ frameId: plan.frame, report: answer.report as FillReport });
      if (frames.find((f) => f.frame === plan.frame)?.main) mainUrl = answer.report.url;
    }
  }

  // No frame took the payload: nothing on the page changed.
  if (filled.length === 0) {
    ctx.setRun({ phase: 'failed', code: 'failed' });
    return;
  }
  const merged = mergeFrameReports(parts);
  const report: FillReport = mainUrl === null ? merged : { ...merged, url: mainUrl };
  const live = ctx.frames().filter((f) => !f.incompatible);
  ctx.setRun({
    phase: 'done',
    runId,
    report,
    frames: filled,
    handedOver: { ...handedOver(pick.resume, sentPlans, fileInfos), otherSites: hostsOf(sentPlans) },
    countAtFill: live.reduce((sum, f) => sum + f.count, 0),
    framesAtFill: live.length,
    undo: null,
    unanswered: filled.length - parts.length,
    fallback: pick.fallback,
    sample: pick.sample,
  });
}

/**
 * 「这次填上」: write one sensitive field the settings held back, this once, and update its row in the run's report.
 * Only the id number leaves the app, to the frame that reported the row, and only while it is still that document.
 */
export async function executeFillOne(ctx: RunContext, rowKeyOf: string, resume: Resume): Promise<'ok' | 'gone' | 'failed'> {
  const run = ctx.getRun();
  if (run.phase !== 'done' || run.undo) return 'gone';
  const colon = rowKeyOf.indexOf(':');
  const frame = Number(rowKeyOf.slice(0, colon));
  const fieldId = rowKeyOf.slice(colon + 1);
  const row = run.report.fields.find((f) => (f.frameId ?? 0) === frame && f.fieldId === fieldId);
  const live = ctx.frames().find((f) => f.frame === frame);
  if (colon < 0 || !row || row.note !== 'sensitive_held' || !live) return 'gone';
  const generation = ctx.generation();
  const subset = buildResumeSubset(resume, { fieldKeys: ['basics.idNumber'], repeatSections: [], attachmentKeys: [] }, { sensitiveFields: 'fill' });
  const answer = await askFrame(
    ctx,
    frame,
    generation,
    'fill',
    (reqId) => ({ v, kind: 'fill', reqId, runId: run.runId, origin: live.origin, resume: subset, files: {}, sensitiveFields: 'fill', only: [fieldId] }),
    ctx.timeouts.fill,
  );
  const now = ctx.getRun();
  if (ctx.generation() !== generation || now.phase !== 'done' || now.runId !== run.runId) return 'gone';
  const updated = answer?.kind === 'report' ? answer.report.fields.find((f) => f.fieldId === fieldId) : undefined;
  if (!updated) return answer?.kind === 'error' && answer.code === 'wrong_origin' ? 'gone' : 'failed';
  const fields = now.report.fields.map((f): FieldReport => (f === row || ((f.frameId ?? 0) === frame && f.fieldId === fieldId) ? { ...(updated as FieldReport), frameId: frame } : f));
  ctx.setRun({ ...now, report: { ...now.report, fields, counts: countOutcomes(fields) } });
  return 'ok';
}

/** One undo per run at a time: a second tap while the first is on its way waits for that one instead of sending again. */
const undoInFlight = new WeakMap<RunContext, { runId: string; result: Promise<UndoResult | null> }>();

/** Undo the last run in every frame that received a fill; rows of frames that did not answer count as manual. */
export function executeUndo(ctx: RunContext): Promise<UndoResult | null> {
  const run = ctx.getRun();
  if (run.phase !== 'done' || run.undo) return Promise.resolve(null);
  const busy = undoInFlight.get(ctx);
  if (busy && busy.runId === run.runId) return busy.result;
  const result = undoOnce(ctx, run).finally(() => {
    if (undoInFlight.get(ctx)?.result === result) undoInFlight.delete(ctx);
  });
  undoInFlight.set(ctx, { runId: run.runId, result });
  return result;
}

async function undoOnce(ctx: RunContext, run: Extract<RunState, { phase: 'done' }>): Promise<UndoResult | null> {
  const generation = ctx.generation();
  const live = new Set(ctx.frames().map((f) => f.frame));
  const answers = await Promise.all(
    run.frames.map((frame) =>
      live.has(frame)
        ? askFrame(ctx, frame, generation, 'undo', (reqId) => ({ v, kind: 'undo', reqId, runId: run.runId }), ctx.timeouts.undo)
        : Promise.resolve(null),
    ),
  );
  const restored: string[] = [];
  const manual: string[] = [];
  let addedCards = 0;
  run.frames.forEach((frame, i) => {
    const a = answers[i];
    if (a?.kind === 'undone') {
      for (const id of a.restored) restored.push(rowKey(frame, id));
      for (const id of a.manual) manual.push(rowKey(frame, id));
      addedCards += a.addedCards;
    } else {
      for (const f of run.report.fields) {
        if ((f.frameId ?? 0) === frame && (f.outcome === 'filled' || (f.outcome === 'needs_review' && f.value))) manual.push(rowKey(frame, f.fieldId));
      }
    }
  });
  // Highlights go everywhere, not only where the fill went.
  for (const frame of live) {
    if (!run.frames.includes(frame)) void ctx.post(frame, generation, encode({ v, kind: 'clear' })).catch(() => false);
  }
  const result: UndoResult = { restored, manual, addedCards };
  const now = ctx.getRun();
  // An undo that already landed is the real answer: never replace it.
  if (now.phase === 'done' && now.runId === run.runId && !now.undo && ctx.generation() === generation) ctx.setRun({ ...now, undo: result });
  return result;
}
