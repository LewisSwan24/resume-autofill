// Field-label dictionary: synonyms per FieldKey, exclusion words, and the never-auto-fill list.
import { MODULE_FIELD_SYNONYMS } from './fieldDataModules';
import { PERSONAL_FIELD_SYNONYMS, type FieldSynonym } from './fieldData';
import { containsPhrase, hasCjk, normalizeLabel } from './normalize';
import type { FieldKey } from '../schema/fieldKeys';

export type { FieldSynonym };

/**
 * zh + en label synonyms for every FIELD_KEY (derived keys such as basics.fullName and contact.phoneFull
 * included). Optional `exclude` words veto the key when the label contains them.
 * Note: synonyms of ≤ 1 CJK char or ≤ 2 latin chars (e.g. "名", "省", "To") are exact-only — see
 * `isExactOnlySynonym`; consumers must not use them for containment/fuzzy matching.
 */
export const FIELD_SYNONYMS: Record<FieldKey, FieldSynonym> = {
  ...PERSONAL_FIELD_SYNONYMS,
  ...MODULE_FIELD_SYNONYMS,
};

/** All zh + en synonyms for a key ([] for unknown keys). */
export function allSynonyms(key: FieldKey): string[] {
  const e = FIELD_SYNONYMS[key];
  return e ? [...e.zh, ...e.en] : [];
}

/** True when the label contains one of the key's exclusion words. */
export function isExcluded(key: FieldKey, label: string): boolean {
  const ex = FIELD_SYNONYMS[key]?.exclude;
  if (!ex?.length) return false;
  const t = normalizeLabel(label);
  return ex.some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'));
}

/** Synonyms this short are only trustworthy as exact (normalized) matches. */
export function isExactOnlySynonym(syn: string): boolean {
  const t = normalizeLabel(syn);
  return hasCjk(t) ? [...t].length <= 1 : t.length <= 2;
}

/** Labels of fields that must never be auto-filled. */
export const NEVER_FILL: { zh: string[]; en: string[] } = {
  zh: ['验证码', '短信验证码', '图形验证码', '密码', '登录密码', '确认密码', '同意', '声明', '承诺书', '我已阅读', '隐私政策', '隐私声明', '用户协议'],
  en: [
    'captcha', 'verification code', 'security code', 'sms code', 'one-time code', 'otp',
    'password', 'consent', 'agree', 'i agree', 'privacy policy', 'terms and conditions', 'terms of use',
    'terms & conditions', 'i accept', 'i declare', 'declaration',
  ],
};

// Upload boxes the page reads to fill the form itself: uploading there would overwrite what was just filled.
const RESUME_PARSER = [
  'autofill', 'auto-fill', 'auto fill', 'parse resume', 'parse your resume', 'resume parser',
  '自动解析', '简历解析', '解析简历', '智能解析', '一键解析', '自动填写', '自动填充',
];

/** True when an upload box's label says the page will read the file and fill the form from it. */
export function isResumeParser(label: string): boolean {
  const t = normalizeLabel(label);
  return !!t && RESUME_PARSER.some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'));
}

// Questions that legitimately contain "同意/consent/agree" wording but are ordinary profile fields.
const NEVER_FILL_EXEMPT = ['调剂', '调配', '外派', '服从', '异地', 'relocat', 'sponsor', 'work rights', 'work authori', 'background check', 'reference check'];

/** True when the label looks like a captcha / password / consent / declaration control. */
export function isNeverFill(label: string): boolean {
  const t = normalizeLabel(label);
  if (!t) return false;
  if (NEVER_FILL_EXEMPT.some((w) => containsPhrase(t, w, 'prefix'))) return false;
  return [...NEVER_FILL.zh, ...NEVER_FILL.en].some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'));
}
