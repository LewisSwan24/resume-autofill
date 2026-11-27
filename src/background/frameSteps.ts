// What a tab shows, from what each of its frames says it shows. A form's step may sit in a frame: a careers page
// that embeds its ATS, a form drawn in an iframe. The rules are the ones a single page follows (src/fill/nextStep.ts),
// across frames: one Next and nothing that sends, or the run stops for the user.
import type { StepState } from './autoAdvance';

export interface FrameStep {
  frameId: number;
  state: StepState;
}

const NO_FIELDS = /^fields:0:/;

/**
 * The tab's state, and the frame to press Next in (null when nothing may be pressed). Null until the top frame has
 * answered: the tab's address and the site it is on are the top frame's.
 */
export function mergeStepStates(frames: FrameStep[]): { state: StepState; pressIn: number | null } | null {
  const top = frames.find((f) => f.frameId === 0)?.state;
  if (!top) return null;

  // Frames that show fields tell one step from the next; an ad or a widget with none coming and going does not.
  const showing = frames.filter((f) => !NO_FIELDS.test(f.state.fingerprint)).sort((a, b) => a.frameId - b.frameId);
  const fingerprint =
    showing.length === 0 ? top.fingerprint : showing.length === 1 ? showing[0]!.state.fingerprint : showing.map((f) => `${f.frameId}=${f.state.fingerprint}`).join('|');

  const blockers = frames.map((f) => f.state.blocker);
  const blocker = blockers.includes('verification') ? 'verification' : blockers.includes('needs_you') ? 'needs_you' : null;
  const userInputAt = Math.max(...frames.map((f) => f.state.userInputAt));

  const nexts = frames.filter((f) => f.state.action === 'next' || f.state.action === 'disabled');
  const sends = frames.some((f) => f.state.action === 'final');
  let action: StepState['action'];
  let pressIn: number | null = null;
  if (frames.some((f) => f.state.action === 'ambiguous') || nexts.length > 1 || (nexts.length === 1 && sends)) action = 'ambiguous';
  else if (nexts.length === 1) {
    action = nexts[0]!.state.action;
    if (action === 'next') pressIn = nexts[0]!.frameId;
  } else action = sends ? 'final' : 'none';

  return { state: { url: top.url, fingerprint, action, blocker, userInputAt }, pressIn };
}

const ACTIONS = new Set(['next', 'disabled', 'final', 'ambiguous', 'none']);
const BLOCKERS = new Set(['needs_you', 'verification']);

/** A frame's answer to `frame:stepState`, or null when it is not one. */
export function parseStepState(raw: unknown): StepState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== 'string' || typeof r.fingerprint !== 'string') return null;
  if (typeof r.action !== 'string' || !ACTIONS.has(r.action)) return null;
  if (r.blocker !== null && (typeof r.blocker !== 'string' || !BLOCKERS.has(r.blocker))) return null;
  return {
    url: r.url,
    fingerprint: r.fingerprint,
    action: r.action as StepState['action'],
    blocker: r.blocker as StepState['blocker'],
    userInputAt: typeof r.userInputAt === 'number' && Number.isFinite(r.userInputAt) ? r.userInputAt : 0,
  };
}

export interface ReadDeps {
  listFrameIds(tabId: number): Promise<number[]>;
  ask(tabId: number, frameId: number): Promise<unknown>;
}

/** Asks every frame of the tab what it shows, at once, and merges the answers. A frame that fails to answer is left out. */
export async function readTabStep(tabId: number, deps: ReadDeps): Promise<{ state: StepState; pressIn: number | null } | null> {
  const ids = await deps.listFrameIds(tabId);
  const answers = await Promise.all(ids.map((frameId) => deps.ask(tabId, frameId).then((raw) => ({ frameId, state: parseStepState(raw) }), () => null)));
  return mergeStepStates(answers.filter((a): a is FrameStep => a !== null && a.state !== null));
}
