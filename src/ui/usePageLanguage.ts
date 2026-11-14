// Interface language of a read-only extension page (welcome, help): follows the stored setting, also when it is
// changed elsewhere, and stores a switch made here. The side panel and the options page do the same with the profile
// they already hold.
import { useEffect, useState } from 'react';
import { resolveLanguage, setLanguage, type Language, type LanguageSetting } from '../i18n';
import { loadProfile, setUiLanguage, watchProfile } from '../storage';

export function usePageLanguage(): { ready: boolean; change: (language: Language) => void } {
  const [setting, setSetting] = useState<LanguageSetting | null>(null);

  useEffect(() => {
    let cancelled = false;
    // An unreadable profile still gets a page, in the browser's language.
    loadProfile().then(
      (profile) => {
        if (!cancelled) setSetting((current) => current ?? profile.settings.uiLanguage);
      },
      () => {
        if (!cancelled) setSetting((current) => current ?? 'auto');
      },
    );
    const unwatch = watchProfile((profile) => setSetting(profile.settings.uiLanguage));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  useEffect(() => {
    if (setting === null) return;
    const language = resolveLanguage(setting, navigator.language);
    setLanguage(language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [setting]);

  const change = (language: Language) => {
    setSetting(language);
    void setUiLanguage(language).catch(() => undefined);
  };

  return { ready: setting !== null, change };
}
