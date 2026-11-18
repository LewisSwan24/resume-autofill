// Read-only live view of the stored profile (the side panel only switches the active resume).
import { useEffect, useState } from 'react';
import type { Profile } from '../../src/schema';
import { VaultLockedError, loadProfile, watchProfile } from '../../src/storage';

export function useProfile(): { profile: Profile | null; error: string | null; vaultLocked: boolean } {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vaultLocked, setVaultLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(
      (loaded) => {
        if (!cancelled) {
          setVaultLocked(false);
          setProfile((current) => current ?? loaded);
        }
      },
      (e) => {
        if (!cancelled) {
          if (e instanceof VaultLockedError) setVaultLocked(true);
          else setError(e instanceof Error ? e.message : String(e));
        }
      },
    );
    const unwatch = watchProfile((remote) => {
      setVaultLocked(false);
      setProfile(remote);
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  return { profile, error, vaultLocked };
}
