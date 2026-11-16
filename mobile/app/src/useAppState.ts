// App state for the screens: loaded once the profile tells whether this is a first run, changed optimistically.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppStateTooNewError } from './store/appStateMigrate';
import { defaultAppState, type AppState, type AppStateStore } from './store/appStateStore';

export interface AppStateApi {
  state: AppState | null; // null until loaded
  /** Apply a change to the newest state, show it at once, persist it. Resolves false (and rolls the screen back
   *  to the last stored state) when saving failed. */
  update(change: (state: AppState) => AppState): Promise<boolean>;
  /** The stored state comes from a newer app version: it is never overwritten, changes live in memory only. */
  readOnly: boolean;
}

/**
 * Loads once `seed` is non-null. Nothing stored: defaults, with onboarding counted as done when resumes already
 * exist (an upgrade from a build without onboarding), saved at once. Corrupt: the same defaults, saved over it.
 * Written by a newer app version: defaults (onboarding done) in memory, the file left alone, `readOnly` true.
 */
export function useAppState(store: AppStateStore, seed: { hasResumes: boolean } | null): AppStateApi {
  const [state, setState] = useState<AppState | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const readOnlyRef = useRef(false);
  /** The newest state shown, so quick updates build on each other. */
  const latest = useRef<AppState | null>(null);
  /** What the store last confirmed; failed saves roll back to it. Null while nothing could be stored (an unusable
   *  vault): then a change stays on screen for this run, since there is nothing truer to go back to. */
  const stored = useRef<AppState | null>(null);
  const alive = useRef(true);
  const started = useRef(false);
  const ready = seed !== null;
  const hasResumes = seed?.hasResumes ?? false;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      let tooNew = false;
      let initial = await store.load().catch((error: unknown) => {
        tooNew = error instanceof AppStateTooNewError;
        return null;
      });
      let confirmed: AppState | null = initial;
      if (tooNew) {
        readOnlyRef.current = true;
        initial = defaultAppState({ onboardingDone: true });
        if (alive.current) setReadOnly(true);
      } else if (initial === null) {
        const fresh = defaultAppState({ onboardingDone: hasResumes });
        confirmed = await store.save(fresh).catch(() => null);
        initial = confirmed ?? fresh;
      }
      stored.current ??= confirmed;
      if (latest.current === null) latest.current = initial;
      if (alive.current) setState(latest.current);
    })();
  }, [ready, hasResumes, store]);

  const update = useCallback(
    async (change: (state: AppState) => AppState): Promise<boolean> => {
      const base = latest.current;
      if (base === null) return false;
      const next = change(base);
      latest.current = next;
      setState(next);
      if (readOnlyRef.current) return true;
      try {
        stored.current = await store.save(next);
        return true;
      } catch {
        // Only roll back if nothing newer was shown since; a newer change has its own save and outcome.
        if (latest.current === next && stored.current !== null) {
          latest.current = stored.current;
          if (alive.current) setState(stored.current);
        }
        return false;
      }
    },
    [store],
  );

  return { state, update, readOnly };
}
