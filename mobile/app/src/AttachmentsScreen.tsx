// The attachments module (附件): one card per slot (resume PDF, photo, transcript). An empty slot offers the phone's
// file picker; a filled one shows the file (a thumbnail for the photo) and a ⋯ menu to choose another file or delete
// it with undo. Files go to the FileStore; the resume keeps only their ids. Clearing files that no resume points at
// any more is App's job (it knows every resume), not this screen's.
import { useEffect, useRef, useState } from 'react';
import { ATTACHMENT_SLOTS, setAttachment, type AttachmentSlot } from '../../../src/editor';
import { useLanguage } from '../../../src/i18n';
import type { Resume } from '../../../src/schema';
import { formatSize, formatWhen } from '../../../entrypoints/options/format';
import { findFieldTarget, revealField, type ResumeEdit } from './fields';
import { Icon, type IconName } from './Icon';
import { useMT } from './i18n';
import type { FocusTarget } from './navigation';
import { readBlob, type FileInfo, type FileStore } from './store/fileStore';
import { IconButton, Sheet, SheetAction, type ToastMessage } from './ui';

export const MAX_ATTACHMENT_MB = 10;
const MAX_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

// Same slots, kinds and checks as the extension's entrypoints/options/Attachments.tsx (which imports the options
// page's own controls, so it is not imported here). P1 moves these into src/editor for both.
const SLOT_LABEL: Record<AttachmentSlot, string> = {
  resumeFileId: 'options.attach.resume',
  photoFileId: 'options.attach.photo',
  transcriptFileId: 'options.attach.transcript',
};
type Kind = 'pdf' | 'image' | 'pdfOrImage';
const SLOT_KIND: Record<AttachmentSlot, Kind> = { resumeFileId: 'pdf', photoFileId: 'image', transcriptFileId: 'pdfOrImage' };
const KIND_ACCEPT: Record<Kind, string> = { pdf: 'application/pdf,.pdf', image: 'image/*', pdfOrImage: 'application/pdf,image/*,.pdf' };

/** The picker's `accept` is only a hint, so check the file itself. */
export function acceptsFile(slot: AttachmentSlot, file: Pick<File, 'type' | 'name'>): boolean {
  const kind = SLOT_KIND[slot];
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/');
  return kind === 'pdf' ? isPdf : kind === 'image' ? isImage : isPdf || isImage;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Shown = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; info: FileInfo; thumb: string | null };

