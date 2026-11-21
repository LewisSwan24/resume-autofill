// UI labels for enum codes, taken from the option dictionary (first Chinese / first English synonym).
import { OPTION_SYNONYMS, hasCjk } from '../dictionary';
import { ENUM_VALUES, LANGUAGE_TESTS, LANGUAGE_TEST_LABELS, SETTING_ENUM_VALUES, isLanguageTestCode } from '../schema';
import type { Language } from '../i18n';

/** Codes of the editor's own choices that no page field has as a domain. */
const EDITOR_ENUM_VALUES: Readonly<Record<string, readonly string[]>> = { languageTest: LANGUAGE_TESTS };

/** Display label of `code` in `domain` for the UI language; falls back to the code itself. */
export function enumLabel(domain: string, code: string, language: Language): string {
  if (domain === 'languageTest') return testLabel(code, language);
  const synonyms = OPTION_SYNONYMS[domain]?.[code];
  if (!synonyms || synonyms.length === 0) return code;
  const preferred = synonyms.find((s) => (language === 'zh' ? hasCjk(s) : !hasCjk(s)));
  return preferred ?? synonyms[0]!;
}

/** A test by the name forms use (CET-6, IELTS), with its Chinese name beside it in Chinese: CET-6（英语六级）. */
function testLabel(code: string, language: Language): string {
  if (!isLanguageTestCode(code)) return enumLabel('languageCert', code, language);
  const name = LANGUAGE_TEST_LABELS[code];
  const zh = language === 'zh' ? OPTION_SYNONYMS.languageCert?.[code]?.find((s) => hasCjk(s)) : undefined;
  return zh ? `${name}（${zh}）` : name;
}

export interface EnumOption {
  value: string;
  label: string;
}

/** All codes of the domain (schema order) with their labels. */
export function enumOptions(domain: string, language: Language): EnumOption[] {
  const codes =
    ENUM_VALUES[domain] ?? SETTING_ENUM_VALUES[domain] ?? EDITOR_ENUM_VALUES[domain] ?? Object.keys(OPTION_SYNONYMS[domain] ?? {});
  return codes.map((value) => ({ value, label: enumLabel(domain, value, language) }));
}
