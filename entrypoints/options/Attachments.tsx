// Attachment slots (resume PDF, photo, transcript): a drop zone per slot that states its limits up front,
// the uploaded file as a list row (name, size · date, delete), and the error text under the zone.
import { useEffect, useId, useState } from 'react';
import { ATTACHMENT_SLOTS, type AttachmentSlot } from '../../src/editor';
import { useLanguage, useT } from '../../src/i18n';
import type { Resume } from '../../src/schema';
import { getFile } from '../../src/storage';
import { formatSize, formatWhen } from './format';
import { IconButton, ListItem, Progress } from './ui/controls';
import { FileUpload } from './ui/FileUpload';

export const MAX_ATTACHMENT_MB = 10;

const SLOT_LABEL: Record<AttachmentSlot, string> = {
  resumeFileId: 'options.attach.resume',
  photoFileId: 'options.attach.photo',
  transcriptFileId: 'options.attach.transcript',
};

type TypeKind = 'pdf' | 'image' | 'pdfOrImage';
const SLOT_KIND: Record<AttachmentSlot, TypeKind> = {
  resumeFileId: 'pdf',
  photoFileId: 'image',
  transcriptFileId: 'pdfOrImage',
};
const KIND_ACCEPT: Record<TypeKind, string> = {
  pdf: 'application/pdf,.pdf',
  image: 'image/*',
  pdfOrImage: 'application/pdf,image/*,.pdf',
};

/** i18n key of the "PDF" / "image" / "PDF or image" words for a slot. */
export const slotTypeKey = (slot: AttachmentSlot) => `options.attach.type.${SLOT_KIND[slot]}` as const;

/** The picker's `accept` is only a hint (and ignored by drag and drop), so check the file itself. */
export function acceptsFile(slot: AttachmentSlot, file: Pick<File, 'type' | 'name'>): boolean {
  const kind = SLOT_KIND[slot];
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/');
  return kind === 'pdf' ? isPdf : kind === 'image' ? isImage : isPdf || isImage;
}

type FileInfo = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; name: string; size: number; createdAt: number };

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
      (rec) => !cancelled && setInfo(rec ? { state: 'ok', name: rec.name, size: rec.size, createdAt: rec.createdAt } : { state: 'missing' }),
      () => !cancelled && setInfo({ state: 'missing' }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  return info;
}

interface SlotProps {
  slot: AttachmentSlot;
  fileId: string | undefined;
  error: string | null;
  busy: boolean;
  onUpload: (slot: AttachmentSlot, file: File) => void;
  onRemove: (slot: AttachmentSlot) => void;
}

function Slot({ slot, fileId, error, busy, onUpload, onRemove }: SlotProps) {
  const t = useT();
  const language = useLanguage();
  const info = useFileInfo(fileId);
  const label = t(SLOT_LABEL[slot]);
  const inputId = useId();

  return (
    <li>
      <fieldset className="raf-slot" data-slot={slot}>
        <legend className="raf-field__label">{label}</legend>
        <FileUpload
          id={inputId}
          label={`${label} – ${t('options.attach.upload')}`}
          accept={KIND_ACCEPT[SLOT_KIND[slot]]}
          title={t('options.attach.dropTitle')}
          help={t('options.attach.help', { types: t(slotTypeKey(slot)), max: MAX_ATTACHMENT_MB })}
          error={error}
          disabled={busy}
          onFile={(file) => onUpload(slot, file)}
        />
        {busy ? <Progress label={t('options.attach.uploading')} /> : null}
        {fileId && info?.state === 'ok' ? (
          <ListItem
            icon="file-earmark-text"
            title={info.name}
            meta={`${formatSize(info.size)} · ${formatWhen(info.createdAt, language, t('options.today'))}`}
          >
            <IconButton icon="trash" label={`${label} – ${t('options.attach.remove')}`} danger onClick={() => onRemove(slot)} />
          </ListItem>
        ) : null}
        {fileId && info?.state === 'missing' ? (
          <ListItem icon="file-earmark-text" title={<span className="raf-error-text">{t('options.attach.missing', { id: fileId })}</span>}>
            <IconButton icon="trash" label={`${label} – ${t('options.attach.remove')}`} danger onClick={() => onRemove(slot)} />
          </ListItem>
        ) : null}
      </fieldset>
    </li>
  );
}

interface Props {
  resume: Resume;
  errors: Partial<Record<AttachmentSlot, string>>;
  busy: Partial<Record<AttachmentSlot, boolean>>;
  onUpload: (slot: AttachmentSlot, file: File) => void;
  onRemove: (slot: AttachmentSlot) => void;
}

export function Attachments({ resume, errors, busy, onUpload, onRemove }: Props) {
  const t = useT();
  return (
    <div className="raf-attachments">
      <ul className="raf-list raf-list--loose">
        {ATTACHMENT_SLOTS.map((slot) => (
          <Slot key={slot} slot={slot} fileId={resume.attachments[slot]} error={errors[slot] ?? null} busy={busy[slot] === true} onUpload={onUpload} onRemove={onRemove} />
        ))}
      </ul>
      <p className="raf-field__help">{t('options.attach.hint')}</p>
    </div>
  );
}
