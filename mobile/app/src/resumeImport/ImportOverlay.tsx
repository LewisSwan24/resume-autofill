// The full-screen layer every import screen renders in: a modal dialog labelled by its h1, above the shell and below
// sheets and the toast. On every step the h1 takes the focus so a screen reader says where it is. The back key is
// routed here by App (after any sheet above has closed), see useResumeImport's `back`.
import { useEffect, useRef, type ReactNode } from 'react';
import { useKeyboardOpen } from '../TabBar';

export interface ImportOverlayProps {
  headingId: string;
  /** Changes when the screen inside changes (progress, failure, review). */
  stepKey: string;
  children: ReactNode;
}

export function ImportOverlay({ headingId, stepKey, children }: ImportOverlayProps) {
  const keyboard = useKeyboardOpen();
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (layer.current) layer.current.scrollTop = 0;
    const h1 = document.getElementById(headingId);
    h1?.focus({ preventScroll: true });
  }, [headingId, stepKey]);
  return (
    <div ref={layer} className={keyboard ? 'm-ri m-ri--keyboard' : 'm-ri'} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <div className="m-ri__page">{children}</div>
    </div>
  );
}
