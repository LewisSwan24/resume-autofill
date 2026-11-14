// A sheet of the fill browser. The page is a native WebView over a hole in this UI, so nothing React draws inside
// the page area is visible: sheets dock below the page instead of floating over it. The page area's
// bottom edge moves up to the sheet's top edge. Non-modal sheets (the report) leave the page usable; modal ones tell
// the screen, which lays the native scrim over the page and makes the chrome inert. Same back-key and focus rules as
// Sheet in ui.tsx.
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { useMT } from '../i18n';
import { BackStackContext, IconButton } from '../ui';

/** What a docked sheet tells the browser screen. */
export interface DockHost {
  setSheet(s: { open: boolean; modal: boolean }): void;
  /** The sheet's height in CSS px; 0 once it closes. */
  onHeight(height: number): void;
}

export const DockContext = createContext<DockHost>({ setSheet: () => undefined, onHeight: () => undefined });

interface DockedSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Confirmations and pickers: the page behind is covered by the native scrim. */
  modal?: boolean;
  /** Extra class on the panel (the report sets its own height rules). */
  className?: string;
  /** False for confirmations whose own buttons already close them (and whose confirm word may be 「关闭」). */
  closeButton?: boolean;
  children: ReactNode;
}

export function DockedSheet({ open, title, onClose, modal = false, className, closeButton = true, children }: DockedSheetProps) {
  const t = useMT();
  const backStack = useContext(BackStackContext);
  const host = useContext(DockContext);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const unregister = backStack.push(() => closeRef.current());
    const previous = document.activeElement as HTMLElement | null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      unregister();
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, backStack]);

  useEffect(() => {
    if (!open) return;
    host.setSheet({ open: true, modal });
    return () => host.setSheet({ open: false, modal: false });
  }, [open, modal, host]);

  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    let last = -1;
    const report = () => {
      const height = Math.round(el.getBoundingClientRect().height);
      if (height !== last) {
        last = height;
        host.onHeight(height);
      }
    };
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      host.onHeight(0);
    };
  }, [open, host]);

  if (!open) return null;
  return (
    <div
      ref={panel}
      className={['m-br-sheet', modal ? 'm-br-sheet--modal' : '', className ?? ''].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="m-sheet__grip" aria-hidden="true" />
      <div className="m-sheet__head">
        <h2 id={titleId} ref={heading} className="m-sheet__title" tabIndex={-1}>
          {title}
        </h2>
        {closeButton ? <IconButton icon="x-lg" label={t('m.close')} onClick={onClose} /> : null}
      </div>
      <div className="m-br-sheet__body">{children}</div>
    </div>
  );
}
