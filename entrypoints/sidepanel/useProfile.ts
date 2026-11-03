// Read-only live view of the stored profile (the side panel only switches the active resume).
import { useEffect, useState } from 'react';
import type { Profile } from '../../src/schema';
import { loadProfile, watchProfile } from '../../src/storage';

export function useProfile(): { profile: Profile | null; error: string | null } {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(
      (loaded) => {
        if (!cancelled) setProfile((current) => current ?? loaded);
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    const unwatch = watchProfile((remote) => setProfile(remote));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  return { profile, error };
}
