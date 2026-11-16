// The copied-link offer. On window focus, and once whenever the app becomes free to show
// Home, it looks at the clip's label (hint(): no content, no Android 13 notice); only a new, plain, likely-link clip is
// read, at most once. The clip's stamp is saved after every read; the offer lives in React state only, and nothing
// copied is written anywhere unless the person opens it (then as a record, by the caller).
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseApplicationLinks } from '../home/pasteLink';
import type { ClipboardPeekPlugin } from '../native/clipboardPeek';
import type { AppState } from '../store/appStateStore';
import { recentKey } from '../store/recentPages';
import { linkDigest, pickOffer, rememberDismissed, shouldRead, type ClipOffer } from './clipboardOffer';

export interface UseClipboardOfferOptions {
  native: ClipboardPeekPlugin | null;
  appState: AppState | null;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  /** Ready, onboarding done, browser not shown, no import overlay. */
  active: boolean;
  /** 打开 / 选一个打开 on the card. */
  onOpen: (offer: ClipOffer) => void;
}

export interface ClipboardOfferApi {
  offer: ClipOffer | null;
  open(): void;
  dismiss(): void;
}

export function useClipboardOffer(o: UseClipboardOfferOptions): ClipboardOfferApi {
  const { native, active } = o;
  const latest = useRef(o);
  latest.current = o;
  const [offer, setOfferState] = useState<ClipOffer | null>(null);
  const offerRef = useRef<ClipOffer | null>(null);
  const setOffer = useCallback((next: ClipOffer | null) => {
    offerRef.current = next;
    setOfferState(next);
  }, []);
  /** Digests of the offered links (recordKey → digest), for 不用了. Memory only. */
  const digestsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const busy = useRef(false);
  /** The stamp read last, so a second focus before the save lands does not read the same clip again. */
  const readStamp = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    const plugin = latest.current.native;
    const state = latest.current.appState;
    if (!plugin || !state || !latest.current.active || !state.clipboard.offer || busy.current) return;
    busy.current = true;
    try {
      const hint = await plugin.hint();
      const now = latest.current.appState;
      if (!now || hint.stamp === readStamp.current) return;
      if (!shouldRead(hint, now.clipboard, { active: latest.current.active })) return;
      const stamp = hint.stamp!;
      readStamp.current = stamp;
      let text: string | null = null;
      try {
        text = (await plugin.readText()).text;
      } catch {
        text = null;
      }
      void latest.current.updateAppState((s) => ({ ...s, clipboard: { ...s.clipboard, lastStamp: stamp } }));
      const links = text ? parseApplicationLinks(text) : [];
      const digests = new Map<string, string>();
      for (const link of links) digests.set(recentKey(link.url), await linkDigest(link.url));
      const after = latest.current.appState;
      if (!alive.current || !after) return;
      const known = new Set(after.applications.map((r) => recentKey(r.url)));
      const next = text ? pickOffer(text, stamp, known, new Set(after.clipboard.dismissed), digests) : null;
      digestsRef.current = digests;
      setOffer(next);
    } catch {
      // A failed look or read shows no card and says nothing.
    } finally {
      busy.current = false;
    }
  }, [setOffer]);

  useEffect(() => {
    if (!native) return;
    let handle: { remove(): Promise<void> } | null = null;
    let live = true;
    native.addListener('focus', () => void check()).then(
      (h) => {
        if (live) handle = h;
        else void h.remove();
      },
      () => undefined,
    );
    return () => {
      live = false;
      if (handle) void handle.remove();
    };
  }, [native, check]);

  const ready = o.appState !== null;
  useEffect(() => {
    if (active && ready) void check();
  }, [active, ready, check]);

  const offerOn = o.appState?.clipboard.offer ?? true;
  useEffect(() => {
    if (!offerOn) setOffer(null);
  }, [offerOn, setOffer]);

  const open = useCallback(() => {
    const current = offerRef.current;
    setOffer(null);
    if (current) latest.current.onOpen(current);
  }, [setOffer]);

  const dismiss = useCallback(() => {
    const current = offerRef.current;
    setOffer(null);
    if (!current) return;
    const digests = current.links.map((l) => digestsRef.current.get(recentKey(l.url))).filter((d): d is string => d !== undefined);
    void latest.current.updateAppState((s) => ({ ...s, clipboard: rememberDismissed(s.clipboard, digests) }));
  }, [setOffer]);

  return { offer, open, dismiss };
}
