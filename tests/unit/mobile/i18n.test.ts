// The mobile app's own words: both languages complete, placeholders matching, and the Chinese free of the commonest
// translationese tells.
import { describe, expect, it } from 'vitest';
import { mobileMessages, mobileSingulars, mt } from '../../../mobile/app/src/i18n';

const zh = mobileMessages('zh');
const en = mobileMessages('en');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Keys the screens of this iteration rely on (a sample from every area, plus the shell's). */
const REQUIRED = [
  'm.nav', 'm.tab.home', 'm.tab.resume', 'm.tab.settings', 'm.loading', 'm.saveStateFailed',
  'm.home.keyModules', 'm.paste.err.unsupported_scheme', 'm.recent.clearText', 'm.time.yesterday',
  'm.settings.wipe', 'm.fillLang.hint', 'm.export.pwNote', 'm.import.err.too_large', 'm.import.copySuffix',
  'm.wipe.resumesMore', 'm.privacy.delete.body', 'm.about.version', 'm.onb.pdfSoon',
];

describe('mobile words', () => {
  it('every mobile key has non-empty zh and en text with the same {placeholders}', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh)) {
      expect([key, zh[key]!.trim() !== '']).toEqual([key, true]);
      expect([key, en[key]!.trim() !== '']).toEqual([key, true]);
      expect([key, placeholders(zh[key]!)]).toEqual([key, placeholders(en[key]!)]);
    }
    for (const key of REQUIRED) expect([key, key in zh]).toEqual([key, true]);
  });

  it('zh text has no ASCII dash used as a dash and no 「它」', () => {
    for (const [key, text] of Object.entries(zh)) {
      expect([key, /\s-\s|——|—|–/.test(text)]).toEqual([key, false]);
      expect([key, text.includes('它')]).toEqual([key, false]);
    }
  });

  it('the copy suffix keeps its leading space in English, and placeholders fill in', () => {
    expect(en['m.import.copySuffix']).toBe(' (imported)');
    expect(mt('zh', 'm.home.keyModules', { done: 4, total: 7 })).toBe('关键模块已填 4/7');
    expect(mt('en', 'm.about.version', { version: '0.1.0', build: '7' })).toBe('Version 0.1.0 (7)');
  });

  it('English counts read right for one: no "1 things", and the singulars match their plural keys', () => {
    const one = mobileSingulars('en');
    for (const [key, text] of Object.entries(one)) {
      expect([key, key in en]).toEqual([key, true]);
      expect([key, placeholders(text).filter((p) => p !== 'n')]).toEqual([key, placeholders(en[key]!).filter((p) => p !== 'n')]);
    }
    for (const [key, text] of Object.entries(en)) {
      if (!/\{(n|added|skipped)\}/.test(text)) continue;
      const out = mt('en', key, { n: 1, total: 3, host: 'example.com', names: 'A', added: 1, skipped: 1 });
      // a plural noun after "1", or a plural verb right after "1 <noun>"
      const wrong = /\b1 (\w+ ){0,2}(resumes|links|entries|sections|attachments|files|pages|items)\b|\b1 \w+ (were|are|differ|need)\b|\b1 (were|are|differ|need)\b/;
      expect([key, wrong.test(out)]).toEqual([key, false]);
    }
    expect(mt('en', 'm.export.contents', { n: 1 })).toBe('Includes 1 resume and your settings.');
    expect(mt('en', 'm.export.contents', { n: 2 })).toBe('Includes 2 resumes and your settings.');
    expect(mt('en', 'm.import.done', { n: 1 })).toBe('Imported 1 resume');
    expect(mt('en', 'm.wipe.files', { n: 1 })).toBe('1 attachment file');
    expect(mt('en', 'm.import.conflicts', { n: 1 })).toMatch(/^1 differs /);
    expect(mt('en', 'm.recent.clearText', { n: 1 })).not.toContain('1 links');
    expect(mt('zh', 'm.export.contents', { n: 1 })).toBe('包含 1 份简历和设置。');
  });
});
