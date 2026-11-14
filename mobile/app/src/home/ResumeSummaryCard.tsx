// Home, block A: the resume used for filling, how far its key sections are filled, and up to three missing details
// that jump straight to their field. Also the no-resume and cannot-read cards.
import { useId, useState } from 'react';
import type { Locale, Profile } from '../../../../src/schema';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { LanguageTag } from '../ResumeSwitcher';
import type { FillLanguage } from '../store/appStateStore';
import { Sheet } from '../ui';
import { resolveFillResume, summarizeResume, type JumpTarget, type KeyItem } from './summary';

const SHOWN_MISSING = 3;

export interface ResumeSummaryCardProps {
  profile: Profile | null;
  loadError: string | null;
  fillLanguage: FillLanguage;
  onJump: (resumeId: string, target?: JumpTarget) => void;
  onStartResume: (locale: Locale) => void;
  onImport: () => void;
  onOpenSettings: () => void;
}

function MissingRow({ item, onClick }: { item: KeyItem; onClick: () => void }) {
  const t = useMT();
  return (
    <li>
      <button type="button" className="m-missing__row" onClick={onClick}>
        <Icon name="exclamation-circle" />
        <span>{t(item.labelKey)}</span>
        <Icon name="chevron-right" />
      </button>
    </li>
  );
}

export function ResumeSummaryCard({ profile, loadError, fillLanguage, onJump, onStartResume, onImport, onOpenSettings }: ResumeSummaryCardProps) {
  const t = useMT();
  const missingId = useId();
  const [allOpen, setAllOpen] = useState(false);

  if (loadError !== null || !profile) {
    if (loadError === null) return null;
    return (
      <section className="m-card m-card--padded m-home-resume">
        <p className="m-notice m-notice--danger">
          <Icon name="exclamation-triangle" />
          <span>{t('m.loadFailed', { message: loadError })}</span>
        </p>
        <p className="m-home-resume__note">{t('m.home.loadFailedHint')}</p>
        <button type="button" className="m-button m-button--wide" onClick={onOpenSettings}>
          <Icon name="gear" />
          <span>{t('m.home.openSettings')}</span>
        </button>
      </section>
    );
  }

  const chosen = resolveFillResume(profile, fillLanguage);
  if (!chosen) {
    return (
      <section className="m-card m-card--padded m-home-resume">
        <h2 className="m-home-resume__title">{t('m.home.noResume')}</h2>
        <p className="m-home-resume__note">{t('m.home.noResumeHint')}</p>
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={() => onStartResume('zh-CN')}>
          <Icon name="plus-lg" />
          <span>{t('m.newZh')}</span>
        </button>
        <button type="button" className="m-button m-button--wide" onClick={() => onStartResume('en-AU')}>
          <Icon name="plus-lg" />
          <span>{t('m.newEn')}</span>
        </button>
        <button type="button" className="m-button m-button--wide" onClick={onImport}>
          <Icon name="upload" />
          <span>{t('m.home.importFile')}</span>
        </button>
      </section>
    );
  }

  const { resume, fallback } = chosen;
  const summary = summarizeResume(resume);
  const jump = (item: KeyItem) => {
    setAllOpen(false);
    onJump(resume.id, item.target);
  };
  const extra = summary.missing.length - SHOWN_MISSING;

  return (
    <section className="m-card m-card--padded m-home-resume">
      <p className="m-home-resume__caption">{t('m.home.inUse')}</p>
      <p className="m-home-resume__title">
        <span>{resume.title}</span>
        <LanguageTag locale={resume.locale} />
      </p>
      {fallback ? (
        <p className="m-home-resume__note">
          {t('m.home.fillFallback', { language: t(fillLanguage === 'en' ? 'm.lang.en' : 'm.lang.zh') })}
        </p>
      ) : null}
      <p className="m-sheet-text">{t('m.home.keyModules', { done: summary.filledCount, total: summary.total })}</p>
      <div
        className="m-progress"
        role="progressbar"
        aria-label={t('m.home.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.filledCount}
      >
        <div className="m-progress__bar" style={{ width: `${(summary.filledCount / summary.total) * 100}%` }} />
      </div>
      {summary.missing.length === 0 ? (
        <p className="m-done">
          <Icon name="check-circle" />
          <span>{t('m.home.allKeyDone')}</span>
        </p>
      ) : (
        <>
          <h2 id={missingId}>{t('m.home.missing')}</h2>
          <ul className="m-missing" aria-labelledby={missingId}>
            {summary.missing.slice(0, SHOWN_MISSING).map((item) => (
              <MissingRow key={item.id} item={item} onClick={() => jump(item)} />
            ))}
            {extra > 0 ? (
              <li>
                <button type="button" className="m-missing__row" onClick={() => setAllOpen(true)}>
                  <Icon name="list-ul" />
                  <span>{t('m.home.missingMore', { n: extra })}</span>
                  <Icon name="chevron-right" />
                </button>
              </li>
            ) : null}
          </ul>
        </>
      )}
      <button type="button" className="m-button m-button--wide" onClick={() => onJump(resume.id)}>
        <Icon name="person-vcard" />
        <span>{t('m.home.editResume')}</span>
      </button>
      <Sheet open={allOpen} title={t('m.home.missingAll')} onClose={() => setAllOpen(false)}>
        <ul className="m-missing">
          {summary.missing.map((item) => (
            <MissingRow key={item.id} item={item} onClick={() => jump(item)} />
          ))}
        </ul>
      </Sheet>
    </section>
  );
}
