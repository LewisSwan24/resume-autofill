// One-click interface language switch ("中 | EN"), shared by the options page header and the side panel toolbar.
// It marks the language actually on screen (so "follow the browser" shows what it resolved to); pressing the other
// one hands it to `onChange`, which stores it. Every surface then follows through `watchProfile`.
import { useLanguage, useT, type Language } from '../i18n';
import './languageToggle.css';

export interface LanguageToggleProps {
  onChange: (language: Language) => void;
  className?: string;
}

const CHOICES: ReadonlyArray<{ language: Language; short: string; lang: string }> = [
  { language: 'zh', short: '中', lang: 'zh-CN' },
  { language: 'en', short: 'EN', lang: 'en' },
];

export function LanguageToggle({ onChange, className }: LanguageToggleProps) {
  const t = useT();
  const current = useLanguage();
  return (
    <div role="group" aria-label={t('common.uiLanguage')} className={className ? `raf-lang-toggle ${className}` : 'raf-lang-toggle'}>
      {CHOICES.map(({ language, short, lang }) => {
        const name = t(language === 'zh' ? 'common.lang.zh' : 'common.lang.en');
        return (
          <button
            key={language}
            type="button"
            className="raf-lang-toggle__item"
            lang={lang}
            aria-pressed={language === current}
            aria-label={name}
            title={name}
            onClick={() => {
              if (language !== current) onChange(language);
            }}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}
