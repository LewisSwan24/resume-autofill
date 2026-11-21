// The session's frame registry: which frames of the current document checked in, and the inbound checks of every
// page message (in order). Pure state in, state out; plus a small book of outstanding requests so a reply
// is accepted only from the frame it was asked of, once.
import type { NativeEvents } from '../native';
import {
  MAX_FRAMES,
  decodePageMessage,
  isIncompatibleHello,
  type PageMessage,
  type PageMessageOf,
} from '../../../../bridge/protocol';

export interface FrameEntry {
  frame: number;
  origin: string;
  main: boolean;
  /** Fillable fields of the last scan. */
  count: number;
  /** Child frames the page expects to check in. */
  iframes: number;
  /** Spoke another protocol version: there, but unusable. */
  incompatible: boolean;
  /** At least one scan arrived. */
  scanned: boolean;
  /** Main frame: the step the page names (step bar title or adapter signature); null or absent when none. */
  step?: string | null;
}

export interface FramesState {
  generation: number;
  frames: FrameEntry[];
}

export interface Checked {
  state: FramesState;
  /** The accepted message; null when it was dropped (or only changed the registry, e.g. an incompatible hello). */
  message: PageMessage | null;
  frame: FrameEntry | null;
}

export const initialFrames = (generation = 0): FramesState => ({ generation, frames: [] });

export const newGeneration = (_state: FramesState, generation: number): FramesState => ({ generation, frames: [] });

/** Only http(s) origins can talk to the app; opaque (`null`), file, about, content... are dropped. */
export function isWebOrigin(origin: string): boolean {
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    const { protocol, host } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') && host !== '';
  } catch {
    return false;
  }
}

export function removeFrame(state: FramesState, frame: number, generation: number): FramesState {
  if (generation !== state.generation || !state.frames.some((f) => f.frame === frame)) return state;
  return { ...state, frames: state.frames.filter((f) => f.frame !== frame) };
}

const drop = (state: FramesState): Checked => ({ state, message: null, frame: null });

export function checkInbound(state: FramesState, e: NativeEvents['message']): Checked {
  // 1. stale generation
  if (e.generation !== state.generation) return drop(state);
  // 2. origin
  if (!isWebOrigin(e.origin)) return drop(state);
  const known = state.frames.find((f) => f.frame === e.frame) ?? null;
  // 3. shape and version
  const message = decodePageMessage(e.data);
  if (!message) {
    const room = !known && state.frames.length < MAX_FRAMES && !(e.main && state.frames.some((f) => f.main));
    if (room && isIncompatibleHello(e.data)) {
      const entry: FrameEntry = { frame: e.frame, origin: e.origin, main: e.main, count: 0, iframes: 0, incompatible: true, scanned: false };
      return { state: { ...state, frames: [...state.frames, entry] }, message: null, frame: entry };
    }
    return drop(state);
  }
  // 4. hello
  if (message.kind === 'hello') {
    if (known || state.frames.length >= MAX_FRAMES) return drop(state);
    if (e.main && state.frames.some((f) => f.main)) return drop(state);
    const entry: FrameEntry = { frame: e.frame, origin: e.origin, main: e.main, count: 0, iframes: message.iframes, incompatible: false, scanned: false };
    return { state: { ...state, frames: [...state.frames, entry] }, message, frame: entry };
  }
  // 5. everything else only from a registered, compatible frame with the same origin and main flag
  if (!known || known.incompatible || known.origin !== e.origin || known.main !== e.main) return drop(state);
  // 7. obstacles and steps only from the main frame
  if ((message.kind === 'obstacles' || message.kind === 'step' || message.kind === 'pressed') && !known.main) return drop(state);

  if (message.kind === 'scan') {
    const step = message.step ?? null;
    if (known.scanned && known.count === message.count && known.iframes === message.iframes && (known.step ?? null) === step) {
      return { state, message, frame: known };
    }
    const entry = { ...known, count: message.count, iframes: message.iframes, scanned: true, step };
    return { state: { ...state, frames: state.frames.map((f) => (f === known ? entry : f)) }, message, frame: entry };
  }
  if (message.kind === 'bye') {
    return { state: { ...state, frames: state.frames.filter((f) => f !== known) }, message, frame: known };
  }
  // 6. replies are matched against outstanding requests by the caller (createReplyBook)
  return { state, message, frame: known };
}

/** Embedded frames that should have checked in but did not (or cannot talk). Never negative. */
export function unreachableCount(state: FramesState): number {
  const live = state.frames.filter((f) => !f.incompatible);
  const expected = live.reduce((sum, f) => sum + f.iframes, 0);
  const checkedIn = live.filter((f) => !f.main).length;
  const incompatible = state.frames.filter((f) => f.incompatible).length;
  return Math.max(0, expected - checkedIn, incompatible);
}

// ---------------------------------------------------------------- outstanding requests

export type RequestKind = 'needs' | 'fill' | 'focus' | 'undo' | 'step' | 'press';
type Reply = PageMessageOf<'needs' | 'report' | 'focused' | 'undone' | 'error' | 'step' | 'pressed'>;

const ANSWERS: Readonly<Record<RequestKind, readonly Reply['kind'][]>> = {
  needs: ['needs', 'error'],
  fill: ['report', 'error'],
  focus: ['focused', 'error'],
  undo: ['undone', 'error'],
  step: ['step'],
  press: ['pressed'],
};

export interface ReplyBook {
  /** Wait for the answer of frame to reqId; resolves null when cancelled. */
  wait(frame: number, reqId: string, kind: RequestKind): Promise<Reply | null>;
  /** Offer a decoded message from frame; true when it answered an outstanding request (each is answered once). */
  settle(frame: number, message: PageMessage): boolean;
  /** Forget one request (timed out). */
  forget(reqId: string): void;
  /** Resolve every outstanding request with null (navigation, dispose). */
  cancelAll(): void;
  size(): number;
}

export function createReplyBook(): ReplyBook {
  const open = new Map<string, { frame: number; kind: RequestKind; resolve: (r: Reply | null) => void }>();
  return {
    wait(frame, reqId, kind) {
      return new Promise((resolve) => {
        open.get(reqId)?.resolve(null);
        open.set(reqId, { frame, kind, resolve });
      });
    },
    settle(frame, message) {
      if (!('reqId' in message)) return false;
      const entry = open.get(message.reqId);
      if (!entry || entry.frame !== frame) return false;
      if (!(ANSWERS[entry.kind] as readonly string[]).includes(message.kind)) return false;
      open.delete(message.reqId);
      entry.resolve(message as Reply);
      return true;
    },
    forget(reqId) {
      open.get(reqId)?.resolve(null);
      open.delete(reqId);
    },
    cancelAll() {
      const all = [...open.values()];
      open.clear();
      for (const e of all) e.resolve(null);
    },
    size: () => open.size,
  };
}
