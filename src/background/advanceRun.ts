// Production wiring of auto-advance: the tab's top frame reads and presses, the normal fill fills, and every
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
import { loadWizardSession, setWizardAdvance } from './wizardSession';

export { stopAutoAdvance };

const ACTIONS = new Set(['next', 'disabled', 'final', 'ambiguous', 'none']);
const BLOCKERS = new Set(['needs_you', 'verification']);

function parseStepState(raw: unknown): StepState | null {
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

/** Start auto-advance in a tab that has a wizard session. Resolves as soon as the run has started. */
export async function startAutoAdvance(tabId: number): Promise<FillRequestResponse> {
  if (isAutoAdvancing(tabId)) return { ok: true };
  if (!(await loadWizardSession(tabId))) return { ok: false, error: 'no_session' };
  const stop = keepAlive();
  void runAutoAdvance(tabId, {
    ...ADVANCE_DEFAULTS,
    readStep: async (id) => parseStepState(await sendToFrame(id, 0, { type: 'frame:stepState' })),
    pressNext: async (id) => {
      const res = (await sendToFrame(id, 0, { type: 'frame:pressNext' })) as PressResult | undefined;
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
