// The way back to a hidden fill browser: a pill fixed above the tab bar on every tab while the page waits.
import { Icon } from '../Icon';
import { useMT } from '../i18n';

export function ReturnPill({ host, onReturn }: { host: string; onReturn: () => void }) {
  const t = useMT();
  return (
    <div className="m-br-return">
      <button type="button" className="m-br-return__pill" onClick={onReturn}>
        <Icon name="window" />
        <span>{t('m.br.return', { host })}</span>
      </button>
    </div>
  );
}
