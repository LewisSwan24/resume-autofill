// Where the app is: which tab is shown, what each tab has open, the onboarding step, and a pending jump to a field.
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

export interface NavState {
  tab: Tab;
  /** Open module on the 简历 tab. */
  module: ModuleName | null;
  /** Consumed by ModuleBody / AttachmentsBody, then cleared. */
  focus: FocusTarget | null;
  settingsPage: SettingsPage;
  onboardingStep: 1 | 2;
}

export const INITIAL_NAV: NavState = { tab: 'home', module: null, focus: null, settingsPage: 'root', onboardingStep: 1 };

export type NavAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'module'; module: ModuleName | null }
  | { type: 'jump'; target: Omit<FocusTarget, 'nonce'> }
  | { type: 'focusDone' }
  | { type: 'settingsPage'; page: SettingsPage }
  | { type: 'onboardingStep'; step: 1 | 2 }
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
