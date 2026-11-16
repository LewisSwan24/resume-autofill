// Our own explanation before Android's notification prompt: shown only when the first reminder
// is turned on and the system would still ask.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { Sheet } from '../ui';

export interface NotificationPermissionSheetProps {
  open: boolean;
  onContinue: () => void;
  onLater: () => void;
}

export function NotificationPermissionSheet({ open, onContinue, onLater }: NotificationPermissionSheetProps) {
  const t = useMT();
  return (
    <Sheet open={open} title={t('m.perm.title')} onClose={onLater}>
      <div className="m-sheet-stack">
        <p className="m-sheet-text">{t('m.perm.text')}</p>
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={onContinue}>
          <Icon name="bell" />
          <span>{t('m.perm.next')}</span>
        </button>
        <button type="button" className="m-button m-button--wide" onClick={onLater}>
          {t('m.perm.later')}
        </button>
      </div>
    </Sheet>
  );
}
