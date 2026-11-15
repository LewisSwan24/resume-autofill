// Whether the resume keyboard is enabled and in use. Read on mount, on the plugin's
// stateChange event (the app's window regained focus: back from system settings or the input-method picker) and
// when the page becomes visible again. Without the plugin (browser preview) nothing is called.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardStatus, ResumeKeyboardPlugin } from '../native/resumeKeyboard';

export interface KeyboardStatusState {
  /** null until the first read succeeds, and always null without the plugin. */
  status: KeyboardStatus | null;
  /** The last read failed. The next event or visibility change tries again. */
  error: boolean;
  refresh(): Promise<void>;
}

export function useKeyboardStatus(native: ResumeKeyboardPlugin | null): KeyboardStatusState {
  const [status, setStatus] = useState<KeyboardStatus | null>(null);
  const [error, setError] = useState(false);
  const live = useRef(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!native) return;
    const mine = ++seq.current;
    try {
      const next = await native.status();
      if (!live.current || mine !== seq.current) return;
      setStatus({ available: next.available, enabled: next.enabled, current: next.current });
      setError(false);
    } catch {
      if (!live.current || mine !== seq.current) return;
      setError(true);
    }
  }, [native]);

  useEffect(() => {
    live.current = true;
    if (!native) {
      setStatus(null);
      setError(false);
      return () => {
        live.current = false;
      };
    }
    void refresh();
    let handle: { remove(): Promise<void> } | null = null;
    let gone = false;
    native
      .addListener('stateChange', (next) => {
        if (!live.current) return;
        seq.current += 1; // an event is newer than any read still in flight
        setStatus({ available: next.available, enabled: next.enabled, current: next.current });
        setError(false);
      })
      .then((h) => {
        if (gone) void h.remove();
        else handle = h;
      })
      .catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      gone = true;
      live.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (handle) void handle.remove();
    };
  }, [native, refresh]);

  return { status, error, refresh };
}
