// Export everything to a file: plain JSON the desktop extension reads, or the same text sealed with a password.
// It exports what is stored (pending edits are saved first), never an unsaved value on screen. Passwords live only in
// this sheet's state and are gone when it closes.
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../../../src/schema';
import { buildExport, PASSWORD_MIN_LENGTH } from '../data/transfer';
import { Notice, PasswordField } from '../dialogs';
import { useMT } from '../i18n';
import { Sheet, type ToastMessage } from '../ui';

export type SaveDocument = (file: { name: string; mimeType: string; bytes: Uint8Array }) => Promise<'saved' | 'cancelled'>;

export interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  /** The profile on screen: only used to count resumes. */
  profile: Profile | null;
  readStoredProfile: () => Promise<Profile>;
  saveDocument?: SaveDocument;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  now?: () => number;
}

export function ExportSheet(props: ExportSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.export.title')} onClose={props.onClose}>
      <ExportBody {...props} />
    </Sheet>
  );
}

type Phase = 'idle' | 'encrypting' | 'saving';
/** What went wrong, so the notice says what can help: reading the stored data, no saver at all, or the file itself. */
type Failure = 'read' | 'unavailable' | 'save';
const FAILURE_KEY = { read: 'm.export.failedRead', unavailable: 'm.export.unavailable', save: 'm.export.failed' } as const;

function ExportBody({ onClose, profile, readStoredProfile, saveDocument, showToast, now = Date.now }: ExportSheetProps) {
  const t = useMT();
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<{ first?: string; second?: string }>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [failed, setFailed] = useState<Failure | null>(null);
  const firstBox = useRef<HTMLInputElement>(null);
  const secondBox = useRef<HTMLInputElement>(null);
  /** Bumped when the sheet goes away, so a late result is ignored. */
  const run = useRef(0);
  useEffect(() => {
    const runs = run;
    return () => {
      runs.current += 1;
    };
  }, []);

  const count = profile?.resumes.length ?? 0;

  const start = async () => {
    if (phase !== 'idle' || count === 0) return;
    setFailed(null);
    let secret: string | undefined;
    if (usePassword) {
      // The error is announced (alert role); the cursor goes to the box that needs fixing.
      const length = [...password.normalize('NFC')].length;
      if (length < PASSWORD_MIN_LENGTH) {
        setErrors({ first: t('m.export.pwTooShort') });
        firstBox.current?.focus();
        return;
      }
      if (password !== again) {
        setErrors({ second: t('m.export.pwMismatch') });
        secondBox.current?.focus();
        return;
      }
      secret = password;
    }
    setErrors({});
    const token = ++run.current;
    const alive = () => run.current === token;
    let stage: Failure = 'read';
    try {
      setPhase('encrypting');
      const stored = await readStoredProfile();
      const file = await buildExport(stored, { password: secret, now: now() });
      if (!alive()) return;
      stage = 'unavailable';
      if (!saveDocument) throw new Error('no saver');
      stage = 'save';
      setPhase('saving');
      const result = await saveDocument({ name: file.name, mimeType: file.mimeType, bytes: new TextEncoder().encode(file.text) });
      if (!alive()) return;
      setPhase('idle');
      if (result === 'saved') {
        setPassword('');
        setAgain('');
        onClose();
        showToast({ text: t('m.export.done') });
      }
    } catch {
      if (!alive()) return;
      setPhase('idle');
      setFailed(stage);
    }
  };

  const label = phase === 'encrypting' ? t('m.export.encrypting') : phase === 'saving' ? t('m.export.saving') : t('m.export.save');
  return (
    <div className="m-sheet-stack">
      {count === 0 ? (
        <p className="m-sheet-text">{t('m.export.nothing')}</p>
      ) : (
        <>
          <p className="m-sheet-text">{t('m.export.contents', { n: count })}</p>
          <Notice tone="warning" icon="exclamation-circle">
            {t('m.export.noAttachments')}
          </Notice>
          <Notice icon="lock">{t('m.export.unprotected')}</Notice>
          <label className="m-check">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => {
                setUsePassword(e.target.checked);
                setErrors({});
              }}
            />
            <span>{t('m.export.usePassword')}</span>
          </label>
          {usePassword ? (
            <>
              <PasswordField label={t('m.export.password')} value={password} onChange={setPassword} autoComplete="new-password" error={errors.first} inputRef={firstBox} />
              <PasswordField label={t('m.export.passwordAgain')} value={again} onChange={setAgain} autoComplete="new-password" error={errors.second} inputRef={secondBox} />
              <p className="m-help m-row__caption">{t('m.export.pwNote')}</p>
            </>
          ) : null}
        </>
      )}
      {failed ? <Notice tone="danger">{t(FAILURE_KEY[failed])}</Notice> : null}
      <button
        type="button"
        className="m-button m-button--primary m-button--wide"
        disabled={count === 0}
        aria-busy={phase !== 'idle' || undefined}
        onClick={() => void start()}
      >
        {label}
      </button>
    </div>
  );
}
