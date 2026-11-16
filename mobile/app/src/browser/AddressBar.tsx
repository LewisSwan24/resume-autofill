// Top bar of the fill browser: close, the host (opens page info), and a thin progress line while loading.
// The host is the ASCII form (look-alike hosts show as xn--), wraps to two lines at most, never middle-ellipsised.
import { useId } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { IconButton } from '../ui';
import type { DisplayHost } from './model/displayHost';

export interface AddressBarProps {
  host: DisplayHost;
  /** The page was refused for its certificate: never show the lock then. */
  certProblem?: boolean;
  loading: boolean;
  progress: number;
  onClose: () => void;
  onPageInfo: () => void;
}

/** What the bar names the page: the host, or 「示例表单（App 自带）」 for the demo. */
export function useHostLabel(host: DisplayHost): string {
  const t = useMT();
  return host.kind === 'demo' ? t('m.br.demoHost') : host.host;
}

export function AddressBar({ host, certProblem, loading, progress, onClose, onPageInfo }: AddressBarProps) {
  const t = useMT();
  const label = useHostLabel(host);
  const showProgress = loading && progress < 100;
  // The button's aria-label is its whole name, so the icon's label inside it is never read: the connection state goes
  // into its description instead, which TalkBack reads after the name.
  const securityId = useId();
  const security =
    host.kind === 'demo' ? null : certProblem ? t('m.br.certProblem') : host.kind === 'secure' ? t('m.br.secure') : t('m.br.insecure');
  return (
    <header className="m-br-top">
      <div className="m-br-top__row">
        <IconButton icon="x-lg" label={t('m.br.close')} onClick={onClose} />
        <button
          type="button"
          className="m-br-host"
          aria-label={t('m.br.pageInfo', { host: label })}
          aria-describedby={security ? securityId : undefined}
          onClick={onPageInfo}
        >
          {host.kind === 'demo' ? (
            <Icon name="play-circle" />
          ) : certProblem ? (
            <Icon name="shield-exclamation" label={t('m.br.certProblem')} className="m-br-host__warn" />
          ) : host.kind === 'secure' ? (
            <Icon name="lock" label={t('m.br.secure')} />
          ) : (
            <Icon name="exclamation-triangle" label={t('m.br.insecure')} className="m-br-host__warn" />
          )}
          <span className="m-br-host__text">{label}</span>
          {security ? (
            <span id={securityId} hidden>
              {security}
            </span>
          ) : null}
        </button>
      </div>
      {showProgress ? (
        <div
          className="m-br-progress"
          role="progressbar"
          aria-label={t('m.br.loading', { host: label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div className="m-br-progress__bar" style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
    </header>
  );
}
