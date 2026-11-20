// Cross-page multi-step wizard session tracker stored purely in `chrome.storage.session` (zero disk/alarms persistence).
import { browser } from 'wxt/browser';

/** Why auto-advance handed the form back to the user. */
export type AdvanceStop =
  /** Only a send button is left: the user checks the pages and sends it. */
  | 'final_step'
  /** A required field is empty, the page shows an error, or Next is switched off. */
  | 'needs_you'
  /** A captcha or a texted code. */
  | 'verification'
  | 'no_next'
  /** Next buttons that disagree, or a Next and a send button side by side. */
  | 'ambiguous'
  /** Next was pressed and the step did not change. */
  | 'not_advanced'
  | 'left_site'
  | 'step_limit'
  | 'user_took_over'
  | 'stopped'
  /** The user previews every fill: that preview is waiting. */
  | 'preview'
  | 'fill_failed'
  | 'vault_locked'
  | 'no_page';

export interface AdvanceState {
  running: boolean;
  /** Steps moved forward and filled in this run. */
  steps: number;
  stopReason?: AdvanceStop;
}

export interface WizardSessionState {
  tabId: number;
  origin: string;
  resumeId: string;
  resumeTitle: string;
  stepCount: number;
  filledUrls?: string[];
  lastUrl: string;
  lastUpdatedAt: number;
  /** The last (or current) auto-advance run in this tab. */
  advance?: AdvanceState;
}

export const WIZARD_SESSION_TTL_MS = 30 * 60 * 1000;
export const wizardKey = (tabId: number): string => `wizard:${tabId}`;

function originOf(href: string): string | null {
  try {
    const u = new URL(href);
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

export async function loadWizardSession(tabId: number): Promise<WizardSessionState | null> {
  const key = wizardKey(tabId);
  const stored = await browser.storage.session.get(key);
  const raw = stored[key] as Partial<WizardSessionState> | undefined;
  if (
    !raw ||
    typeof raw.origin !== 'string' ||
    typeof raw.resumeId !== 'string' ||
    typeof raw.stepCount !== 'number' ||
    typeof raw.lastUpdatedAt !== 'number'
  ) {
    return null;
  }
  if (Date.now() - raw.lastUpdatedAt > WIZARD_SESSION_TTL_MS) {
    await browser.storage.session.remove(key);
    return null;
  }
  return raw as WizardSessionState;
}

export async function recordWizardStep(
  tabId: number,
  url: string,
  resume: { id: string; title: string },
): Promise<WizardSessionState | null> {
  const origin = originOf(url);
  if (!origin) return null;
  const prev = await loadWizardSession(tabId);
  const sameRun = prev && prev.origin === origin && prev.resumeId === resume.id;
  const prevUrls = sameRun ? (prev.filledUrls ?? (prev.lastUrl ? [prev.lastUrl] : [])) : [];
  const nextUrls = prevUrls.includes(url) ? prevUrls : [...prevUrls, url].slice(-20);
  const next: WizardSessionState = {
    tabId,
    origin,
    resumeId: resume.id,
    resumeTitle: resume.title,
    stepCount: sameRun ? nextUrls.length : 1,
    filledUrls: nextUrls,
    lastUrl: url,
    lastUpdatedAt: Date.now(),
    ...(sameRun && prev.advance ? { advance: prev.advance } : {}),
  };
  await browser.storage.session.set({ [wizardKey(tabId)]: next });
  return next;
}

/** Store the auto-advance state on the tab's session. Without a session (the tab left the site) nothing is kept. */
export async function setWizardAdvance(tabId: number, advance: AdvanceState): Promise<WizardSessionState | null> {
  const prev = await loadWizardSession(tabId);
  if (!prev) return null;
  const next: WizardSessionState = { ...prev, advance, lastUpdatedAt: Date.now() };
  await browser.storage.session.set({ [wizardKey(tabId)]: next });
  return next;
}

/** Called on top-frame navigation commit: keep wizard session only when navigating within the same origin. */
export async function handleWizardNavigation(tabId: number, newUrl: string): Promise<WizardSessionState | null> {
  const prev = await loadWizardSession(tabId);
  if (!prev) return null;
  const nextOrigin = originOf(newUrl);
  if (!nextOrigin || nextOrigin !== prev.origin) {
    await browser.storage.session.remove(wizardKey(tabId));
    return null;
  }
  const refreshed: WizardSessionState = {
    ...prev,
    lastUpdatedAt: Date.now(),
  };
  await browser.storage.session.set({ [wizardKey(tabId)]: refreshed });
  return refreshed;
}

export async function clearWizardSession(tabId: number): Promise<void> {
  await browser.storage.session.remove(wizardKey(tabId));
}
