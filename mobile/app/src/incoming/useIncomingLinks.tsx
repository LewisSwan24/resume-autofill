// Links, shared text and launcher shortcuts from other apps. One waiting slot: a newer arrival replaces
// the waiting one. The event is routed when it runs, not when it arrives, so a cold start checks record ids against
// the loaded app state. The choice sheet is shared with the clipboard card (choose()).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MessageParams } from '../../../../src/i18n';
import type { IncomingIntentPlugin } from '../native/incomingIntent';
import { createIncomingLinkSource, type IncomingLinkEvent } from './events';
import { LinkChoiceSheet } from './LinkChoiceSheet';
import { routeIncoming, waitingMessage, whenToRun, type BusyState, type FoundLink, type IncomingRoute } from './route';

export interface IncomingActions {
  /** `opened`: words to say once the page really opens (not while a replace-confirm waits, never if cancelled). */
  openLink(link: FoundLink, source: 'view' | 'share' | 'clipboard', opened?: { key: string; params?: MessageParams }): void;
  openDemo(): void;
  pasteFocus(): void;
  /** `from: 'reminder'`: opened from a deadline notification. */
  openApplication(id: string, open: 'detail' | 'page', from?: 'reminder'): void;
  /** A shortcut for a record that no longer exists: Home and m.app.missing. */
  missing(): void;
  say(key: string, params?: MessageParams): void;
}

export interface UseIncomingLinksOptions extends BusyState {
  source: IncomingIntentPlugin | undefined;
  recordIds: ReadonlySet<string>;
  /** recordKeys of the tracker's links, for the choice sheet's 已在网申记录里 tag. */
  knownKeys?: ReadonlySet<string>;
  act: IncomingActions;
}

interface Choice {
  links: FoundLink[];
  more: number;
  source: 'share' | 'clipboard';
}

interface Waiting {
  event: IncomingLinkEvent;
  /** The waiting toast was said for this arrival. */
  said: boolean;
}

const NO_KEYS: ReadonlySet<string> = new Set();

export function useIncomingLinks(o: UseIncomingLinksOptions): { element: ReactNode; choose(links: FoundLink[], more: number, source: 'share' | 'clipboard'): void } {
  const { source, ready, importOpen, runActive, onboarding } = o;
  const latest = useRef(o);
  latest.current = o;
  const waiting = useRef<Waiting | null>(null);
  const [arrivals, setArrivals] = useState(0);
  const [choice, setChoice] = useState<Choice | null>(null);

  const run = useCallback((route: IncomingRoute) => {
    const act = latest.current.act;
    switch (route.do) {
      case 'open':
        if (route.source === 'share' && route.link.title) {
          act.openLink(route.link, route.source, { key: 'm.in.openedShared', params: { title: route.link.title } });
        } else act.openLink(route.link, route.source);
        return;
      case 'choose':
        setChoice({ links: route.links, more: route.more, source: 'share' });
        return;
      case 'demo':
        act.openDemo();
        return;
      case 'paste':
        act.pasteFocus();
        return;
      case 'application':
        if (route.from) act.openApplication(route.recordId, route.open, route.from);
        else act.openApplication(route.recordId, route.open);
        return;
      case 'missing':
        act.missing();
        return;
      case 'say':
        act.say(route.key, undefined);
        return;
    }
  }, []);

  /** Run the waiting arrival when the app is free; say the waiting toast once while it waits. */
  const settle = useCallback(() => {
    const slot = waiting.current;
    if (!slot) return;
    const { ready: isReady, importOpen: isImport, runActive: isRun, onboarding: isOnboarding, recordIds, act } = latest.current;
    const busy: BusyState = { ready: isReady, importOpen: isImport, runActive: isRun, onboarding: isOnboarding };
    if (!isReady) return; // record ids are not known yet: route later
    const route = routeIncoming(slot.event, { recordIds });
    const when = whenToRun(route, busy);
    if (when === 'wait') {
      const message = waitingMessage(route, busy);
      if (message && !slot.said) {
        slot.said = true;
        act.say(message, undefined);
      }
      return;
    }
    waiting.current = null;
    if (when === 'drop') act.say('m.in.finishOnboarding', undefined);
    else run(route);
  }, [run]);

  useEffect(() => {
    if (!source) return;
    return createIncomingLinkSource(source).subscribe((event) => {
      waiting.current = { event, said: false };
      setArrivals((n) => n + 1);
    });
  }, [source]);

  useEffect(() => {
    settle();
  }, [settle, arrivals, ready, importOpen, runActive, onboarding]);

  const choose = useCallback((links: FoundLink[], more: number, from: 'share' | 'clipboard') => setChoice({ links, more, source: from }), []);
  const close = useCallback(() => setChoice(null), []);
  const knownKeys = o.knownKeys ?? NO_KEYS;

  const element = useMemo(
    () => (
      <LinkChoiceSheet
        open={choice !== null}
        links={choice?.links ?? []}
        more={choice?.more ?? 0}
        source={choice?.source ?? 'share'}
        knownKeys={knownKeys}
        onPick={(link) => {
          const from = choice?.source ?? 'share';
          setChoice(null);
          latest.current.act.openLink(link, from);
        }}
        onClose={close}
      />
    ),
    [choice, knownKeys, close],
  );

  return { element, choose };
}
