// The 「一键填写」 FAB is a native view over the page. The session computes what it says and where it sits
// (fabModel + placeFab, fed to native.setFab, given a translator by useBrowserSession) and handles drags and the
// TalkBack "switch side" action; this hook turns its taps into the screen's reactions: a run's outcome, the report,
// or an explanation of why filling is not possible here.
import { useEffect, useRef } from 'react';
import type { BrowserSession, FabTapEvent } from './model/session';

export interface FabHandlers {
  /** session.fill() ran; started, busy, no resume, or unavailable. */
  onFill(result: Extract<FabTapEvent, { kind: 'fill' }>['result']): void;
  onReport(): void;
  onExplain(which: 'unsupported' | 'missing'): void;
}

export function useNativeFab(session: BrowserSession, handlers: FabHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(
    () =>
      session.onFabTap((e) => {
        if (e.kind === 'fill') ref.current.onFill(e.result);
        else if (e.kind === 'report') ref.current.onReport();
        else ref.current.onExplain(e.which);
      }),
    [session],
  );
}
