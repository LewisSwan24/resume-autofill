// Attachment slots (resume PDF, photo, transcript): upload to the file store, show name, remove.
import { useEffect, useState } from 'react';
import { ATTACHMENT_SLOTS, type AttachmentSlot } from '../../src/editor';
import { useT } from '../../src/i18n';
import type { Resume } from '../../src/schema';
import { getFile } from '../../src/storage';

export const MAX_ATTACHMENT_MB = 10;

const SLOT_LABEL: Record<AttachmentSlot, string> = {
  resumeFileId: 'options.attach.resume',
  photoFileId: 'options.attach.photo',
  transcriptFileId: 'options.attach.transcript',
};
const SLOT_ACCEPT: Record<AttachmentSlot, string> = {
  resumeFileId: 'application/pdf,.pdf',
  photoFileId: 'image/*',
  transcriptFileId: 'application/pdf,image/*,.pdf',
};

type FileInfo = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; name: string; size: number };

function useFileInfo(id: string | undefined): FileInfo | null {
  const [info, setInfo] = useState<FileInfo | null>(null);
  useEffect(() => {
    if (!id) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setInfo({ state: 'loading' });
    getFile(id).then(
      (rec) => !cancelled && setInfo(rec ? { state: 'ok', name: rec.name, size: rec.size } : { state: 'missing' }),
      () => !cancelled && setInfo({ state: 'missing' }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  return info;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

interface SlotProps {
  slot: AttachmentSlot;
  fileId: string | undefined;
  error: string | null;
  onUpload: (slot: AttachmentSlot, file: File) => void;
  onRemove: (slot: AttachmentSlot) => void;
}

function Slot({ slot, fileId, error, onUpload, onRemove }: SlotProps) {
  const t = useT();
  const info = useFileInfo(fileId);
  const label = t(SLOT_LABEL[slot]);

  return (
    <li className="raf-attach" data-slot={slot}>
      <span className="raf-label">{label}</span>
      <span className="raf-attach-file">
        {!fileId ? (
          <span className="raf-muted">{t('options.attach.none')}</span>
        ) : info?.state === 'ok' ? (
          <span>
            {info.name} <small className="raf-muted">({formatSize(info.size)})</small>
          </span>
        ) : info?.state === 'missing' ? (
          <span className="raf-error">{t('options.attach.missing', { id: fileId })}</span>
        ) : (
          <span className="raf-muted">…</span>
        )}
      </span>
      <span className="raf-attach-actions">
        <label className="raf-button">
          {fileId ? t('options.attach.replace') : t('options.attach.upload')}
          <input
            type="file"
            hidden
            accept={SLOT_ACCEPT[slot]}
            aria-label={`${label} – ${t('options.attach.upload')}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onUpload(slot, file);
            }}
          />
        </label>
        {fileId ? (
          <button type="button" className="raf-danger" aria-label={`${label} – ${t('options.attach.remove')}`} onClick={() => onRemove(slot)}>
            ✕ {t('options.attach.remove')}
          </button>
        ) : null}
      </span>
      {error ? <small className="raf-error raf-attach-error">{error}</small> : null}
    </li>
  );
}

interface Props {
  resume: Resume;
  errors: Partial<Record<AttachmentSlot, string>>;
  onUpload: (slot: AttachmentSlot, file: File) => void;
  onRemove: (slot: AttachmentSlot) => void;
}

export function Attachments({ resume, errors, onUpload, onRemove }: Props) {
  const t = useT();
  return (
    <div>
      <ul className="raf-attachments">
        {ATTACHMENT_SLOTS.map((slot) => (
          <Slot key={slot} slot={slot} fileId={resume.attachments[slot]} error={errors[slot] ?? null} onUpload={onUpload} onRemove={onRemove} />
        ))}
      </ul>
      <p className="raf-muted">{t('options.attach.hint')}</p>
    </div>
  );
}
