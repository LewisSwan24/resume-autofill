// First run: step 1 says what the app promises, step 2 gets a resume ready (import a file, start blank, or the PDF
// import that is still to come). Nothing is marked done until the person leaves through one of those or 跳过.
import { useState } from 'react';
import type { Language } from '../../../../src/i18n';
import type { Locale } from '../../../../src/schema';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { LanguageSwitch } from '../settings/LanguageSwitch';
import { IconButton, type ToastMessage } from '../ui';

export interface OnboardingProps {
  step: 1 | 2;
  onStep: (step: 1 | 2) => void;
  language: Language;
  onLanguage: (language: Language) => void;
  onSkip: () => void;
  onStartBlank: (locale: Locale) => void;
  onImport: () => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

const PROMISES: ReadonlyArray<{ icon: IconName; key: string }> = [
  { icon: 'lock', key: 'm.onb.promise.local' },
  { icon: 'send-slash', key: 'm.onb.promise.noSubmit' },
  { icon: 'clipboard-check', key: 'm.onb.promise.check' },
];

export function Onboarding(props: OnboardingProps) {
  return props.step === 1 ? <Welcome {...props} /> : <GetReady {...props} />;
}

function Welcome({ onStep, language, onLanguage, onSkip }: OnboardingProps) {
  const t = useMT();
  return (
    <div className="m-onb">
      <div className="m-onb__top">
        <span className="m-onb__step">{t('m.onb.step', { n: 1, total: 2 })}</span>
        <LanguageSwitch language={language} onLanguage={onLanguage} />
        <button type="button" className="m-button m-button--text" onClick={onSkip}>
          {t('m.onb.skip')}
        </button>
      </div>
      <h1 className="m-title" tabIndex={-1}>
        {t('m.onb.welcomeTitle')}
      </h1>
      <ul className="m-card m-onb__promises" aria-label={t('m.onb.promises')}>
        {PROMISES.map((p) => (
          <li key={p.key} className="m-onb__promise">
            <span className="m-row__tile">
              <Icon name={p.icon} />
            </span>
            <span>{t(p.key)}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onStep(2)}>
        {t('m.onb.continue')}
      </button>
    </div>
  );
}

function Option({
  icon,
  name,
  hint,
  onClick,
  expanded,
  soon,
}: {
  icon: IconName;
  name: string;
  hint: string;
  onClick: () => void;
  expanded?: boolean;
  soon?: string;
}) {
  return (
    <button
      type="button"
      className="m-onb__option"
      aria-expanded={expanded}
      aria-disabled={soon ? true : undefined}
      onClick={onClick}
    >
      <span className="m-row__tile">
        <Icon name={icon} />
      </span>
      <span className="m-row__text">
        <span className="m-row__name">{name}</span>
        <span className="m-row__caption">{hint}</span>
      </span>
      {soon ? <span className="m-soon">{soon}</span> : null}
    </button>
  );
}

function GetReady({ onStep, onSkip, onStartBlank, onImport, showToast }: OnboardingProps) {
  const t = useMT();
  const [blankOpen, setBlankOpen] = useState(false);
  return (
    <div className="m-onb">
      <div className="m-onb__top">
        <IconButton icon="arrow-left" label={t('m.onb.back')} onClick={() => onStep(1)} />
        <span className="m-onb__step">{t('m.onb.step', { n: 2, total: 2 })}</span>
        <button type="button" className="m-button m-button--text" onClick={onSkip}>
          {t('m.onb.skip')}
        </button>
      </div>
      <h1 className="m-title" tabIndex={-1}>
        {t('m.onb.startTitle')}
      </h1>
      <div className="m-onb__options">
        <Option icon="upload" name={t('m.onb.import')} hint={t('m.onb.importHint')} onClick={onImport} />
        <Option
          icon="plus-lg"
          name={t('m.onb.blank')}
          hint={t('m.onb.blankHint')}
          expanded={blankOpen}
          onClick={() => setBlankOpen((o) => !o)}
        />
        {blankOpen ? (
          <div className="m-onb__blank">
            <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onStartBlank('zh-CN')}>
              <Icon name="plus-lg" />
              <span>{t('m.newZh')}</span>
            </button>
            <button type="button" className="m-button m-button--wide" onClick={() => onStartBlank('en-AU')}>
              <Icon name="plus-lg" />
              <span>{t('m.newEn')}</span>
            </button>
          </div>
        ) : null}
        <Option
          icon="file-earmark-pdf"
          name={t('m.onb.pdf')}
          hint={t('m.onb.pdfHint')}
          soon={t('m.onb.soon')}
          onClick={() => showToast({ text: t('m.onb.pdfSoon') })}
        />
      </div>
    </div>
  );
}
