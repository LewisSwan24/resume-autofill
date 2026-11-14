// Page info: the host in full, the whole URL, whether the connection is encrypted, a note when the host is
// shown as punycode, whether filling runs isolated from the page, and copy / open in the phone's browser / reload.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { SheetAction } from '../ui';
import { DockedSheet } from './DockedSheet';
import type { DisplayHost } from './model/displayHost';

export interface PageInfoSheetProps {
  open: boolean;
  url: string;
  host: DisplayHost;
  /** The page was refused for its certificate: never say 加密连接 then. */
  certProblem?: boolean;
  /** Null until the page WebView has said. */
  isolated: boolean | null;
  onCopy: () => void;
  onOpenSystem: () => void;
  onReload: () => void;
  onClose: () => void;
}

export function PageInfoSheet({ open, url, host, certProblem, isolated, onCopy, onOpenSystem, onReload, onClose }: PageInfoSheetProps) {
  const t = useMT();
  const web = /^https?:/i.test(url) && host.kind !== 'demo';
  return (
    <DockedSheet open={open} title={t('m.br.pageInfoTitle')} modal onClose={onClose}>
      <div className="m-sheet-stack">
        <p className="m-br-info__host">{host.kind === 'demo' ? t('m.br.demoHost') : host.host}</p>
        <p className="m-url">{url}</p>
        {certProblem && host.kind !== 'demo' ? (
          <p className="m-notice m-notice--warning">
            <Icon name="shield-exclamation" />
            <span>{t('m.br.certProblem')}</span>
          </p>
        ) : host.kind === 'secure' ? (
          <p className="m-notice">
            <Icon name="lock" />
            <span>{t('m.br.secure')}</span>
          </p>
        ) : host.kind === 'insecure' ? (
          <p className="m-notice m-notice--warning">
            <Icon name="exclamation-triangle" />
            <span>
              <strong>{t('m.br.insecure')}</strong> {t('m.br.insecureText')}
            </span>
          </p>
        ) : (
          <p className="m-notice">
            <Icon name="play-circle" />
            <span>{t('m.br.demoHost')}</span>
          </p>
        )}
        {host.punycode ? (
          <p className="m-notice">
            <Icon name="info-circle" />
            <span>{t('m.br.punycode')}</span>
          </p>
        ) : null}
        {isolated !== null ? (
          <p className={isolated ? 'm-notice' : 'm-notice m-notice--warning'}>
            <Icon name={isolated ? 'shield' : 'exclamation-circle'} />
            <span>{t(isolated ? 'm.br.isolation.on' : 'm.br.isolation.off')}</span>
          </p>
        ) : null}
        <div className="m-actions">
          <SheetAction icon="copy" label={t('m.br.copyLink')} onClick={onCopy} />
          {web ? <SheetAction icon="box-arrow-up-right" label={t('m.br.openSystem')} onClick={onOpenSystem} /> : null}
          <SheetAction icon="arrow-clockwise" label={t('m.br.reload')} onClick={onReload} />
        </div>
      </div>
    </DockedSheet>
  );
}
