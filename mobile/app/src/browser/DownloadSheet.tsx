// The page started a download. The in-app browser keeps no downloads: it names the file and offers the link
// to copy, except for blob: / data: files the page made on the fly, which have no link to give.
import { formatSize } from '../../../../entrypoints/options/format';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';

export interface DownloadSheetProps {
  download: { fileName: string; size: number; url: string; copyable: boolean } | null;
  onCopy: (url: string) => void;
  onClose: () => void;
}

export function DownloadSheet({ download, onCopy, onClose }: DownloadSheetProps) {
  const t = useMT();
  return (
    <DockedSheet open={download !== null} title={t('m.br.dl.title')} modal onClose={onClose}>
      {download ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">
            {t('m.br.dl.text', { name: download.fileName, size: download.size >= 0 ? formatSize(download.size) : t('m.br.dl.unknownSize') })}
          </p>
          {download.copyable ? (
            <button type="button" className="m-button m-button--wide" onClick={() => onCopy(download.url)}>
              <Icon name="copy" />
              <span>{t('m.br.copyLink')}</span>
            </button>
          ) : (
            <p className="m-notice">
              <Icon name="info-circle" />
              <span>{t('m.br.dl.blobText')}</span>
            </p>
          )}
        </div>
      ) : null}
    </DockedSheet>
  );
}
