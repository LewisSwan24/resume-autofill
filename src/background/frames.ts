// Frame iteration: list the frames of a tab and ask each one (sequentially) for its fill report.
import { browser } from 'wxt/browser';
import { isFillReport, type FramePart } from './merge';

/** Per-frame budget for `frame:fill` (a big form with many dropdowns can take a while). */
export const FRAME_TIMEOUT_MS = 30_000;

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

export interface CollectOptions {
  /** Default `FRAME_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Called for every frame that was skipped (no content script, timeout, malformed answer). */
  onSkip?: (frameId: number, reason: unknown) => void;
}

/**
 * Ask frames one after another (never in parallel: fills drive real UI and may move focus).
 * A frame that rejects (no content script), times out or answers with something that is not a
 * report is skipped; the others still count. Result order follows `frameIds`.
 */
export async function collectFrameReports(
  frameIds: readonly number[],
  send: (frameId: number) => Promise<unknown>,
  opts: CollectOptions = {},
): Promise<FramePart[]> {
  const timeoutMs = opts.timeoutMs ?? FRAME_TIMEOUT_MS;
  const parts: FramePart[] = [];
  for (const frameId of frameIds) {
    try {
      const answer = await withTimeout(Promise.resolve().then(() => send(frameId)), timeoutMs);
      if (!isFillReport(answer)) throw new Error('Malformed frame report');
      parts.push({ frameId, report: answer });
    } catch (error) {
      opts.onSkip?.(frameId, error);
    }
  }
  return parts;
}
