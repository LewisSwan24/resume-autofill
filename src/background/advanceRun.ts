// Production wiring of auto-advance: every frame of the tab says what it shows and the one with Next presses it, the normal fill fills, and every
// change of state is stored on the wizard session and broadcast to the FAB and the side panel.
import { sendToFrame, type FillRequestResponse } from '../messaging';
import {
  ADVANCE_DEFAULTS,
  isAutoAdvancing,
  runAutoAdvance,
  stopAutoAdvance,
  type PressResult,
  type StepState,
} from './autoAdvance';
import { broadcastWizard, keepAlive, runFillRequest } from './fill';
import { readTabStep } from './frameSteps';
import { listFrameIds, withTimeout } from './frames';
import { loadWizardSession, setWizardAdvance } from './wizardSession';

export { stopAutoAdvance };

/** A frame that cannot say what it shows this fast is left out of the step. */
const STEP_TIMEOUT_MS = 2_000;
/** Per tab, the frame whose Next button the last read found. */
const pressIn = new Map<number, number>();

const readFrames = (tabId: number) =>
  readTabStep(tabId, { listFrameIds, ask: (t, f) => withTimeout(sendToFrame(t, f, { type: 'frame:stepState' }), STEP_TIMEOUT_MS) });

/** What moving on from the tab's step would take, across every frame: the FAB offers to advance on `next`. */
export async function readStepAction(tabId: number): Promise<StepState['action'] | null> {
  return (await readFrames(tabId))?.state.action ?? null;
}

/** Start auto-advance in a tab that has a wizard session. Resolves as soon as the run has started. */
export async function startAutoAdvance(tabId: number): Promise<FillRequestResponse> {
  if (isAutoAdvancing(tabId)) return { ok: true };
  if (!(await loadWizardSession(tabId))) return { ok: false, error: 'no_session' };
  const stop = keepAlive();
  void runAutoAdvance(tabId, {
    ...ADVANCE_DEFAULTS,
    // Every frame is asked: a step may sit in an iframe. Next is pressed in the one frame that has it.
    readStep: async (id) => {
      const read = await readFrames(id);
      pressIn.set(id, read?.pressIn ?? 0);
      return read?.state ?? null;
    },
    pressNext: async (id) => {
      const res = (await sendToFrame(id, pressIn.get(id) ?? 0, { type: 'frame:pressNext' })) as PressResult | undefined;
      return res && typeof res.pressed === 'boolean' ? res : { pressed: false };
    },
    fill: (id, origin) => runFillRequest(id, { expectOrigin: origin }),
    sessionOrigin: async (id) => (await loadWizardSession(id))?.origin ?? null,
    publish: async (id, state) => {
      const session = await setWizardAdvance(id, state);
      await broadcastWizard(id, session);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
    .catch(() => undefined)
    .finally(stop);
  return { ok: true };
}
