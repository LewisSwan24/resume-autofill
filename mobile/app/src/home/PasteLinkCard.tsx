// Home, block B: paste an application link. While typing it says which site will open; errors wait for a submit.
// A valid link is recorded in the tracker and opens in the fill browser (App's openLink). The 粘贴链接 launcher
// shortcut focuses the box and, because the person asked to paste, fills it once from the clipboard (not opened).
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../Icon';
import { KeyboardHint } from '../keyboard/KeyboardHint';
import { wechatOnlyReason } from '../keyboard/wechatHint';
import { useMT } from '../i18n';
import { IconButton, type ToastMessage } from '../ui';
import { parseApplicationLink, parseApplicationLinks, type ParsedLink, type PasteError } from './pasteLink';

const PREVIEW_DELAY_MS = 150;

export interface PasteLinkCardProps {
  /** Save the link to recent pages and open it in the fill browser (it opens even when saving failed). */
  onOpen: (link: Extract<ParsedLink, { ok: true }>) => Promise<void>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** A new nonce focuses the box once; `read` also fills it from the clipboard (the shortcut, not 去粘贴链接). */
  focusRequest?: PasteFocusRequest | null;
  /** ClipboardPeek.readText(): the text, or null. */
  readClipboard?: () => Promise<string | null>;
  onFocusDone?: () => void;
  /** Opens the resume keyboard's setup screen; absent without the plugin, which hides the WeChat hint. */
  onKeyboardSetup?: () => void;
}

export interface PasteFocusRequest {
  nonce: number;
  read: boolean;
}

const canReadClipboard = () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

export function PasteLinkCard({ onOpen, showToast, focusRequest, readClipboard, onFocusDone, onKeyboardSetup }: PasteLinkCardProps) {
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
      await onOpen(parsed);
      setValue('');
      setPreview(null);
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

  const handled = useRef<number | null>(null);
  const latest = useRef({ readClipboard, onFocusDone });
  latest.current = { readClipboard, onFocusDone };
  const requestNonce = focusRequest?.nonce ?? null;
  const requestRead = focusRequest?.read ?? false;
  useEffect(() => {
    if (requestNonce === null || handled.current === requestNonce) return;
    handled.current = requestNonce;
    const field = input.current;
    field?.scrollIntoView?.({ block: 'center' });
    field?.focus();
    const { readClipboard: read, onFocusDone: done } = latest.current;
    done?.();
    if (!requestRead || !read) return;
    void read()
      .then((text) => {
        const link = text ? parseApplicationLinks(text, 1)[0] : undefined;
        if (link && handled.current === requestNonce) {
          change(link.url);
          input.current?.focus();
        }
      })
      .catch(() => undefined);
  }, [requestNonce, requestRead]);

  const shown = preview?.ok ? preview : null;
  // Live as the text changes; only links WeChat alone can open.
  const wechat = useMemo(() => (onKeyboardSetup && value.trim() ? wechatOnlyReason(value) : null), [onKeyboardSetup, value]);
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
        {wechat && onKeyboardSetup ? <KeyboardHint reason={wechat} onSetup={onKeyboardSetup} /> : null}
      </form>
    </section>
  );
}
