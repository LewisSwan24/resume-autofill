// Which resume filling (and Home) uses: the one selected on the 简历 tab, or always the Chinese / English one.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { FillLanguage } from '../store/appStateStore';
import { Sheet } from '../ui';

export const FILL_LANGUAGE_LABELS: Record<FillLanguage, string> = {
  active: 'm.fillLang.active',
  zh: 'm.fillLang.zh',
  en: 'm.fillLang.en',
};

export function FillLanguageSheet({
  open,
  value,
  onChoose,
  onClose,
}: {
  open: boolean;
  value: FillLanguage;
  onChoose: (value: FillLanguage) => void;
  onClose: () => void;
}) {
  const t = useMT();
  const title = t('m.settings.fillLanguage');
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div role="radiogroup" aria-label={title} className="m-choices">
        {(['active', 'zh', 'en'] as const).map((v) => {
          const checked = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={checked}
              className={checked ? 'm-choice m-choice--on' : 'm-choice'}
              onClick={() => {
                onChoose(v);
                onClose();
              }}
            >
              <span>{t(FILL_LANGUAGE_LABELS[v])}</span>
              {checked ? <Icon name="check-lg" /> : null}
            </button>
          );
        })}
      </div>
      <p className="m-help m-row__caption">{t('m.fillLang.hint')}</p>
    </Sheet>
  );
}
