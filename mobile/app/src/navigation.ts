// Where the app is: which tab is shown, what each tab has open, the onboarding step, a pending jump to a field, and
// the fill browser (open, or hidden behind the tabs while the person adds data).
// Pure, so the back-key order and tab rules are tested without rendering. Inactive tabs are unmounted; their
// sub-state lives here, so nothing hidden can hold a back-key layer.
import type { ModuleName } from '../../../src/editor';
import type { ApplicationStatus } from './store/appStateStore';

export type Tab = 'home' | 'applications' | 'resume' | 'settings';
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
export type BrowserSource =
  | 'paste'
  | 'recent'
  | 'demo-home'
  | 'demo-onboarding'
  | 'view'
  | 'share'
  | 'clipboard'
  | 'shortcut'
  | 'reminder'
  | 'tracker';
export type BrowserReturn = 'home' | 'onboarding' | 'tracker';
/** `returnTo` overrides the source's own (App passes 'onboarding' for anything opened while onboarding shows). */
export type BrowserOpen = BrowserTarget & { source: BrowserSource; returnTo?: BrowserReturn };

export interface BrowserNav {
  target: BrowserTarget;
  /** True while the person is on the tabs and the session waits (the return pill shows). */
  hidden: boolean;
  returnTo: BrowserReturn;
}

export type StatusFilter = 'all' | ApplicationStatus;
export type TrackerSort = 'opened' | 'deadline';
/** The applications tab: the open record (detail) and the list's filter, search and sort, kept across tab switches. */
export interface TrackerNav {
  applicationId: string | null;
  filter: StatusFilter;
  query: string;
  sort: TrackerSort;
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
  tracker: TrackerNav;
  /** Set by the paste-link shortcut: Home focuses its paste box once per nonce, then clears it. */
  pasteFocus: number | null;
}

export const INITIAL_TRACKER: TrackerNav = { applicationId: null, filter: 'all', query: '', sort: 'opened' };

export const INITIAL_NAV: NavState = {
  tab: 'home',
  module: null,
  focus: null,
  settingsPage: 'root',
  onboardingStep: 1,
  browser: null,
  tracker: INITIAL_TRACKER,
  pasteFocus: null,
};

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
  | { type: 'openApplication'; id: string }
  | { type: 'closeApplication' }
  | { type: 'tracker'; patch: Partial<Omit<TrackerNav, 'applicationId'>> }
  | { type: 'pasteFocus' }
  | { type: 'pasteFocusDone' }
  | { type: 'reset' };

let lastNonce = 0;

function returnFor(source: BrowserSource): BrowserReturn {
  if (source === 'demo-onboarding') return 'onboarding';
  if (source === 'tracker' || source === 'reminder') return 'tracker';
  return 'home';
}

export function navReduce(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'tab':
      if (action.tab !== state.tab) return { ...state, tab: action.tab };
      // Tapping the tab you are on returns it to its root.
      if (action.tab === 'resume') return { ...state, module: null, focus: null };
      if (action.tab === 'settings') return { ...state, settingsPage: 'root' };
      if (action.tab === 'applications' && state.tracker.applicationId) {
        return { ...state, tracker: { ...state.tracker, applicationId: null } };
      }
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
      const { source, returnTo, ...target } = action.target;
      return { ...state, browser: { target, hidden: false, returnTo: returnTo ?? returnFor(source) } };
    }
    case 'hideBrowser':
      // 「去填简历」: the 简历 tab root shows with the tab bar; the page waits behind the return pill.
      return state.browser ? { ...state, tab: 'resume', module: null, focus: null, browser: { ...state.browser, hidden: true } } : state;
    case 'showBrowser':
      return state.browser?.hidden ? { ...state, browser: { ...state.browser, hidden: false } } : state;
    case 'closeBrowser':
      if (!state.browser) return state;
      // A page opened from the applications tab (list, detail or a reminder) closes back to it, detail kept.
      return state.browser.returnTo === 'tracker' ? { ...state, tab: 'applications', browser: null } : { ...state, browser: null };
    case 'openApplication':
      return { ...state, tab: 'applications', tracker: { ...state.tracker, applicationId: action.id } };
    case 'closeApplication':
      return state.tracker.applicationId ? { ...state, tracker: { ...state.tracker, applicationId: null } } : state;
    case 'tracker':
      return { ...state, tracker: { ...state.tracker, ...action.patch } };
    case 'pasteFocus':
      lastNonce += 1;
      return { ...state, tab: 'home', pasteFocus: lastNonce };
    case 'pasteFocusDone':
      return state.pasteFocus === null ? state : { ...state, pasteFocus: null };
    case 'reset':
      return INITIAL_NAV;
  }
}

/** What the back key does when no sheet is open (rows 2–7 of the back-key table). Null: let the system have it. */
export function backFrom(state: NavState, onboarding: boolean): NavState | null {
  if (onboarding) return state.onboardingStep === 2 ? { ...state, onboardingStep: 1 } : null;
  if (state.tab === 'resume' && state.module) return { ...state, module: null, focus: null };
  if (state.tab === 'settings' && state.settingsPage === 'privacy') return { ...state, settingsPage: 'root' };
  if (state.tab === 'applications' && state.tracker.applicationId) return { ...state, tracker: { ...state.tracker, applicationId: null } };
  if (state.tab !== 'home') return { ...state, tab: 'home' };
  return null;
}
