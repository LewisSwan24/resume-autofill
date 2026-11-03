// Profile state for the options page: load, live updates from other contexts, validation and autosave.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOSAVE_DELAY_MS, createAutosaver, validateProfile, type FieldIssue } from '../../src/editor';
import type { Profile } from '../../src/schema';
import { loadProfile, saveProfile, watchProfile } from '../../src/storage';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error';

export interface ProfileEditor {
  profile: Profile | null;
  loadError: string | null;
  status: SaveStatus;
  saveError: string | null;
  issues: FieldIssue[];
  /** Apply an edit. Invalid profiles are kept in the form but never saved. */
  commit: (next: Profile, options?: { immediate?: boolean }) => Promise<void>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useProfileEditor(autosaveDelayMs: number = AUTOSAVE_DELAY_MS): ProfileEditor {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const version = useRef(0);
  /** True from the first unsaved edit until its save finished: remote updates are ignored meanwhile. */
  const dirty = useRef(false);

  const saver = useMemo(
    () =>
      createAutosaver<{ profile: Profile; version: number }>(async ({ profile: next, version: v }) => {
        setStatus('saving');
        try {
          const saved = await saveProfile(next);
          if (v !== version.current) return; // a newer edit is already queued
          dirty.current = false;
          setProfile(saved);
          setSaveError(null);
          setStatus('saved');
        } catch (error) {
          if (v !== version.current) return;
          setSaveError(messageOf(error));
          setStatus('error');
        }
      }, autosaveDelayMs),
    [autosaveDelayMs],
  );

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(
      (loaded) => {
        if (!cancelled && !dirty.current) setProfile(loaded);
      },
      (error) => {
        if (!cancelled) setLoadError(messageOf(error));
      },
    );
    const unwatch = watchProfile((remote) => {
      if (!dirty.current) setProfile(remote);
    });
    const flush = () => void saver.flush();
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelled = true;
      unwatch();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush(); // do not lose the last keystrokes when the page unmounts
    };
  }, [saver]);

  const commit = useCallback(
    async (next: Profile, options: { immediate?: boolean } = {}) => {
      version.current += 1;
      dirty.current = true;
      setProfile(next);
      setLoadError(null);
      const found = validateProfile(next);
      setIssues(found);
      if (found.length > 0) {
        saver.cancel();
        setStatus('invalid');
        return;
      }
      setStatus('pending');
      saver.schedule({ profile: next, version: version.current });
      if (options.immediate) await saver.flush();
    },
    [saver],
  );

  return { profile, loadError, status, saveError, issues, commit };
}
