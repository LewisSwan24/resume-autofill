import { describe, expect, it } from 'vitest';
import { compactKey, containsPhrase, normalizeLabel, tokens } from '../../../src/dictionary/normalize';

describe('normalizeLabel', () => {
  const cases: [string, string, string][] = [
    ['strips asterisk', '* 姓名', '姓名'],
    ['strips trailing asterisk and full-width colon', '姓名*：', '姓名'],
    ['full-width latin to half-width + lower-case', 'ＥＭＡＩＬ Ａｄｄｒｅｓｓ', 'email address'],
    ['full-width parentheses', '手机号码（必填）', '手机号码'],
    ['half-width parentheses with required', 'Email (required)', 'email'],
    ['optional', 'Middle name (optional)', 'middle name'],
    ['选填', '微信号（选填）', '微信号'],
    ['please enter', 'Please enter your email', 'your email'],
    ['please select', 'Please select', ''],
    ['请输入', '请输入邮箱', '邮箱'],
    ['请选择', '请选择学历', '学历'],
    ['请填写', '请填写籍贯', '籍贯'],
    // Feishu asks for a place as text and says how to write it in brackets after the name.
    ['format in brackets', '籍贯（填写格式：xx省xx市）', '籍贯'],
    ['format in brackets, upper case', '目前所在地（填写格式：XX省XX市）', '目前所在地'],
    ['format given as', '出生年月（格式为：YYYY-MM）', '出生年月'],
    ['colon + brackets', 'Phone: [mobile]', 'phone mobile'],
    ['collapses whitespace', '  First   name \t ', 'first name'],
    ['spaces between CJK chars are dropped', '姓    名', '姓名'],
    ['keeps mixed text readable', '姓名 Name', '姓名 name'],
    ['trailing question mark', 'Do you require sponsorship?', 'do you require sponsorship'],
    ['full-width question mark', '是否服从调剂？', '是否服从调剂'],
    ['(s) plural', 'Given name(s)', 'given names'],
    ['curly apostrophe', 'Master’s degree', "master's degree"],
    ['empty', '', ''],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(normalizeLabel(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const [, input] of cases) {
      const once = normalizeLabel(input);
      expect(normalizeLabel(once)).toBe(once);
    }
  });
});

describe('tokens', () => {
  it('splits latin words', () => {
    expect(tokens('First Name')).toEqual(['first', 'name']);
  });
  it('emits CJK unigrams then bigrams', () => {
    expect(tokens('姓名')).toEqual(['姓', '名', '姓名']);
    expect(tokens('手机号')).toEqual(['手', '机', '号', '手机', '机号']);
  });
  it('mixes scripts and normalizes first', () => {
    expect(tokens('邮箱*(Email)')).toEqual(['邮', '箱', '邮箱', 'email']);
  });
  it('returns [] for empty input', () => {
    expect(tokens('  ')).toEqual([]);
  });
  it('de-duplicates', () => {
    expect(tokens('name name')).toEqual(['name']);
  });
});

describe('containsPhrase', () => {
  it('latin phrases respect word boundaries', () => {
    expect(containsPhrase('first name', 'name')).toBe(true);
    expect(containsPhrase('woman', 'man')).toBe(false);
    expect(containsPhrase('username', 'name')).toBe(false);
    expect(containsPhrase('state/territory', 'state')).toBe(true);
  });
  it('prefix mode allows suffixes', () => {
    expect(containsPhrase('visa sponsorship', 'sponsor', 'prefix')).toBe(true);
    expect(containsPhrase('visa sponsorship', 'sponsor', 'word')).toBe(false);
    expect(containsPhrase('language', 'age', 'prefix')).toBe(false);
  });
  it('CJK phrases match as substrings', () => {
    expect(containsPhrase('家庭成员姓名', '家庭')).toBe(true);
    expect(containsPhrase('姓名', '家庭')).toBe(false);
  });
  it('handles regex metacharacters', () => {
    expect(containsPhrase('australia +61', '+61')).toBe(true);
    expect(containsPhrase('a.b', 'a.b')).toBe(true);
  });
  it('empty phrase never matches', () => {
    expect(containsPhrase('abc', '')).toBe(false);
  });
});

describe('compactKey', () => {
  it('drops spaces, hyphens, slashes and apostrophes after normalization', () => {
    expect(compactKey('CET-6')).toBe('cet6');
    expect(compactKey('CET 6')).toBe('cet6');
    expect(compactKey('He / Him')).toBe('hehim');
    expect(compactKey("Master's degree")).toBe('mastersdegree');
    expect(compactKey('high_school')).toBe('highschool');
  });
});