/** What the slot shows for a file id: its details, and for an image a thumbnail URL (revoked when no longer shown). */
function useStoredFile(files: FileStore, id: string | undefined, withThumb: boolean): Shown | null {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    if (!id) {
      setShown(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setShown({ state: 'loading' });
    (async () => {
      const info = await files.info(id);
      if (!info) return { state: 'missing' } as const;
      let thumb: string | null = null;
      if (withThumb && info.type.startsWith('image/') && typeof URL.createObjectURL === 'function') {
        const read = await files.read(id);
        if (read) thumb = URL.createObjectURL(new Blob([read.bytes as BlobPart], { type: info.type }));
      }
      return { state: 'ok', info, thumb } as const;
    })().then(
      (next) => {
        if (next.state === 'ok') url = next.thumb;
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        setShown(next);
      },
      () => !cancelled && setShown({ state: 'missing' }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [files, id, withThumb]);
  return shown;
}

/** A label that looks like a button and opens the phone's file picker (no script click, so WebViews honour it). */
function FilePicker({
  slot,
  label,
  text,
  icon,
  className,
  disabled,
  onFile,
}: {
  slot: AttachmentSlot;
  label?: string;
  text: string;
  icon: IconName;
  className: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={disabled ? `${className} m-picker m-picker--off` : `${className} m-picker`}>
      <input
        type="file"
        className="m-picker__input"
        accept={KIND_ACCEPT[SLOT_KIND[slot]]}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // choosing the same file again must fire again
          if (file) onFile(file);
        }}
      />
      <Icon name={icon} />
      <span>{text}</span>
    </label>
  );
}

interface SlotProps {
  slot: AttachmentSlot;
  resume: Resume;
  files: FileStore;
  edit: ResumeEdit;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  onStored: (id: string) => void;
  /** Read the stored resume PDF into the resume import (resume PDF slot only). */
  onReadStored?: (fileId: string, resumeId: string) => void;
}

function Slot({ slot, resume, files, edit, showToast, onStored, onReadStored }: SlotProps) {
  const t = useMT();
  const language = useLanguage();
  const fileId = resume.attachments[slot];
  const shown = useStoredFile(files, fileId, slot !== 'resumeFileId');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const label = t(SLOT_LABEL[slot]);
  const types = t(`options.attach.type.${SLOT_KIND[slot]}`);

  const upload = async (file: File) => {
    setMenu(false);
    setError(null);
    if (!acceptsFile(slot, file)) {
      setError(t('options.attach.wrongType', { types, max: MAX_ATTACHMENT_MB }));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('options.attach.tooLarge', { max: MAX_ATTACHMENT_MB }));
      return;
    }
    setBusy(true);
    try {
      const bytes = await readBlob(file);
      const stored = await files.put({ name: file.name, type: file.type || 'application/octet-stream', bytes });
      onStored(stored.id);
      edit((r) => setAttachment(r, slot, stored.id));
    } catch (e) {
      setError(t('options.attach.error', { message: messageOf(e) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    const id = fileId;
    if (!id) return;
    const name = shown?.state === 'ok' ? shown.info.name : label;
    setMenu(false);
    edit((r) => setAttachment(r, slot, null));
    showToast({
      text: t('m.deleted', { name }),
      action: { label: t('options.undo'), onClick: () => edit((r) => setAttachment(r, slot, id)) },
    });
  };

  const more = <IconButton icon="three-dots" label={t('m.more', { name: label })} onClick={() => setMenu(true)} />;

  return (
    <li className="m-card m-card--padded">
      <fieldset className="m-slot" data-slot={slot} data-field-path={`attachments.${slot}`}>
        <legend className="m-slot__label">{label}</legend>
        <p className="m-help">{t('options.attach.help', { types, max: MAX_ATTACHMENT_MB })}</p>
        {!fileId ? (
          <FilePicker
            slot={slot}
            label={`${label} – ${t('m.attach.choose')}`}
            text={t('m.attach.choose')}
            icon="upload"
            className="m-button m-button--wide"
            disabled={busy}
            onFile={(file) => void upload(file)}
          />
        ) : null}
        {fileId && shown?.state === 'ok' ? (
          <div className="m-file">
            {shown.thumb ? (
              <img className="m-file__thumb" src={shown.thumb} alt={shown.info.name} />
            ) : (
              <span className="m-row__tile">
                <Icon name={shown.info.type === 'application/pdf' ? 'file-earmark-pdf' : shown.info.type.startsWith('image/') ? 'image' : 'file-earmark-text'} />
              </span>
            )}
            <span className="m-file__text">
              <span className="m-file__name">{shown.info.name}</span>
              <span className="m-file__meta">
                {formatSize(shown.info.size)} · {formatWhen(shown.info.createdAt, language, t('options.today'))}
              </span>
            </span>
            {more}
          </div>
        ) : null}
        {fileId && slot === 'resumeFileId' && shown?.state === 'ok' && shown.info.type === 'application/pdf' && onReadStored ? (
          <button type="button" className="m-button m-button--wide" onClick={() => onReadStored(fileId, resume.id)}>
            <Icon name="file-earmark-pdf" />
            <span>{t('m.ri.fromAttachment')}</span>
          </button>
        ) : null}
        {fileId && shown?.state === 'missing' ? (
          <div className="m-file">
            <p className="m-help m-help--error m-file__text">{t('options.attach.missing', { id: fileId })}</p>
            {more}
          </div>
        ) : null}
        {busy ? <p className="m-help">{t('options.attach.uploading')}</p> : null}
        {error ? (
          <p className="m-help m-help--error" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <Sheet open={menu} title={label} onClose={() => setMenu(false)}>
        <div className="m-actions">
          <FilePicker slot={slot} text={t('m.attach.replace')} icon="arrow-repeat" className="m-action" onFile={(file) => void upload(file)} />
          <SheetAction icon="trash" label={t('m.attach.remove')} danger onClick={remove} />
        </div>
      </Sheet>
    </li>
  );
}

interface Props {
  resume: Resume;
  files: FileStore;
  edit: ResumeEdit;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** A file was just stored and is not yet in the resume: keep the sweep away from it. */
  onStored: (id: string) => void;
  /** Read the stored resume PDF into the resume import. */
  onReadStored?: (fileId: string, resumeId: string) => void;
  /** A jump from Home to a slot: put the cursor on it, then call onFocusDone. */
  focus?: FocusTarget | null;
  onFocusDone?: () => void;
}

export function AttachmentsBody({ focus, onFocusDone, ...props }: Props) {
  const t = useMT();
  const rootRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onFocusDone);
  doneRef.current = onFocusDone;
  const field = focus && focus.module === 'attachments' ? focus.field : null;
  const nonce = field === null ? null : focus!.nonce;
  useEffect(() => {
    if (nonce === null || field === null) return;
    const target = findFieldTarget(rootRef.current, `attachments.${field}`);
    if (target) revealField(target);
    doneRef.current?.();
  }, [nonce, field]);
  return (
    <div className="m-entries" ref={rootRef}>
      <ul className="m-slots">
        {ATTACHMENT_SLOTS.map((slot) => (
          <Slot key={slot} slot={slot} {...props} />
        ))}
      </ul>
      <p className="m-help">{t('m.attach.hint')}</p>
    </div>
  );
}

/** "2 uploaded" for the module list. */
export const attachedCount = (resume: Resume) => ATTACHMENT_SLOTS.filter((slot) => resume.attachments[slot]).length;
