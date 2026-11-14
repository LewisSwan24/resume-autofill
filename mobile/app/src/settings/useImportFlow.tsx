// Import from a file, shared by Settings, Home's empty card and onboarding. One hidden file input (the system picker
// on Android); then read, unlock when protected, preview, and merge or replace through the profile editor so
// validation, autosave and the attachment sweep all apply. Each run carries a token: closing a sheet mid-way makes a
// late result count for nothing.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Profile } from '../../../../src/schema';
import { ExportCryptoError } from '../data/exportCrypto';
import {
  IMPORT_MAX_BYTES,
  mergeInto,
  previewImport,
  readImport,
  replaceWith,
  unlockImport,
  type ImportErrorCode,
  type ImportPreview,
  type ImportRead,
} from '../data/transfer';
import { Notice, PasswordField } from '../dialogs';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { LanguageTag } from '../ResumeSwitcher';
import { readBlob, type FileStore } from '../store/fileStore';
import { emptyProfile } from '../store/profileStore';
import { Sheet, type ToastMessage } from '../ui';

export interface ImportFlowDeps {
  profile: Profile | null;
  /** Set when the profile on the phone cannot be read: an import would have nowhere to go, so it is refused. */
  loadError?: string | null;
  edit: (change: (p: Profile) => Profile, options?: { immediate?: boolean }) => void;
  files: FileStore;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  onImported?: () => void;
}

/** Only show 正在读取文件… when reading takes longer than this. */
const READING_NOTICE_MS = 300;
const ACCEPT = 'application/json,text/plain,application/octet-stream,.json';

type Step =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'password'; envelope: string; busy: boolean; wrong: boolean }
  | { kind: 'error'; code: ImportErrorCode }
  | { kind: 'blocked' }
  | { kind: 'preview'; incoming: Profile; preview: ImportPreview; fileIds: ReadonlySet<string> };

export function useImportFlow(deps: ImportFlowDeps): { start: () => void; element: ReactNode } {
  const t = useMT();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const passwordBox = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  useEffect(() => {
    const runs = run;
    return () => {
      runs.current += 1;
    };
  }, []);

  // A wrong password: the cursor goes back into the box (the error itself is announced by its alert role).
  const wrongPassword = step.kind === 'password' && step.wrong;
  useEffect(() => {
    if (wrongPassword) passwordBox.current?.focus();
  }, [wrongPassword]);

  const start = useCallback(() => {
    if (depsRef.current.loadError) {
      run.current += 1;
      setStep({ kind: 'blocked' });
      return;
    }
    input.current?.click();
  }, []);

  const close = useCallback(() => {
    run.current += 1;
    setPassword('');
    setStep({ kind: 'idle' });
  }, []);

  /** A read result (plain or unlocked) becomes the preview or an error. */
  const settle = async (result: ImportRead, token: number) => {
    if (result.kind === 'error') return setStep({ kind: 'error', code: result.code });
    if (result.kind === 'encrypted') return setStep({ kind: 'password', envelope: result.envelope, busy: false, wrong: false });
    let fileIds: ReadonlySet<string>;
    try {
      fileIds = new Set(await depsRef.current.files.list());
    } catch {
      fileIds = new Set();
    }
    if (run.current !== token) return;
    const current = depsRef.current.profile ?? emptyProfile();
    setPassword('');
    setStep({ kind: 'preview', incoming: result.profile, preview: previewImport(result.profile, current, fileIds), fileIds });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const token = ++run.current;
    const live = () => run.current === token;
    if (file.size > IMPORT_MAX_BYTES) return setStep({ kind: 'error', code: 'too_large' });
    const notice = setTimeout(() => live() && setStep({ kind: 'reading' }), READING_NOTICE_MS);
    let text: string;
    try {
      const bytes = await readBlob(file);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      clearTimeout(notice);
      if (live()) setStep({ kind: 'error', code: 'read' });
      return;
    }
    clearTimeout(notice);
    if (!live()) return;
    await settle(readImport(text), token);
  };

  const unlock = async () => {
    if (step.kind !== 'password' || step.busy) return;
    const token = ++run.current;
    const { envelope } = step;
    setStep({ kind: 'password', envelope, busy: true, wrong: false });
    try {
      const result = await unlockImport(envelope, password);
      if (run.current !== token) return;
      await settle(result, token);
    } catch (error) {
      if (run.current !== token) return;
      if (error instanceof ExportCryptoError && error.code === 'wrong_password') {
        setStep({ kind: 'password', envelope, busy: false, wrong: true });
      } else {
        setStep({ kind: 'error', code: 'bad_envelope' });
      }
    }
  };

  const apply = (mode: 'merge' | 'replace') => {
    if (step.kind !== 'preview') return;
    const { incoming, fileIds } = step;
    const { profile, edit, showToast, onImported } = depsRef.current;
    // No loaded profile (it cannot be read): edit would change nothing, so never say it was imported.
    if (!profile) {
      run.current += 1;
      setStep({ kind: 'blocked' });
      return;
    }
    const previous = profile;
    let next: Profile;
    let text: string;
    if (mode === 'merge' && previous.resumes.length > 0) {
      const merged = mergeInto(previous, incoming, fileIds, { copySuffix: t('m.import.copySuffix') });
      next = merged.profile;
      text = t('m.import.merged', { added: merged.added, skipped: merged.skipped });
    } else {
      next = replaceWith(incoming, fileIds);
      text = t('m.import.done', { n: next.resumes.length });
    }
    close();
    edit(() => next, { immediate: true });
    showToast({ text, action: { label: t('options.undo'), onClick: () => edit(() => previous, { immediate: true }) } });
    onImported?.();
  };

  const phoneCount = deps.profile?.resumes.length ?? 0;

  const element = (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        aria-label={t('m.import.title')}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void onFile(file);
        }}
      />
      <Sheet open={step.kind === 'reading'} title={t('m.import.title')} onClose={close}>
        <p className="m-sheet-text">{t('m.import.reading')}</p>
      </Sheet>
      <Sheet open={step.kind === 'password'} title={t('m.import.passwordTitle')} onClose={close}>
        {step.kind === 'password' ? (
          <form
            className="m-sheet-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <p className="m-sheet-text">{t('m.import.passwordHint')}</p>
            <PasswordField
              label={t('m.export.password')}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              error={step.wrong ? t('m.import.wrongPassword') : null}
              inputRef={passwordBox}
              autoFocus
            />
            <button type="submit" className="m-button m-button--primary m-button--wide" aria-busy={step.busy || undefined}>
              {step.busy ? t('m.import.decrypting') : t('m.import.unlock')}
            </button>
          </form>
        ) : null}
      </Sheet>
      <Sheet open={step.kind === 'error'} title={t('m.import.errTitle')} onClose={close}>
        {step.kind === 'error' ? (
          <div className="m-sheet-stack">
            <Notice tone="danger">{t(`m.import.err.${step.code}`)}</Notice>
            <button type="button" className="m-button m-button--wide" onClick={close}>
              {t('m.close')}
            </button>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={step.kind === 'blocked'} title={t('m.import.blockedTitle')} onClose={close}>
        <div className="m-sheet-stack">
          <Notice tone="danger">{t('m.import.blocked')}</Notice>
          <button type="button" className="m-button m-button--wide" onClick={close}>
            {t('m.close')}
          </button>
        </div>
      </Sheet>
      <Sheet open={step.kind === 'preview'} title={t('m.import.previewTitle')} onClose={close}>
        {step.kind === 'preview' ? <Preview preview={step.preview} phoneCount={phoneCount} onApply={apply} /> : null}
      </Sheet>
    </>
  );

  return { start, element };
}

