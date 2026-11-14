// Small building blocks of the mobile page: the back-key stack, the bottom sheet, the toast, icon buttons and the
// save status. Lively Icons on a phone: overlays rise from the bottom, 1px line, no shadow, the page fades to scrim.
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useMT } from './i18n';
import type { SaveStatus } from './useProfileEditor';

// ------------------------------------------------------------------ back key

/** Open layers (sheets) register a close handler; the Android back key closes the newest one first. */
export interface BackStack {
  push(close: () => void): () => void;
  /** Close the newest layer. False when nothing was open. */
  pop(): boolean;
}

export function createBackStack(): BackStack {
  const layers: Array<() => void> = [];
  return {
    push(close) {
      layers.push(close);
      return () => {
        const i = layers.lastIndexOf(close);
        if (i >= 0) layers.splice(i, 1);
      };
    },
    pop() {
      const close = layers.pop();
      if (!close) return false;
      close();
      return true;
    },
  };
}

export const BackStackContext = createContext<BackStack>(createBackStack());

// ------------------------------------------------------------------ sheet

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet: a modal dialog rising from the bottom edge. Scrim tap, Esc and the back key close it. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const t = useMT();
  const backStack = useContext(BackStackContext);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const unregister = backStack.push(() => closeRef.current());
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      unregister();
      previous?.focus?.();
    };
  }, [open, backStack]);

  if (!open) return null;
  return (
    <div className="m-sheet-layer">
      <div className="m-scrim" onClick={onClose} />
      <div
        ref={panel}
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="m-sheet__grip" aria-hidden="true" />
        <div className="m-sheet__head">
          <h2 id={titleId} className="m-sheet__title">
            {title}
          </h2>
          <IconButton icon="x-lg" label={t('m.close')} onClick={onClose} />
        </div>
        <div className="m-sheet__body">{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ buttons

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** 44px touch target, 24px glyph; the label is the accessible name. */
export function IconButton({ icon, label, onClick, disabled, danger }: IconButtonProps) {
  return (
    <button
      type="button"
      className={danger ? 'm-icon-button m-icon-button--danger' : 'm-icon-button'}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A full-width row in a sheet: icon and words. */
export function SheetAction({ icon, label, onClick, danger }: Omit<IconButtonProps, 'disabled'>) {
  return (
    <button type="button" className={danger ? 'm-action m-action--danger' : 'm-action'} onClick={onClick}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

// ------------------------------------------------------------------ toast

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}

/** Reversed to `ink`, so it stands out without a shadow. */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, 8000);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  return (
    <div className="m-toast-region" role="status" aria-live="polite">
      {toast ? (
        <div className="m-toast" key={toast.id}>
          <span className="m-toast__text">{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="m-toast__action"
              onClick={() => {
                toast.action!.onClick();
                onDone();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ save status

export function SaveStatusLine({ status }: { status: SaveStatus }) {
  const t = useMT();
  const shown: { text: string; icon: IconName | null } | null =
    status === 'saved'
      ? { text: t('options.allSaved'), icon: 'check-lg' }
      : status === 'pending' || status === 'saving'
        ? { text: t('options.saving'), icon: null }
        : status === 'invalid'
          ? { text: t('options.needsLook'), icon: 'exclamation-triangle' }
          : status === 'error'
            ? { text: t('options.saveFailed'), icon: 'exclamation-triangle' }
            : null;
  return (
    <p className="m-status" aria-live="polite">
      {shown ? (
        <>
          {shown.icon ? <Icon name={shown.icon} /> : null}
          <span>{shown.text}</span>
        </>
      ) : null}
    </p>
  );
}
