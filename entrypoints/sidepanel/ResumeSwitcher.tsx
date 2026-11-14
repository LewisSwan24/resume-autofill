// Toolbar row: choose the active resume (`title (locale)`), or move to the other language in one click
// ("Switch to English" / "换成中文版", see `counterpartResume`). Both write through the storage repo.
// A native <select> (the design system recommends it on narrow screens) dressed as the Select trigger.
import { useId } from 'react';
import type { Profile } from '../../src/schema';
import { useT } from '../../src/i18n';
import { Icon } from '../../src/ui/Icon';
import { counterpartResume, resumeLanguage, setActiveResume, switchResumeLanguage } from '../../src/storage';

export interface ResumeSwitcherProps {
  profile: Profile;
  /** Called with `null` when a change starts and with a message when writing it failed. */
  onError: (message: string | null) => void;
}

export function ResumeSwitcher({ profile, onError }: ResumeSwitcherProps) {
  const t = useT();
  const hintId = useId();
  if (profile.resumes.length === 0) return null;

  const run = (write: () => Promise<unknown>) => {
    onError(null);
    write().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };

  const active = profile.resumes.find((r) => r.id === profile.activeResumeId);
  const target = counterpartResume(profile);
  // Named by the language it goes to; with nothing to go to, it still says which language is missing.
  const targetLanguage = target ? resumeLanguage(target.locale) : active && resumeLanguage(active.locale) === 'en' ? 'zh' : 'en';
  const targetName = t(targetLanguage === 'zh' ? 'common.resumeLang.zh' : 'common.resumeLang.en');
  const hint = target ? t('panel.switchResumeHint', { target: targetName }) : t('panel.switchResumeNone');

  return (
    <>
      <div className="raf-select">
        <label className="raf-sr-only" htmlFor="raf-active-resume">
          {t('panel.resume')}
        </label>
        <select id="raf-active-resume" value={profile.activeResumeId ?? ''} onChange={(e) => run(() => setActiveResume(e.target.value))}>
          {profile.activeResumeId === null ? <option value="" disabled /> : null}
          {profile.resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title || '—'} ({r.locale})
            </option>
          ))}
        </select>
        <span className="raf-select-icon">
          <Icon name="chevron-down" />
        </span>
      </div>
      {/* aria-disabled, not disabled: it stays focusable so the hint (why it is off) can be reached. */}
      <button
        type="button"
        className="raf-btn raf-switch-resume"
        aria-disabled={target ? undefined : true}
        aria-describedby={hintId}
        title={hint}
        onClick={() => {
          if (target) run(switchResumeLanguage);
        }}
      >
        <Icon name="arrow-left-right" />
        <span>{t('panel.switchResume', { target: targetName })}</span>
      </button>
      <span id={hintId} className="raf-sr-only">
        {hint}
      </span>
    </>
  );
}
