// Profile state for the mobile profile page: load once, validate every edit, autosave valid ones.
// Same behaviour as entrypoints/options/useProfileEditor.ts, over a ProfileStore instead of browser.storage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOSAVE_DELAY_MS, createAutosaver, getByPath, setByPath, validateProfile, type FieldIssue } from '../../../src/editor';
import type { Profile } from '../../../src/schema';
import type { ProfileStore } from './store/profileStore';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error';

export interface ProfileEditor {
  profile: Profile | null;
  loadError: string | null;
  status: SaveStatus;
  issues: FieldIssue[];
  /** Apply an edit to the newest profile. Invalid profiles stay on screen but are never saved. */
  edit: (change: (profile: Profile) => Profile, options?: { immediate?: boolean }) => void;
  /** Save a pending edit now (the app is going to the background). */
  flush: () => Promise<void>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useProfileEditor(store: ProfileStore, delayMs: number = AUTOSAVE_DELAY_MS): ProfileEditor {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  /** The newest profile, so quick successive edits never build on a stale render. */
  const latest = useRef<Profile | null>(null);
  /** The newest profile without validation errors: what a save falls back to at an invalid field. */
  const lastValid = useRef<Profile | null>(null);
  const version = useRef(0);
  /** A field on screen is invalid: the status keeps saying so while the rest is saved. */
  const invalid = useRef(false);

  const saver = useMemo(
    () =>
      createAutosaver<{ profile: Profile; version: number }>(async ({ profile: next, version: v }) => {
        if (!invalid.current) setStatus('saving');
        try {
          await store.save(next);
          if (v === version.current) setStatus(invalid.current ? 'invalid' : 'saved');
        } catch {
          if (v === version.current) setStatus('error');
        }
      }, delayMs),
    [store, delayMs],
  );

  useEffect(() => {
    let cancelled = false;
    store.load().then(
      (loaded) => {
        if (cancelled || latest.current) return;
        latest.current = loaded;
        lastValid.current = loaded;
        setProfile(loaded);
      },
      (error) => {
        if (!cancelled) setLoadError(messageOf(error));
      },
    );
    return () => {
      cancelled = true;
      void saver.flush(); // do not lose the last keystrokes when the page goes away
    };
  }, [store, saver]);

  const edit = useCallback(
    (change: (profile: Profile) => Profile, options: { immediate?: boolean } = {}) => {
      if (!latest.current) return;
      const next = change(latest.current);
      latest.current = next;
      version.current += 1;
      setProfile(next);
      const found = validateProfile(next);
      setIssues(found);
      invalid.current = found.length > 0;
      let toSave = next;
      if (found.length > 0) {
        // Keep the bad value on screen, but save everything else: put the last valid value back at each bad path.
        const repaired = found.reduce<Profile>((p, issue) => setByPath(p, issue.path, getByPath(lastValid.current, issue.path)), next);
        setStatus('invalid');
        if (validateProfile(repaired).length > 0) {
          saver.cancel();
          return;
        }
        toSave = repaired;
      } else {
        setStatus('pending');
      }
      lastValid.current = toSave;
      saver.schedule({ profile: toSave, version: version.current });
      if (options.immediate) void saver.flush();
    },
    [saver],
  );

  const flush = useCallback(() => saver.flush(), [saver]);

  return { profile, loadError, status, issues, edit, flush };
}
