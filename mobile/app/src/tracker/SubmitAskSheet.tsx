// 「提交了吗？」: after a fill, once the page is closed. The app never marks 已提交 by itself.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { Sheet } from '../ui';

export interface SubmitAskSheetProps {
  open: boolean;
  name: string;
  onYes: () => void;
  onNo: () => void;
}

export function SubmitAskSheet({ open, name, onYes, onNo }: SubmitAskSheetProps) {
  const t = useMT();
  return (
    <Sheet open={open} title={t('m.ask.title')} onClose={onNo}>
      <div className="m-sheet-stack">
        <p className="m-sheet-text">{t('m.ask.text', { name })}</p>
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={onYes}>
          <Icon name="check-lg" />
          <span>{t('m.ask.yes')}</span>
        </button>
        <button type="button" className="m-button m-button--wide" onClick={onNo}>
          {t('m.ask.no')}
        </button>
      </div>
    </Sheet>
  );
}
