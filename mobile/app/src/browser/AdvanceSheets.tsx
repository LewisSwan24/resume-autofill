// Auto-advance in the fill browser: the question asked once per site before it starts (modal, like the resume
// picker), and the bar that takes the toolbar's place while it runs (what step, how far, stop). Words are the
// extension's common.advance.* wherever they say the same thing.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';

export function AdvanceConfirmSheet({ open, host, onStart, onClose }: { open: boolean; host: string; onStart: () => void; onClose: () => void }) {
  const t = useMT();
  return (
    <DockedSheet open={open} title={t('m.br.adv.confirm.title')} modal closeButton={false} onClose={onClose}>
      <div className="m-sheet-stack">
        <ul className="m-br-points">
          <li>{t('m.br.adv.confirm.fill')}</li>
          <li>{t('m.br.adv.confirm.noSubmit')}</li>
          <li>{t('m.br.adv.confirm.stops')}</li>
          <li>{t('m.br.adv.confirm.stopAny')}</li>
        </ul>
        <p className="m-help">{t('m.br.adv.confirm.site', { host })}</p>
        <button
          type="button"
          className="m-button m-button--primary m-button--wide"
          onClick={() => {
            onStart();
            onClose();
          }}
        >
          <Icon name="play-circle" />
          <span>{t('m.br.adv.confirm.start')}</span>
        </button>
        <button type="button" className="m-button m-button--wide" onClick={onClose}>
          {t('m.br.adv.confirm.cancel')}
        </button>
      </div>
    </DockedSheet>
  );
}

/** Takes the toolbar's place while auto-advance runs: the page stays visible above it. */
export function AdvanceBar({ moved, step, filling, onStop }: { moved: number; step: number; filling: boolean; onStop: () => void }) {
  const t = useMT();
  return (
    <div className="m-br-toolbar m-br-advbar" role="status" data-testid="m-advance-bar">
      <span className="m-br-advbar__spin" aria-hidden="true" />
      <span className="m-br-row__text">
        <span className="m-row__name">{t('common.advance.running', { n: moved })}</span>
        <span className="m-br-row__status">{t(filling ? 'm.br.adv.atFilling' : 'm.br.adv.at', { n: step })}</span>
      </span>
      <button type="button" className="m-button" onClick={onStop}>
        <Icon name="stop-circle" />
        <span>{t('common.advance.stop')}</span>
      </button>
    </div>
  );
}
