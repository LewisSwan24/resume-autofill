// The page's <input type=file>: the fill resume's stored attachments that match `accept`, or the phone's
// own picker. Every way of closing answers "cancel", so the page's input is always released.
import { formatSize } from '../../../../entrypoints/options/format';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import type { FileInfo } from '../store/fileStore';
import { SheetAction } from '../ui';
import { DockedSheet } from './DockedSheet';
import { MAX_FILE_BYTES } from './model/constants';

/** Does a stored file match an accept list ("image/*", "application/pdf", ".pdf")? An empty list matches all. */
export function matchesAccept(file: Pick<FileInfo, 'name' | 'type'>, accept: readonly string[]): boolean {
  const rules = accept
    .flatMap((a) => a.split(','))
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

const KNOWN: Record<string, string> = {
  'application/pdf': 'PDF',
  '.pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  '.doc': 'Word',
  '.docx': 'Word',
  'image/jpeg': 'JPG',
  '.jpg': 'JPG',
  '.jpeg': 'JPG',
  'text/plain': 'TXT',
};

/** File kinds a person knows (「PDF」「图片」「Word」) for an accept list, each once, in order; never MIME jargon when avoidable. */
export function acceptLabels(accept: readonly string[], t: (key: string) => string): string[] {
  const labels: string[] = [];
  for (const raw of accept.flatMap((a) => a.split(','))) {
    const rule = raw.trim().toLowerCase();
    if (!rule) continue;
    let label = KNOWN[rule];
    if (!label && rule === 'image/*') label = t('m.br.file.images');
    if (!label && rule.startsWith('.')) label = rule.slice(1).toUpperCase();
    if (!label) {
      const sub = rule.slice(rule.indexOf('/') + 1);
      label = rule.includes('/') && /^[a-z0-9]{1,5}$/.test(sub) ? sub.toUpperCase() : raw.trim();
    }
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

const iconFor = (file: Pick<FileInfo, 'type' | 'name'>): IconName =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'file-earmark-pdf' : file.type.startsWith('image/') ? 'image' : 'file-earmark-text';

export interface FileChooserSheetProps {
  request: { id: number; accept: string[]; multiple: boolean } | null;
  /** Stored attachments of the fill resume that match `accept`; null while they are being looked up. */
  files: FileInfo[] | null;
  onPick: (fileId: string) => void;
  onSystem: () => void;
  onCancel: () => void;
}

export function FileChooserSheet({ request, files, onPick, onSystem, onCancel }: FileChooserSheetProps) {
  const t = useMT();
  const accepts = request ? acceptLabels(request.accept, (key) => t(key)) : [];
  return (
    <DockedSheet open={request !== null} title={t('m.br.file.title')} modal onClose={onCancel}>
      <div className="m-sheet-stack">
        {accepts.length > 0 ? <p className="m-help">{t('m.br.file.accepts', { types: accepts.join(t('m.br.file.typesJoin')) })}</p> : null}
        <h3 className="m-br-subtitle">{t('m.br.file.stored')}</h3>
        {files === null ? null : files.length === 0 ? (
          <p className="m-empty">{t('m.br.file.noneStored')}</p>
        ) : (
          <ul className="m-br-files">
            {files.map((f) => {
              const tooBig = f.size > MAX_FILE_BYTES;
              return (
                <li key={f.id}>
                  <button type="button" className="m-br-file" disabled={tooBig} onClick={() => onPick(f.id)}>
                    <Icon name={iconFor(f)} />
                    <span className="m-row__text">
                      <span className="m-row__name">{f.name}</span>
                      <span className="m-row__caption">{tooBig ? t('m.br.file.tooBig') : formatSize(f.size)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="m-actions">
          <SheetAction icon="folder2-open" label={t('m.br.file.system')} onClick={onSystem} />
        </div>
        <button type="button" className="m-button m-button--wide" onClick={onCancel}>
          {t('m.br.cancel')}
        </button>
      </div>
    </DockedSheet>
  );
}