function Preview({ preview, phoneCount, onApply }: { preview: ImportPreview; phoneCount: number; onApply: (mode: 'merge' | 'replace') => void }) {
  const t = useMT();
  if (preview.resumes.length === 0) {
    return (
      <div className="m-sheet-stack">
        <p className="m-sheet-text">{t('m.import.none')}</p>
      </div>
    );
  }
  return (
    <div className="m-sheet-stack">
      <p className="m-sheet-text">{t('m.import.count', { n: preview.resumes.length })}</p>
      <ul className="m-card m-missing">
        {preview.resumes.map((r) => (
          <li key={r.id} className="m-onb__promise">
            <span className="m-row__text">
              <span className="m-home-resume__title">
                <span>{r.title}</span>
                <LanguageTag locale={r.locale} />
              </span>
              <span className="m-row__caption">{t('m.import.filledModules', { n: r.filledModules })}</span>
            </span>
          </li>
        ))}
      </ul>
      <Notice icon="exclamation-circle">{t('m.import.noAttachments')}</Notice>
      {preview.missingAttachments > 0 ? (
        <Notice tone="warning" icon="exclamation-circle">
          {t('m.import.missingAttachments', { n: preview.missingAttachments })}
        </Notice>
      ) : null}
      {phoneCount > 0 ? (
        <>
          {preview.conflicts > 0 ? <p className="m-sheet-text">{t('m.import.conflicts', { n: preview.conflicts })}</p> : null}
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onApply('merge')}>
            <Icon name="plus-lg" />
            <span>{t('m.import.merge')}</span>
          </button>
          <p className="m-help m-help--error">
            <Icon name="exclamation-triangle" />
            <span>{t('m.import.replaceWarn', { n: phoneCount })}</span>
          </p>
          <button type="button" className="m-button m-button--danger m-button--wide" onClick={() => onApply('replace')}>
            <span>{t('m.import.replace')}</span>
          </button>
        </>
      ) : (
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onApply('replace')}>
          <Icon name="upload" />
          <span>{t('m.import.confirm')}</span>
        </button>
      )}
    </div>
  );
}
