// UI labels for enum codes, taken from the option dictionary (first Chinese / first English synonym).
import { OPTION_SYNONYMS, hasCjk } from '../dictionary';
import { ENUM_VALUES, SETTING_ENUM_VALUES } from '../schema';
import type { Language } from '../i18n';

/** Display label of `code` in `domain` for the UI language; falls back to the code itself. */
export function enumLabel(domain: string, code: string, language: Language): string {
  const synonyms = OPTION_SYNONYMS[domain]?.[code];
  if (!synonyms || synonyms.length === 0) return code;
  const preferred = synonyms.find((s) => (language === 'zh' ? hasCjk(s) : !hasCjk(s)));
  return preferred ?? synonyms[0]!;
}

export interface EnumOption {
  value: string;
  label: string;
}

/** All codes of the domain (schema order) with their labels. */
export function enumOptions(domain: string, language: Language): EnumOption[] {
  const codes = ENUM_VALUES[domain] ?? SETTING_ENUM_VALUES[domain] ?? Object.keys(OPTION_SYNONYMS[domain] ?? {});
  return codes.map((value) => ({ value, label: enumLabel(domain, value, language) }));
}
