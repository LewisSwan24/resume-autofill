// Small "中" / "EN" chip on the FAB's top corner: the language of the resume the next fill uses. One click moves to
// the resume in the other language (`counterpartResume`); the side panel and options page follow through storage.
// It sits outside `.raf-fab`, so pressing it neither drags the FAB (drag.ts only starts on `.raf-fab`) nor fills,
// and it is absolutely positioned, so the host box stays exactly the FAB button (style.css geometry contract).
import { useEffect, useState } from 'react';
import { useT, type Language } from '../../src/i18n';
import type { Profile } from '../../src/schema';
import { counterpartResume, loadProfile, resumeLanguage, switchResumeLanguage, watchProfile } from '../../src/storage';

export function ResumeChip({ disabled }: { disabled: boolean }) {
  const t = useT();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let live = true;
    loadProfile().then(
      (loaded) => {
        if (live) setProfile((current) => current ?? loaded);
      },
      () => undefined, // unreadable profile: no chip; the fill itself reports the problem
    );
    const stop = watchProfile(setProfile);
    return () => {
      live = false;
      stop();
    };
  }, []);

  const active = profile?.resumes.find((r) => r.id === profile.activeResumeId);
  if (!profile || !active || !counterpartResume(profile)) return null;

  const current = resumeLanguage(active.locale);
  const name = (language: Language) => t(language === 'zh' ? 'common.resumeLang.zh' : 'common.resumeLang.en');
  const label = t('fab.resumeChip', { current: name(current), target: name(current === 'zh' ? 'en' : 'zh') });
  return (
    <button
      type="button"
      className="raf-resume-chip"
      lang={current === 'zh' ? 'zh-CN' : 'en'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => void switchResumeLanguage().catch(() => undefined)}
    >
      {current === 'zh' ? '中' : 'EN'}
    </button>
  );
}
