// Home, block B: paste an application link. While typing it says which site will open; errors wait for a submit.
// A valid link goes to the recent pages list (the built-in fill browser comes in a later version).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { IconButton, type ToastMessage } from '../ui';
import { parseApplicationLink, type ParsedLink, type PasteError } from './pasteLink';

const PREVIEW_DELAY_MS = 150;

export interface PasteLinkCardProps {
  /** Store the link; resolves false when saving failed (the caller has said so). */
  onSave: (link: Extract<ParsedLink, { ok: true }>) => Promise<boolean>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

const canReadClipboard = () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

export function PasteLinkCard({ onSave, showToast }: PasteLinkCardProps) {
  const t = useMT();
  const id = useId();
  const liveId = `${id}-live`;
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<ParsedLink | null>(null);
  const [error, setError] = useState<PasteError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setPreview(value.trim() ? parseApplicationLink(value) : null), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const change = (next: string) => {
    setValue(next);
    setError(null);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const parsed = parseApplicationLink(value);
    if (!parsed.ok) {
      setError(parsed.code);
      input.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (await onSave(parsed)) {
        setValue('');
        setPreview(null);
        showToast({ text: t('m.paste.saved') });
      }
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      change(text);
      input.current?.focus();
    } catch {
      showToast({ text: t('m.paste.clipboardFailed') });
    }
  };

  const shown = preview?.ok ? preview : null;
  return (
    <section className="m-card m-card--padded m-paste">
      <h2>
        <Icon name="link-45deg" />
        <span>{t('m.paste.title')}</span>
      </h2>
      <form className="m-field" onSubmit={(e) => void submit(e)} noValidate>
        <label className="m-label" htmlFor={id}>
          {t('m.paste.label')}
        </label>
        <div className="m-paste__row">
          <input
            ref={input}
            id={id}
            className="m-input"
            type="url"
            inputMode="url"
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t('m.paste.placeholder')}
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${liveId}` : liveId}
            onChange={(e) => change(e.target.value)}
          />
          {canReadClipboard() ? <IconButton icon="clipboard" label={t('m.paste.fromClipboard')} onClick={() => void paste()} /> : null}
          <button type="submit" className="m-button m-button--primary" aria-busy={busy || undefined}>
            {t('m.paste.open')}
          </button>
        </div>
        {error ? (
          <p className="m-help m-help--error" id={errorId}>
            <Icon name="exclamation-triangle" />
            <span>{t(`m.paste.err.${error}`)}</span>
          </p>
        ) : null}
        <div className="m-paste__live" id={liveId} aria-live="polite">
          {shown && !error ? (
            <>
              <span>{t('m.paste.willOpen', { host: shown.host })}</span>
              {shown.insecure ? (
                <span className="m-help">
                  <Icon name="exclamation-circle" />
                  <span>{t('m.paste.insecure')}</span>
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </form>
    </section>
  );
}
