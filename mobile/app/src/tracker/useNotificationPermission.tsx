// The permission flow behind a reminder switch: granted and enabled → yes; Android would still ask →
// our sheet first, then the system prompt; denied, switched off or the channel blocked → no, and the caller shows
// 「去系统设置打开」. Android 10 to 12 have no prompt: there only `enabled` counts (the plugin reports it).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RemindersPlugin } from '../native/reminders';
import { NotificationPermissionSheet } from './NotificationPermissionSheet';

/** granted: notifications will show. denied: the person said no just now. later: 先不用. off: blocked in settings. */
export type PermissionOutcome = 'granted' | 'denied' | 'later' | 'off';

export interface NotificationPermission {
  ensure(): Promise<PermissionOutcome>;
  /** Re-read the state (e.g. when a screen opens); resolves true when notifications can show. */
  check(): Promise<boolean>;
  /** Known to be off (after a check or an ensure); null before any check. */
  off: boolean | null;
  openSettings(): void;
  element: ReactNode;
}

export function useNotificationPermission(native: RemindersPlugin | null): NotificationPermission {
  const [asking, setAsking] = useState(false);
  const [off, setOff] = useState<boolean | null>(null);
  const answer = useRef<((go: boolean) => void) | null>(null);

  const check = useCallback(async () => {
    if (!native) return true;
    try {
      const s = await native.status();
      const ok = s.permission === 'granted' && s.enabled && !s.channelBlocked;
      setOff(!ok && s.permission !== 'prompt');
      return ok;
    } catch {
      return false;
    }
  }, [native]);

  // Back from system settings (or any other app): once the state is known, read it again, so a line saying
  // notifications are off goes away when they were switched on there.
  const known = off !== null;
  useEffect(() => {
    if (!native || !known) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [native, known, check]);

  const ensure = useCallback(async (): Promise<PermissionOutcome> => {
    if (!native) return 'granted';
    let s: Awaited<ReturnType<RemindersPlugin['status']>>;
    try {
      s = await native.status();
    } catch {
      return 'off';
    }
    if (s.permission === 'granted' && s.enabled && !s.channelBlocked) {
      setOff(false);
      return 'granted';
    }
    if (s.permission !== 'prompt') {
      setOff(true);
      return 'off';
    }
    const go = await new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setAsking(true);
    });
    if (!go) return 'later';
    try {
      const r = await native.requestPermission();
      if (r.permission !== 'granted') {
        setOff(true);
        return 'denied';
      }
      const after = await native.status();
      const ok = after.enabled && !after.channelBlocked;
      setOff(!ok);
      return ok ? 'granted' : 'off';
    } catch {
      return 'off';
    }
  }, [native]);

  const settle = (go: boolean) => {
    setAsking(false);
    const resolve = answer.current;
    answer.current = null;
    resolve?.(go);
  };

  const openSettings = useCallback(() => {
    void native?.openSettings().catch(() => undefined);
  }, [native]);

  const element = <NotificationPermissionSheet open={asking} onContinue={() => settle(true)} onLater={() => settle(false)} />;
  return { ensure, check, off, openSettings, element };
}
