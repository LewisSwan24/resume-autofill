// Keeps the FAB's UI language in sync with `settings.uiLanguage` (storage.local `profile`).
import { browser } from 'wxt/browser';
import { resolveLanguage, setLanguage, type LanguageSetting } from '../../src/i18n';
import { loadProfile, PROFILE_STORAGE_KEY } from '../../src/storage';

const VALID: readonly LanguageSetting[] = ['auto', 'zh', 'en'];

async function apply(): Promise<void> {
  let setting: LanguageSetting = 'auto';
  try {
    const profile = await loadProfile();
    const stored = profile.settings.uiLanguage as unknown;
    if (VALID.includes(stored as LanguageSetting)) setting = stored as LanguageSetting;
  } catch {
    // Corrupt/unreadable profile: fall back to the browser language.
  }
  setLanguage(resolveLanguage(setting, navigator.language));
}

/** Apply the stored language now and again whenever the profile changes. Returns a disposer. */
export function syncUiLanguage(): () => void {
  void apply();
  const onChanged = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && PROFILE_STORAGE_KEY in changes) void apply();
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
