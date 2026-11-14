// Where the app is: which tab is shown, what each tab has open, the onboarding step, a pending jump to a field, and
// the fill browser (open, or hidden behind the tabs while the person adds data).
// Pure, so the back-key order and tab rules are tested without rendering. Inactive tabs are unmounted; their
// sub-state lives here, so nothing hidden can hold a back-key layer.
import type { ModuleName } from '../../../src/editor';

export type Tab = 'home' | 'resume' | 'settings';
export type SettingsPage = 'root' | 'privacy';

/** Where to put the cursor after a jump. */
export interface FocusTarget {
  module: ModuleName;
  /** List modules: the entry to open; undefined (or out of range) when no entry exists yet. */
  entry?: number;
  /** Editor field key, or attachment slot ('resumeFileId'). */
  field: string;
  /** A new jump to the same field must focus it again. */
  nonce: number;
}

/** What the fill browser opens (the session's BrowserTarget). */
export interface BrowserTarget {
  url: string;
  demo: boolean;
  /** The recent-page entry the page was opened from, for its title. Never set for the demo. */
  recentId?: string;
}

/** Where an open came from: decides where closing goes back to. */
export type BrowserSource = 'paste' | 'recent' | 'demo-home' | 'demo-onboarding';
export type BrowserOpen = BrowserTarget & { source: BrowserSource };

export interface BrowserNav {
  target: BrowserTarget;
  /** True while the person is on the tabs and the session waits (the return pill shows). */
  hidden: boolean;
  returnTo: 'home' | 'onboarding';
}

export interface NavState {
  tab: Tab;
  /** Open module on the 简历 tab. */
  module: ModuleName | null;
  /** Consumed by ModuleBody / AttachmentsBody, then cleared. */
  focus: FocusTarget | null;
  settingsPage: SettingsPage;
  onboardingStep: 1 | 2;
  /** The fill browser, while a session exists. */
  browser: BrowserNav | null;
}

export const INITIAL_NAV: NavState = { tab: 'home', module: null, focus: null, settingsPage: 'root', onboardingStep: 1, browser: null };

export type NavAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'module'; module: ModuleName | null }
  | { type: 'jump'; target: Omit<FocusTarget, 'nonce'> }
  | { type: 'focusDone' }
  | { type: 'settingsPage'; page: SettingsPage }
  | { type: 'onboardingStep'; step: 1 | 2 }
  | { type: 'openBrowser'; target: BrowserOpen }
  | { type: 'hideBrowser' }
  | { type: 'showBrowser' }
  | { type: 'closeBrowser' }
  | { type: 'reset' };

let lastNonce = 0;

export function navReduce(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'tab':
      if (action.tab !== state.tab) return { ...state, tab: action.tab };
      // Tapping the tab you are on returns it to its root.
      if (action.tab === 'resume') return { ...state, module: null, focus: null };
      if (action.tab === 'settings') return { ...state, settingsPage: 'root' };
      return state;
    case 'module':
      return { ...state, module: action.module, focus: null };
    case 'jump':
      lastNonce += 1;
      return { ...state, tab: 'resume', module: action.target.module, focus: { ...action.target, nonce: lastNonce } };
    case 'focusDone':
      return state.focus ? { ...state, focus: null } : state;
    case 'settingsPage':
      return { ...state, settingsPage: action.page };
    case 'onboardingStep':
      return { ...state, onboardingStep: action.step };
    case 'openBrowser': {
      const { source, ...target } = action.target;
      return { ...state, browser: { target, hidden: false, returnTo: source === 'demo-onboarding' ? 'onboarding' : 'home' } };
    }
    case 'hideBrowser':
      // 「去填简历」: the 简历 tab root shows with the tab bar; the page waits behind the return pill.
      return state.browser ? { ...state, tab: 'resume', module: null, focus: null, browser: { ...state.browser, hidden: true } } : state;
    case 'showBrowser':
      return state.browser?.hidden ? { ...state, browser: { ...state.browser, hidden: false } } : state;
    case 'closeBrowser':
      return state.browser ? { ...state, browser: null } : state;
    case 'reset':
      return INITIAL_NAV;
  }
}

/** What the back key does when no sheet is open (rows 2–7 of the back-key table). Null: let the system have it. */
export function backFrom(state: NavState, onboarding: boolean): NavState | null {
  if (onboarding) return state.onboardingStep === 2 ? { ...state, onboardingStep: 1 } : null;
  if (state.tab === 'resume' && state.module) return { ...state, module: null, focus: null };
  if (state.tab === 'settings' && state.settingsPage === 'privacy') return { ...state, settingsPage: 'root' };
  if (state.tab !== 'home') return { ...state, tab: 'home' };
  return null;
}
