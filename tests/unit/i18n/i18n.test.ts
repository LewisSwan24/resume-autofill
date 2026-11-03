import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES, getLanguage, onLanguageChange, resolveLanguage, setLanguage, t, translate } from '../../../src/i18n';

afterEach(() => setLanguage('en'));

describe('dictionaries', () => {
  it('zh and en have identical key sets', () => {
    expect(Object.keys(DICTIONARIES.en).sort()).toEqual(Object.keys(DICTIONARIES.zh).sort());
  });

  it('keys are namespaced and values non-empty', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
        expect(key).toMatch(/^(common|options|fab|panel)\./);
        expect(value.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('placeholders match between zh and en', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(DICTIONARIES.zh) as (keyof typeof DICTIONARIES.zh)[]) {
      expect(placeholders(DICTIONARIES.en[key]), key).toEqual(placeholders(DICTIONARIES.zh[key]));
    }
  });
});

describe('t / setLanguage', () => {
  it('translates into the current language and interpolates params', () => {
    setLanguage('zh');
    expect(t('options.saved')).toBe('已保存');
    expect(t('options.add', { name: '教育经历' })).toBe('添加教育经历');
    setLanguage('en');
    expect(t('options.saved')).toBe('Saved');
    expect(t('options.add', { name: 'Education' })).toBe('Add Education');
  });

  it('returns the key for unknown keys and keeps unknown placeholders', () => {
    expect(t('nope.unknown')).toBe('nope.unknown');
    expect(translate('en', 'options.entry', { name: 'X' })).toBe('X {n}');
  });

  it('notifies listeners only on a real change', () => {
    const listener = vi.fn();
    const off = onLanguageChange(listener);
    setLanguage('zh');
    setLanguage('zh');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLanguage()).toBe('zh');
    off();
    setLanguage('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('resolveLanguage', () => {
  it('honours explicit settings', () => {
    expect(resolveLanguage('zh', 'en-US')).toBe('zh');
    expect(resolveLanguage('en', 'zh-CN')).toBe('en');
  });
  it('auto follows the navigator language', () => {
    expect(resolveLanguage('auto', 'zh-CN')).toBe('zh');
    expect(resolveLanguage('auto', 'zh')).toBe('zh');
    expect(resolveLanguage('auto', 'ZH-TW')).toBe('zh');
    expect(resolveLanguage('auto', 'en-AU')).toBe('en');
    expect(resolveLanguage('auto', 'fr')).toBe('en');
    expect(resolveLanguage('auto', undefined)).toBe('en');
  });
});
