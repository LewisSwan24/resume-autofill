// Bottom toolbar of the fill browser: back, forward, reload / stop, the resume chip, and the report once one
// exists. When the FAB has no room on the page (placement "docked"), a 「一键填写」 button joins them whenever the FAB
// would fill (before a run, after undo, or when the page grew); the report stays reachable throughout.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { IconButton } from '../ui';

export interface BrowserToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  /** Title of the resume a fill would use, and its language tag (中 / EN). */
  resumeName: string;
  resumeTag: string;
  onResume: () => void;
  /** Rows waiting for the person; null while no report exists in this document. */
  report: { attention: number } | null;
  onReport: () => void;
  /** The FAB found no room and would fill: fill from here instead. */
  dockedFill: boolean;
  onFill: () => void;
}

export function BrowserToolbar(p: BrowserToolbarProps) {
  const t = useMT();
  return (
    <nav className="m-br-toolbar" aria-label={t('m.br.toolbar')}>
      <IconButton icon="arrow-left" label={t('m.br.back')} disabled={!p.canGoBack} onClick={p.onBack} />
      <IconButton icon="arrow-right" label={t('m.br.forward')} disabled={!p.canGoForward} onClick={p.onForward} />
      <IconButton
        icon={p.loading ? 'slash-circle' : 'arrow-clockwise'}
        label={t(p.loading ? 'm.br.stop' : 'm.br.reload')}
        onClick={p.onReloadOrStop}
      />
      <button type="button" className="m-br-chip" aria-label={t('m.br.resume.chip', { name: p.resumeName })} onClick={p.onResume}>
        <Icon name="person-vcard" />
        <span aria-hidden="true">{p.resumeTag}</span>
      </button>
      {p.dockedFill ? (
        <button type="button" className="m-br-chip m-br-chip--fill" onClick={p.onFill}>
          <Icon name="magic" />
          <span>{t('fab.autofill')}</span>
        </button>
      ) : null}
      {p.report ? (
        <button
          type="button"
          className="m-br-chip"
          aria-label={t('m.br.report.button', { n: p.report.attention })}
          onClick={p.onReport}
        >
          <Icon name="card-checklist" />
          {p.report.attention > 0 ? (
            <span className="m-br-badge" aria-hidden="true">
              {p.report.attention}
            </span>
          ) : null}
        </button>
      ) : null}
      {!p.dockedFill && !p.report ? <span className="m-br-toolbar__spacer" aria-hidden="true" /> : null}
    </nav>
  );
}
