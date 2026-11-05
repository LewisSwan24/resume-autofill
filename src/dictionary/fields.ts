// Field-label dictionary: synonyms per FieldKey, exclusion words, and the never-auto-fill list.
import { MODULE_FIELD_SYNONYMS } from './fieldDataModules';
import { PERSONAL_FIELD_SYNONYMS, type FieldSynonym } from './fieldData';
import { containsPhrase, hasCjk, normalizeLabel, toSimplified } from './normalize';
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

/** A word that names the field only when it stands alone: "Office location" is another question. */
const TOO_GENERAL_TO_CONTAIN = new Set(['location', 'your location', '所在地', '所在地点']);

/** Synonyms this short are only trustworthy as exact (normalized) matches. */
export function isExactOnlySynonym(syn: string): boolean {
  const t = normalizeLabel(syn);
  if (TOO_GENERAL_TO_CONTAIN.has(t)) return true;
  return hasCjk(t) ? [...t].length <= 1 : t.length <= 2;
}

/** Labels of fields that must never be auto-filled. */
export const NEVER_FILL: { zh: string[]; en: string[] } = {
  zh: ['请勿填写', '不要填写', '请留空', '验证码', '短信验证码', '图形验证码', '密码', '登录密码', '确认密码', '同意', '声明', '承诺书', '我已阅读', '隐私政策', '隐私声明', '用户协议'],
  en: [
    'leave this blank', 'leave blank', 'leave this empty', 'leave this field blank', 'leave this field empty', 'if you are human', 'if you are a human', 'captcha', 'verification code', 'security code', 'sms code', 'one-time code', 'otp',
    'password', 'consent', 'agree', 'i agree', 'privacy policy', 'terms and conditions', 'terms of use',
    'terms & conditions', 'i accept', 'i declare', 'declaration', 'address line 2', 'address line two', 'address line 3', 'address line three', 'second address line', 'address 2', 'address 3',
  ],
};

// Upload boxes the page reads to fill the form itself: uploading there would overwrite what was just filled.
const RESUME_PARSER = [
  'autofill', 'auto-fill', 'auto fill', 'parse resume', 'parse your resume', 'resume parser',
  '自动解析', '简历解析', '解析简历', '智能解析', '一键解析', '自动填写', '自动填充',
];

const OTHER_PERSON_HEADINGS = [
  'refer', 'friend', 'notify', 'manager', 'supervisor', 'emergency', 'next of kin', 'guardian', 'spouse', 'partner',
  'parent', 'colleague', 'recommend', 'in case of', 'other contact', 'alternate contact',
  '推荐', '内推', '紧急', '家属', '家庭', '亲属', '监护', '上级', '主管', '证明人', '联系人',
];

/** A heading that says the fields under it are about someone other than the applicant. */
export function isOtherPersonHeading(title: string): boolean {
  const t = normalizeLabel(title);
  return OTHER_PERSON_HEADINGS.some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'));
}

/** True when an upload box's label says the page will read the file and fill the form from it. */
export function isResumeParser(label: string): boolean {
  const t = normalizeLabel(label);
  return !!t && RESUME_PARSER.some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'));
}

// Questions that legitimately contain "同意/consent/agree" wording but are ordinary profile fields.
const NEVER_FILL_EXEMPT = ['调剂', '调配', '外派', '服从', '异地', 'relocat', 'sponsor', 'work rights', 'work authori', 'background check', 'reference check'];

// Someone signing their name to a statement, whatever the statement is about.
const DECLARATIONS = ['i declare', 'i certify', 'i confirm', 'i acknowledge', 'i attest', 'i agree', 'i hereby', 'hereby', '声明', '承诺', '本人确认', '本人保证'];

/** A second address line by its name in the page, which the label may not say: the street fits the first. */
const SPARE_ADDRESS_LINE = /(?:address|addr|street)(?:[\s_.-]*line)?[\s_.-]*[2-9](?![0-9])/i;

export function namesSpareAddressLine(name: string | null | undefined): boolean {
  return !!name && SPARE_ADDRESS_LINE.test(name);
}

/** True when the label looks like a captcha / password / consent / declaration control. */
const ASKS_FOR_CONSENT =
  /\bconsent|\bhereby\b|\b(?:i|you|we)\s+(?:have\s+)?(?:agree|accept|declare|acknowledge|authori[sz]e|certify|confirm|attest|understand|warrant|read|give|grant|allow|permit)\b|\bdo you (?:agree|accept)\b|\bagree (?:to|that|with)\b|\bterms (?:and|&) conditions\b|\bby (?:choosing|selecting|ticking|checking|submitting|applying|continuing|proceeding|clicking|signing)\b|同意|授权|承诺|声明|(?:本人|我)确认|本人保证|已阅读|知悉/i;

/**
 * Wording above a question that asks for consent, as a sentence and not just by naming a policy or an agreement.
 * A short question about sponsorship or work rights is an ordinary field, but those words in a passage that also
 * asks you to agree do not make its answers any less of a consent.
 */
export function asksForConsent(passage: string): boolean {
  return ASKS_FOR_CONSENT.test(toSimplified(passage));
}

export function isNeverFill(label: string): boolean {
  const t = normalizeLabel(label);
  if (!t) return false;
  if (DECLARATIONS.some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'))) return true;
  if (NEVER_FILL_EXEMPT.some((w) => containsPhrase(t, w, 'prefix'))) return false;
  return [...NEVER_FILL.zh, ...NEVER_FILL.en].some((w) => containsPhrase(t, normalizeLabel(w), 'prefix'));
}
