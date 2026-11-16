// The fill browser's small modal sheets, one component with variants: why filling is unavailable (old WebView) or
// missing (engine did not load), no resume to fill with, a page that asks for unusually much, frames of other sites
// that ask for data, and the close confirm.
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';

export type Explain =
  | { kind: 'unsupported'; version: string | null }
  | { kind: 'missing' }
  | { kind: 'noResume'; demo: boolean }
  | { kind: 'large'; leaves: number }
  | { kind: 'sites'; hosts: string[] }
  | { kind: 'close' };

export interface ExplainSheetProps {
  explain: Explain | null;
  onClose: () => void;
  onReload: () => void;
  onGoToResume: () => void;
  onUseSample: () => void;
  onLarge: (go: boolean) => void;
  onSites: (go: boolean) => void;
  onConfirmClose: () => void;
}

export function ExplainSheet({ explain, onClose, onReload, onGoToResume, onUseSample, onLarge, onSites, onConfirmClose }: ExplainSheetProps) {
  const t = useMT();
  const title = !explain
    ? ''
    : explain.kind === 'unsupported'
      ? t('m.br.err.unsupported.title')
      : explain.kind === 'missing'
        ? t('m.br.err.missing.title')
        : explain.kind === 'noResume'
          ? t('m.br.run.noResume.title')
          : explain.kind === 'large'
            ? t('m.br.run.large.title')
            : explain.kind === 'sites'
              ? t('m.br.run.sites.title')
              : t('m.br.closeTitle');
  // Large needs: closing the sheet any other way is 「不填了」, so the run never waits forever. Other sites: closing
  // it is 「只填本站」, the choice that sends nothing to them.
  const close = explain?.kind === 'large' ? () => onLarge(false) : explain?.kind === 'sites' ? () => onSites(false) : onClose;
  const asks = explain?.kind === 'close' || explain?.kind === 'large' || explain?.kind === 'sites';
  return (
    <DockedSheet open={explain !== null} title={title} modal onClose={close} closeButton={!asks}>
      {explain?.kind === 'unsupported' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.err.unsupported.text', { version: explain.version ?? '?' })}</p>
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.br.dismiss')}
          </button>
        </div>
      ) : explain?.kind === 'missing' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.err.missing.text')}</p>
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={onReload}>
            {t('m.br.reload')}
          </button>
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.br.cancel')}
          </button>
        </div>
      ) : explain?.kind === 'noResume' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.run.noResume.text')}</p>
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={onGoToResume}>
            {t('m.br.run.noResume.go')}
          </button>
          {explain.demo ? (
            <button type="button" className="m-button m-button--wide" onClick={onUseSample}>
              {t('m.br.run.noResume.sample')}
            </button>
          ) : null}
        </div>
      ) : explain?.kind === 'large' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.run.large.text', { n: explain.leaves })}</p>
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onLarge(true)}>
            {t('m.br.run.large.go')}
          </button>
          <button type="button" className="m-button m-button--wide" onClick={() => onLarge(false)}>
            {t('m.br.run.large.cancel')}
          </button>
        </div>
      ) : explain?.kind === 'sites' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.run.sites.text')}</p>
          <ul className="m-br-handed">
            {explain.hosts.map((host) => (
              <li key={host}>{host || t('m.br.run.sites.unknown')}</li>
            ))}
          </ul>
          <button type="button" className="m-button m-button--wide" onClick={() => onSites(true)}>
            {t('m.br.run.sites.go')}
          </button>
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onSites(false)}>
            {t('m.br.run.sites.own')}
          </button>
        </div>
      ) : explain?.kind === 'close' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.closeText')}</p>
          <button type="button" className="m-button m-button--danger m-button--wide" onClick={onConfirmClose}>
            {t('m.br.closeConfirm')}
          </button>
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.br.cancel')}
          </button>
        </div>
      ) : null}
    </DockedSheet>
  );
}
