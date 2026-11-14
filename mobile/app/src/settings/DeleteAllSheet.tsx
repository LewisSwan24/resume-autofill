// Delete everything on this phone: names what goes (resume titles, file count, recent pages, settings) before the
// one danger button. The wipe itself is App's (flush, wipe, remount); this sheet only asks and shows progress.
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../../../src/i18n';
import type { Profile } from '../../../../src/schema';
import { Notice } from '../dialogs';
import { useMT } from '../i18n';
import type { FileStore } from '../store/fileStore';
import { Sheet } from '../ui';

const NAMED = 3;

export interface DeleteAllSheetProps {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
  /** The stored profile cannot be read: it is still on the phone and is deleted too. */
  loadError?: string | null;
  files: FileStore;
  recentCount: number;
  onExportFirst: () => void;
  onWipe: () => Promise<boolean>;
}

export function DeleteAllSheet(props: DeleteAllSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.wipe.title')} onClose={props.onClose}>
      <DeleteAllBody {...props} />
    </Sheet>
  );
}

function DeleteAllBody({ onClose, profile, loadError, files, recentCount, onExportFirst, onWipe }: DeleteAllSheetProps) {
  const t = useMT();
  const language = useLanguage();
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    files
      .list()
      .then((ids) => alive.current && setFileCount(ids.length))
      .catch(() => alive.current && setFileCount(null));
    return () => {
      alive.current = false;
    };
  }, [files]);

  const resumes = profile?.resumes ?? [];
  const resumeLine = (() => {
    if (!profile && loadError) return t('m.wipe.resumesUnreadable');
    if (resumes.length === 0) return t('m.wipe.resumesNone');
    const names = resumes.slice(0, NAMED).map((r) => r.title);
    let joined = names.join(language === 'zh' ? '、' : ', ');
    const rest = resumes.length - names.length;
    if (rest > 0) joined += `${language === 'zh' ? '，' : ' '}${t('m.wipe.resumesMore', { n: rest })}`;
    return t('m.wipe.resumes', { n: resumes.length, names: joined });
  })();

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onWipe().catch(() => false);
    if (!alive.current) return;
    setBusy(false);
    if (ok) onClose();
    else setFailed(true);
  };

  return (
    <div className="m-sheet-stack">
      <p className="m-sheet-text">{t('m.wipe.lead')}</p>
      <ul className="m-sheet-list">
        <li>{resumeLine}</li>
        {fileCount !== null ? <li>{t('m.wipe.files', { n: fileCount })}</li> : null}
        <li>{t('m.wipe.recent', { n: recentCount })}</li>
        <li>{t('m.wipe.settings')}</li>
      </ul>
      <Notice tone="danger" icon="exclamation-triangle">
        {t('m.wipe.irreversible')}
      </Notice>
      {failed ? <Notice tone="danger">{t('m.wipe.failed')}</Notice> : null}
      <button
        type="button"
        className="m-button m-button--danger m-button--wide"
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => void confirm()}
      >
        {busy ? t('m.wipe.working') : t('m.wipe.confirm')}
      </button>
      <button type="button" className="m-button m-button--wide" disabled={busy} onClick={onExportFirst}>
        {t('m.wipe.exportFirst')}
      </button>
      <button type="button" className="m-button m-button--wide" onClick={onClose}>
        {t('common.cancel')}
      </button>
    </div>
  );
}
