// The 中 / EN interface language switch, shared by Settings and the onboarding welcome step.
import type { Language } from '../../../../src/i18n';
import { useMT } from '../i18n';

export function LanguageSwitch({ language, onLanguage }: { language: Language; onLanguage: (language: Language) => void }) {
  const t = useMT();
  return (
    <div className="m-segmented m-segmented--small" role="radiogroup" aria-label={t('common.uiLanguage')}>
      {(['zh', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={language === l}
          className={language === l ? 'm-segment m-segment--on' : 'm-segment'}
          onClick={() => onLanguage(l)}
        >
          {l === 'zh' ? t('m.zhTag') : t('m.enTag')}
        </button>
      ))}
    </div>
  );
}
