// Shared pieces for the settings and import sheets: a yes/no sheet, a password box with a show/hide toggle, and a
// notice line. Built on the Sheet and IconButton from ui.tsx.
import { useId, useState, type ReactNode, type Ref } from 'react';
import { Icon, type IconName } from './Icon';
import { useMT } from './i18n';
import { IconButton, Sheet } from './ui';

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  text: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmSheet({ open, title, text, confirmLabel, cancelLabel, danger, busy, onConfirm, onClose }: ConfirmSheetProps) {
  const t = useMT();
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="m-sheet-stack">
        {typeof text === 'string' ? <p className="m-sheet-text">{text}</p> : text}
        <button
          type="button"
          className={danger ? 'm-button m-button--danger m-button--wide' : 'm-button m-button--primary m-button--wide'}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button type="button" className="m-button m-button--wide" onClick={onClose}>
          {cancelLabel ?? t('common.cancel')}
        </button>
      </div>
    </Sheet>
  );
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'new-password' | 'current-password';
  error?: string | null;
  autoFocus?: boolean;
  /** So a screen can put the cursor back here when the value needs fixing. */
  inputRef?: Ref<HTMLInputElement>;
}

export function PasswordField({ label, value, onChange, autoComplete, error, autoFocus, inputRef }: PasswordFieldProps) {
  const t = useMT();
  const id = useId();
  const errorId = `${id}-error`;
  const [shown, setShown] = useState(false);
  return (
    <div className="m-field">
      <label className="m-label" htmlFor={id}>
        {label}
      </label>
      <div className="m-password">
        <input
          ref={inputRef}
          id={id}
          className="m-input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <IconButton
          icon={shown ? 'eye-slash' : 'eye'}
          label={shown ? t('m.export.hidePassword') : t('m.export.showPassword')}
          onClick={() => setShown((s) => !s)}
        />
      </div>
      {error ? (
        <p className="m-help m-help--error" id={errorId} role="alert">
          <Icon name="exclamation-triangle" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warning' | 'danger'; icon?: IconName; children: ReactNode }) {
  const className = tone === 'info' ? 'm-notice' : `m-notice m-notice--${tone}`;
  const glyph: IconName = icon ?? (tone === 'info' ? 'info-circle' : tone === 'warning' ? 'exclamation-circle' : 'exclamation-triangle');
  return (
    <p className={className} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={glyph} />
      <span>{children}</span>
    </p>
  );
}
