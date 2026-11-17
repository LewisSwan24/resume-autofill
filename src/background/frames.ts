// Frame iteration: list the frames of a tab and ask each one (sequentially) for its fill report.
import { browser } from 'wxt/browser';
import { isFillReport, type FramePart } from './merge';

/** Per-frame budget for `frame:fill` (a big form with many dropdowns can take a while). */
export const FRAME_TIMEOUT_MS = 30_000;

/** Per-frame budget for rame:needs (a scan only; a frame that cannot answer this fast has nothing to fill). */
export const NEEDS_TIMEOUT_MS = 5_000;

export class FrameTimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer within ${ms} ms`);
    this.name = 'FrameTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FrameTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface FrameInfo {
  frameId: number;
  errorOccurred?: boolean;
}

type GetAllFrames = (details: { tabId: number }) => Promise<readonly FrameInfo[] | null | undefined>;

/**
 * Frame ids of a tab: the top frame (0) first, then the others ascending. Frames whose navigation
 * failed are skipped. Falls back to `[0]` when the frame list is unavailable.
 */
export async function listFrameIds(
  tabId: number,
  getAllFrames: GetAllFrames = (d) => browser.webNavigation.getAllFrames(d),
): Promise<number[]> {
  let frames: readonly FrameInfo[] = [];
  try {
    frames = (await getAllFrames({ tabId })) ?? [];
  } catch {
    frames = [];
  }
  const ids = new Set<number>([0]);
  for (const f of frames) if (!f.errorOccurred && Number.isInteger(f.frameId) && f.frameId >= 0) ids.add(f.frameId);
  return [...ids].sort((a, b) => a - b);
}

export interface CollectOptions<P = undefined> {
  /** Budget of send per frame. Default FRAME_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Runs first for every frame, with its own budget (prepareTimeoutMs, default NEEDS_TIMEOUT_MS).
   * Resolve 
ull to skip the frame without calling send; a rejection or timeout skips it too.
   * Whatever it resolves is handed to send.
   */
  prepare?: (frameId: number) => Promise<P | null>;
  prepareTimeoutMs?: number;
  /** Called for every frame that was skipped (no content script, timeout, malformed answer, nothing to do). */
  onSkip?: (frameId: number, reason: unknown) => void;
}

/** onSkip reason of a frame whose prepare resolved 
ull (it has nothing to fill). */
export const NOTHING_TO_FILL = 'nothing_to_fill';

/**
 * Ask frames one after another (never in parallel: fills drive real UI and may move focus).
 * A frame that rejects (no content script), times out, is skipped by prepare or answers with something
 * that is not a report is skipped; the others still count. Result order follows rameIds.
 */
export async function collectFrames<P, R>(
  frameIds: readonly number[],
  send: (frameId: number, prepared: P) => Promise<unknown>,
  validate: (x: unknown) => x is R,
  opts: CollectOptions<P> = {},
): Promise<Array<{ frameId: number; result: R }>> {
  const timeoutMs = opts.timeoutMs ?? FRAME_TIMEOUT_MS;
  const parts: Array<{ frameId: number; result: R }> = [];
  for (const frameId of frameIds) {
    try {
      let prepared = undefined as P;
      if (opts.prepare) {
        const prepare = opts.prepare;
        const answer = await withTimeout(
          Promise.resolve().then(() => prepare(frameId)),
          opts.prepareTimeoutMs ?? NEEDS_TIMEOUT_MS,
        );
        if (answer === null) {
          opts.onSkip?.(frameId, NOTHING_TO_FILL);
          continue;
        }
        prepared = answer;
      }
      const answer = await withTimeout(Promise.resolve().then(() => send(frameId, prepared)), timeoutMs);
      if (!validate(answer)) throw new Error('Malformed frame response');
      parts.push({ frameId, result: answer });
    } catch (error) {
      opts.onSkip?.(frameId, error);
    }
  }
  return parts;
}

export async function collectFrameReports<P = undefined>(
  frameIds: readonly number[],
  send: (frameId: number, prepared: P) => Promise<unknown>,
  opts: CollectOptions<P> = {},
): Promise<FramePart[]> {
  const parts = await collectFrames<P, FramePart['report']>(
    frameIds,
    send,
    isFillReport,
    opts,
  );
  return parts.map(({ frameId, result }) => ({ frameId, report: result }));
}