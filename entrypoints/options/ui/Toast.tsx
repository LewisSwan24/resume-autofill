// Toasts (DESIGN-SYSTEM Toast): inverted strip at the bottom centre, icon + one sentence + optional action.
// Confirmations leave after 5 s (paused while hovered or focused); errors stay until dismissed; at most 3 at once.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../../src/i18n';
import { Icon, type IconName } from '../../../src/ui/Icon';
import { IconButton, cx } from './controls';

export const TOAST_MS = 5000;
const MAX_TOASTS = 3;

export interface ToastInput {
  text: string;
  icon?: IconName;
  /** Failure: `role="alert"`, danger colours, no auto-dismiss. */
  danger?: boolean;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

export const useToast = (): ToastApi => useContext(ToastContext);

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Fade out, then drop it. Errors never time out.
  const dismiss = useCallback(() => setLeaving(true), []);
  useEffect(() => {
    if (toast.danger || paused || leaving) return;
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.danger, paused, leaving, dismiss]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onDismiss(toast.id), 160);
    return () => clearTimeout(timer);
  }, [leaving, onDismiss, toast.id]);

  return (
    <div
      className={cx('raf-toast', toast.danger && 'raf-toast--danger', leaving && 'is-leaving')}
      role={toast.danger ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={toast.icon ?? (toast.danger ? 'exclamation-triangle' : 'check-circle')} />
      <span className="raf-toast__text">{toast.text}</span>
      {toast.action ? (
        <button
          type="button"
          className="raf-toast__action"
          onClick={() => {
            toast.action!.onClick();
            dismiss();
          }}
        >
          <Icon name="arrow-counterclockwise" size={16} />
          {toast.action.label}
        </button>
      ) : null}
      <IconButton icon="x-lg" label={t('common.close')} onClick={dismiss} />
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { ...toast, id }].slice(-MAX_TOASTS));
  }, []);
  const remove = useCallback((id: number) => setToasts((list) => list.filter((item) => item.id !== id)), []);
  const api = useMemo<ToastApi>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="raf-toast-stack">
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
