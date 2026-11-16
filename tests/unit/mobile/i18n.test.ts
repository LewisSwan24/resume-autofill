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
  'm.wipe.resumesMore', 'm.privacy.delete.body', 'm.about.version', 'm.ri.import', 'm.ri.fail.title.encrypted',
];

/** Keys that went with "PDF import is coming" once import landed. */
const REMOVED = ['m.onb.soon', 'm.onb.pdfSoon'];

describe('mobile words', () => {
  it('every mobile key has non-empty zh and en text with the same {placeholders}', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh)) {
      expect([key, zh[key]!.trim() !== '']).toEqual([key, true]);
      expect([key, en[key]!.trim() !== '']).toEqual([key, true]);
      expect([key, placeholders(zh[key]!)]).toEqual([key, placeholders(en[key]!)]);
    }
    for (const key of REQUIRED) expect([key, key in zh]).toEqual([key, true]);
    for (const key of REMOVED) expect([key, key in zh || key in en]).toEqual([key, false]);
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

describe('resume keyboard words', () => {
  const SCREEN = [
    'm.kb.title', 'm.kb.row.off', 'm.kb.row.on', 'm.kb.row.current', 'm.kb.row.checking', 'm.kb.lead',
    'm.kb.state.label', 'm.kb.state.unknown', 'm.kb.state.off', 'm.kb.state.on', 'm.kb.state.current',
    'm.kb.state.error', 'm.kb.state.unavailable', 'm.kb.step1.title', 'm.kb.step1.before', 'm.kb.promise.reads',
    'm.kb.promise.offline', 'm.kb.promise.noRecord', 'm.kb.promise.password', 'm.kb.promises', 'm.kb.step1.go',
    'm.kb.step1.done', 'm.kb.step1.again', 'm.kb.step1.failed', 'm.kb.step2.title', 'm.kb.step2.text',
    'm.kb.step2.go', 'm.kb.step2.needStep1', 'm.kb.step2.done', 'm.kb.try.title', 'm.kb.try.label',
    'm.kb.try.placeholder', 'm.kb.try.noResume', 'm.kb.try.dataOff', 'm.kb.chinese', 'm.kb.show', 'm.kb.showHint',
    'm.kb.modules', 'm.kb.modulesAll', 'm.kb.modulesHidden', 'm.kb.modulesTitle', 'm.kb.modulesText',
    'm.kb.syncFailed', 'm.kb.hint.title', 'm.kb.hint.miniProgram', 'm.kb.hint.app', 'm.kb.hint.login',
    'm.kb.hint.go', 'm.privacy.keyboard',
  ];
  const PROJECTION = [
    'm.kb.group.suggested', 'm.kb.group.basics', 'm.kb.group.education', 'm.kb.group.internship', 'm.kb.group.work',
    'm.kb.group.projects', 'm.kb.group.campus', 'm.kb.group.awards', 'm.kb.group.skills', 'm.kb.group.intention',
    'm.kb.group.links', 'm.kb.group.about', 'm.kb.group.other', 'm.kb.entry.nth', 'm.kb.entry.person',
    'm.kb.entry.question', 'm.kb.entry.titled', 'm.kb.item.fullName', 'm.kb.item.phoneFull', 'm.kb.item.addressFull',
    'm.kb.item.period', 'm.kb.item.allSkills', 'm.kb.item.skillN', 'm.kb.item.answer',
  ];
  const NATIVE = [
    'name', 'subtype', 'resume', 'typing', 'switch_ime', 'hide', 'shift', 'shift_on', 'caps_lock', 'delete', 'space',
    'space_caption', 'comma', 'period', 'hyphen', 'symbols', 'more_symbols', 'letters', 'enter', 'action_go',
    'action_search', 'action_send', 'action_next', 'action_done', 'action_previous', 'switch_resume', 'lang_to_en',
    'lang_to_zh', 'lang_none', 'pick_resume', 'close', 'suggested', 'selected', 'inserted', 'read_value',
    'empty_title', 'empty_text', 'open_app', 'loading', 'error', 'locked', 'password', 'secret', 'no_learning',
    'reveal', 'no_chinese', 'tip_dismiss',
  ].map((name) => `m.kb.native.${name}`);

  it('every key of section 10 is there in both languages', () => {
    for (const key of [...SCREEN, ...PROJECTION, ...NATIVE]) {
      expect([key, key in zh && key in en]).toEqual([key, true]);
    }
  });

  it('reads the agreed words', () => {
    expect(zh['m.kb.title']).toBe('简历输入法');
    expect(en['m.kb.title']).toBe('Resume keyboard');
    expect(zh['m.kb.step1.go']).toBe('去系统设置启用');
    expect(zh['m.kb.native.switch_ime']).toBe('切换到其他输入法');
    expect(zh['m.kb.native.switch_resume']).toBe('换一份简历，现在是「{title}」');
    expect(en['m.kb.native.inserted']).toBe('Typed: {label}');
  });

  it('counts hidden kinds in the singular for one', () => {
    expect(mt('en', 'm.kb.modulesHidden', { n: 1 })).toBe('1 kind hidden');
    expect(mt('en', 'm.kb.modulesHidden', { n: 3 })).toBe('3 kinds hidden');
    expect(mt('zh', 'm.kb.modulesHidden', { n: 3 })).toBe('藏起了 3 类');
  });
});
