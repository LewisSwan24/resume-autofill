// Profile state for the options page: load, live updates from other contexts, validation and autosave.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOSAVE_DELAY_MS, createAutosaver, validateProfile, type FieldIssue } from '../../src/editor';
import { CURRENT_SCHEMA_VERSION, ProfileSchema, type Profile } from '../../src/schema';
import { VaultLockedError, loadProfile, saveProfile, watchProfile } from '../../src/storage';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error' | 'locked';

export interface ProfileEditor {
  profile: Profile | null;
  loadError: string | null;
  vaultLocked: boolean;
  status: SaveStatus;
  saveError: string | null;
  issues: FieldIssue[];
  /** Reload stored profile (e.g. after unlocking the Storage Vault). */
  reload: () => void;
  /** The vault was locked from this page ("Lock now"): edits are held until it is unlocked. */
  markLocked: () => void;
  /** The vault was unlocked: save the edits held while it was locked, or reload when there are none. */
  unlocked: () => void;
  /** The vault and its data were deleted ("restore from a backup"): start from an empty profile. */
  vaultRemoved: () => void;
  /** Apply an edit. Invalid profiles are kept in the form but never saved. */
  commit: (next: Profile, options?: { immediate?: boolean }) => Promise<void>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useProfileEditor(autosaveDelayMs: number = AUTOSAVE_DELAY_MS): ProfileEditor {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const version = useRef(0);
  /** True from the first unsaved edit until its save finished: remote updates are ignored meanwhile. */
  const dirty = useRef(false);
  /** The newest edit; when a save is refused because the vault locked, this is what gets saved after unlocking. */
  const latest = useRef<Profile | null>(null);

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
          if (error instanceof VaultLockedError) {
            // Keep the edit (dirty stays true, `latest` holds it) and ask for the passphrase.
            setVaultLocked(true);
            setStatus('locked');
            return;
          }
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
        if (!cancelled && !dirty.current) {
          setVaultLocked(false);
          setLoadError(null);
          setProfile(loaded);
        }
      },
      (error) => {
        if (!cancelled) {
          if (error instanceof VaultLockedError) {
            setVaultLocked(true);
            setProfile(null);
            setLoadError(null);
          } else {
            setVaultLocked(false);
            setLoadError(messageOf(error));
          }
        }
      },
    );
    const unwatch = watchProfile((remote) => {
      if (!dirty.current) {
        setVaultLocked(false);
        setProfile(remote);
      }
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
  }, [saver, reloadTick]);

  const reload = useCallback(() => {
    setReloadTick((n) => n + 1);
  }, []);

  const commit = useCallback(
    async (next: Profile, options: { immediate?: boolean } = {}) => {
      version.current += 1;
      dirty.current = true;
      latest.current = next;
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

  const markLocked = useCallback(() => setVaultLocked(true), []);

  const unlocked = useCallback(() => {
    setVaultLocked(false);
    const pending = latest.current;
    if (dirty.current && pending && validateProfile(pending).length === 0) {
      setStatus('pending');
      saver.schedule({ profile: pending, version: version.current });
      void saver.flush();
    } else if (!dirty.current) {
      setReloadTick((n) => n + 1);
    }
  }, [saver]);

  const vaultRemoved = useCallback(() => {
    saver.cancel();
    dirty.current = false;
    latest.current = null;
    setVaultLocked(false);
    setLoadError(null);
    setStatus('idle');
    setProfile(ProfileSchema.parse({ schemaVersion: CURRENT_SCHEMA_VERSION }));
  }, [saver]);

  return { profile, loadError, vaultLocked, status, saveError, issues, reload, markLocked, unlocked, vaultRemoved, commit };
}
