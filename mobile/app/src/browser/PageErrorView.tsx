// A page that could not load, drawn by React in the page area while native hides the page view. An SSL
// error offers exactly 重试 and 关闭: no "continue anyway", no details link.
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';

export type PageErrorKind = 'offline' | 'dns' | 'timeout' | 'ssl' | 'crashed' | 'generic';

const ICONS: Record<PageErrorKind, IconName> = {
  offline: 'wifi-off',
  dns: 'question-circle',
  timeout: 'exclamation-triangle',
  ssl: 'shield-exclamation',
  crashed: 'exclamation-triangle',
  generic: 'exclamation-triangle',
};

export interface PageErrorViewProps {
  error: { kind: PageErrorKind; host: string };
  onRetry: () => void;
  onClose: () => void;
  /** Only the DNS error offers to copy the link. */
  onCopy: () => void;
}

export function PageErrorView({ error, onRetry, onClose, onCopy }: PageErrorViewProps) {
  const t = useMT();
  const { kind, host } = error;
  return (
    <div className="m-br-error" role="alert">
      <span className="m-br-error__tile">
        <Icon name={ICONS[kind]} />
      </span>
      <h2 className="m-br-error__title">{t(`m.br.err.${kind}.title`)}</h2>
      <p className="m-br-error__text">{t(`m.br.err.${kind}.text`, { host })}</p>
      <div className="m-br-error__actions">
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={onRetry}>
          <Icon name="arrow-clockwise" />
          <span>{t(kind === 'crashed' ? 'm.br.err.reopen' : 'm.br.err.retry')}</span>
        </button>
        {kind === 'dns' ? (
          <button type="button" className="m-button m-button--wide" onClick={onCopy}>
            <Icon name="copy" />
            <span>{t('m.br.copyLink')}</span>
          </button>
        ) : null}
        <button type="button" className="m-button m-button--wide" onClick={onClose}>
          <Icon name="x-lg" />
          <span>{t('m.close')}</span>
        </button>
      </div>
    </div>
  );
}
