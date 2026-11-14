// One browser session per open target: created when App opens a page (a new target object, even for the same URL,
// replaces the session), disposed when it closes or is replaced. React reads its state through useSyncExternalStore.
// The deps go through refs, so the session always reads the newest profile, app state and interface language
// without being recreated. Given a translator, the session drives the native FAB itself.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '../../../../src/i18n';
import { mt } from '../i18n';
import type { FillBrowserNative } from './native';
import { createBrowserSession, type BrowserSession, type BrowserSessionDeps, type BrowserTarget, type SessionState } from './model/session';

export type SessionDeps = Pick<BrowserSessionDeps, 'getFillContext' | 'readFile' | 'onTitle'>;

export interface OpenSession {
  session: BrowserSession;
  state: SessionState;
  native: FillBrowserNative;
}

const noop = () => () => undefined;
const nothing = () => null;

export function useBrowserSession(native: FillBrowserNative | null, target: BrowserTarget | null, deps: SessionDeps): OpenSession | null {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const language = useLanguage();
  const languageRef = useRef(language);
  languageRef.current = language;
  const [session, setSession] = useState<BrowserSession | null>(null);

  useEffect(() => {
    if (!native || !target) {
      setSession(null);
      return;
    }
    const created = createBrowserSession({
      native,
      target,
      getFillContext: () => depsRef.current.getFillContext(),
      readFile: (id) => depsRef.current.readFile(id),
      onTitle: (recentId, title, host) => depsRef.current.onTitle(recentId, title, host),
      translate: (key, params) => mt(languageRef.current, key, params),
    });
    setSession(created);
    return () => {
      void created.dispose().catch(() => undefined);
    };
  }, [native, target]);

  // A session left over from the previous target is never shown.
  const current = session && target && session.getState().target === target ? session : null;
  const state = useSyncExternalStore<SessionState | null>(current ? current.subscribe : noop, current ? current.getState : nothing);
  return current && state && native ? { session: current, state, native } : null;
}
