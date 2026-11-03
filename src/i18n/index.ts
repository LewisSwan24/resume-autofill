// Tiny i18n layer: flat, namespaced dictionaries (`common.*`, `options.*`, `fab.*`, `panel.*`).
// `zh.ts` defines the key set; `en.ts` is typed `Record<MessageKey, string>` so both must match.
import { useCallback, useSyncExternalStore } from 'react';
import { en } from './en';
import { zh, type MessageKey } from './zh';

export type Language = 'zh' | 'en';
export type LanguageSetting = 'auto' | Language;
export type { MessageKey };
export type MessageParams = Record<string, string | number>;

export const DICTIONARIES: Readonly<Record<Language, Readonly<Record<MessageKey, string>>>> = { zh, en };

/** `auto` follows the browser UI language: any `zh*` locale → Chinese, everything else → English. */
export function resolveLanguage(setting: LanguageSetting, navigatorLanguage?: string | null): Language {
  if (setting === 'zh' || setting === 'en') return setting;
  return /^zh\b/i.test((navigatorLanguage ?? '').trim()) ? 'zh' : 'en';
}

const initialNavigatorLanguage = typeof navigator !== 'undefined' ? navigator.language : undefined;
let current: Language = resolveLanguage('auto', initialNavigatorLanguage);
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of [...listeners]) listener();
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replace `{name}` placeholders. Unknown placeholders are left untouched. */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** Translate `key` into `language` (default: the current language). Unknown keys return the key itself. */
export function translate(language: Language, key: MessageKey | (string & {}), params?: MessageParams): string {
  const dict: Readonly<Record<string, string>> = DICTIONARIES[language];
  const template = dict[key] ?? (DICTIONARIES.en as Readonly<Record<string, string>>)[key] ?? key;
  return interpolate(template, params);
}

export function t(key: MessageKey | (string & {}), params?: MessageParams): string {
  return translate(current, key, params);
}

/** React hook: returns `t` bound to the current language and re-renders when the language changes. */
export function useT(): typeof t {
  const language = useSyncExternalStore(onLanguageChange, getLanguage, getLanguage);
  return useCallback((key, params) => translate(language, key, params), [language]);
}

/** React hook: the current language (re-renders on change). */
export function useLanguage(): Language {
  return useSyncExternalStore(onLanguageChange, getLanguage, getLanguage);
}
