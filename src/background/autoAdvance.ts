// Auto-advance through a multi-step application: press the page's own Next button, wait for the next step, fill
// it, and repeat. It stops, and hands the form back, at the last step (only a send button left), at anything
// that needs the user, or when asked. It never presses a button that sends the application.
import type { FillRequestResponse } from '../messaging';
import type { StepAction, PageBlocker } from '../fill/nextStep';
import type { AdvanceState, AdvanceStop } from './wizardSession';

export type { AdvanceState, AdvanceStop } from './wizardSession';

/** What the top frame says about the step it is showing. */
export interface StepState {
  url: string;
  fingerprint: string;
  action: StepAction['kind'];
  blocker: PageBlocker | null;
  /** Last time the user pressed a key or the pointer on the page itself (0: never). */
  userInputAt: number;
}

export interface PressResult {
  pressed: boolean;
  reason?: AdvanceStop;
}

export interface AdvanceDeps {
  /** null while the page is reloading or has no content script yet. */
  readStep(tabId: number): Promise<StepState | null>;
  pressNext(tabId: number): Promise<PressResult>;
  /** Fill the tab, but only while it is still on `origin`; otherwise answer `origin_changed`. */
  fill(tabId: number, origin: string): Promise<FillRequestResponse>;
  /** The origin of the tab's wizard session; null once the tab has left that site. */
  sessionOrigin(tabId: number): Promise<string | null>;
  publish(tabId: number, state: AdvanceState): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  pollMs: number;
  /** How long a pressed Next has to bring up the next step. */
  waitMs: number;
  /** Time for the new step's fields to render before filling. */
  settleMs: number;
  maxSteps: number;
}

export const ADVANCE_DEFAULTS = { pollMs: 400, waitMs: 10_000, settleMs: 600, maxSteps: 15 } as const;

const ACTION_STOP: Record<Exclude<StepAction['kind'], 'next'>, AdvanceStop> = {
  final: 'final_step',
  none: 'no_next',
  ambiguous: 'ambiguous',
  disabled: 'needs_you',
};

function originOf(href: string): string | null {
  try {
    const o = new URL(href).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

const current = new Map<number, AdvanceState>();
const stopRequested = new Set<number>();

/** Ask a running auto-advance to stop before its next step. False when none is running in that tab. */
export function stopAutoAdvance(tabId: number): boolean {
  if (!current.has(tabId)) return false;
  stopRequested.add(tabId);
  return true;
}

export const isAutoAdvancing = (tabId: number): boolean => current.has(tabId);

export async function runAutoAdvance(tabId: number, deps: AdvanceDeps): Promise<AdvanceState> {
  const already = current.get(tabId);
  if (already) return already;
  let state: AdvanceState = { running: true, steps: 0 };
  current.set(tabId, state);
  stopRequested.delete(tabId);

  const publish = async (next: AdvanceState) => {
    state = next;
    if (next.running) current.set(tabId, next);
    await deps.publish(tabId, next).catch(() => undefined);
  };
  const finish = async (stopReason: AdvanceStop): Promise<AdvanceState> => {
    const done = { running: false, steps: state.steps, stopReason };
    current.delete(tabId);
    await publish(done);
    return done;
  };

  try {
    await publish(state);
    // Resume data only ever goes to the site the run started on: a step that turns up anywhere else ends the run.
    const origin = await deps.sessionOrigin(tabId).catch(() => null);
    if (!origin) return await finish('left_site');
    const onSite = async () => (await deps.sessionOrigin(tabId).catch(() => null)) === origin;
    let since = deps.now();
    for (;;) {
      if (stopRequested.has(tabId)) return await finish('stopped');
      const here = await deps.readStep(tabId).catch(() => null);
      if (!here) return await finish('no_page');
      if (here.userInputAt > since) return await finish('user_took_over');
      if (here.blocker) return await finish(here.blocker);
      if (here.action !== 'next') return await finish(ACTION_STOP[here.action]);
      if (state.steps >= deps.maxSteps) return await finish('step_limit');

      const press = await deps.pressNext(tabId).catch((): PressResult => ({ pressed: false }));
      if (!press.pressed) return await finish(press.reason ?? 'not_advanced');

      const deadline = deps.now() + deps.waitMs;
      let moved = false;
      let last: StepState | null = null;
      while (deps.now() < deadline) {
        await deps.sleep(deps.pollMs);
        if (stopRequested.has(tabId)) return await finish('stopped');
        if (!(await onSite())) return await finish('left_site');
        const seen = await deps.readStep(tabId).catch(() => null);
        if (!seen) continue; // reloading: the next step's content script is not up yet
        if (originOf(seen.url) !== origin) return await finish('left_site');
        if (seen.url !== here.url || seen.fingerprint !== here.fingerprint) {
          moved = true;
          break;
        }
        last = seen;
      }
      if (!moved) return await finish(last?.blocker === 'needs_you' ? 'needs_you' : 'not_advanced');

      await deps.sleep(deps.settleMs);
      if (stopRequested.has(tabId)) return await finish('stopped');
      if (!(await onSite())) return await finish('left_site');
      const res = await deps.fill(tabId, origin).catch((e: unknown): FillRequestResponse => ({ ok: false, error: String(e) }));
      // `no_frames`: no frame has anything the resume can fill (a step of questions only). Nothing went wrong;
      // the step is checked like any other, so required questions stop the run as "needs you".
      if (!res.ok && res.error !== 'no_frames') {
        const reason = res.error === 'vault_locked' ? 'vault_locked' : res.error === 'origin_changed' ? 'left_site' : 'fill_failed';
        return await finish(reason);
      }
      const steps = state.steps + 1;
      if (res.preview) {
        state = { ...state, steps };
        return await finish('preview');
      }
      since = deps.now();
      await publish({ running: true, steps });
    }
  } finally {
    current.delete(tabId);
    stopRequested.delete(tabId);
  }
}
