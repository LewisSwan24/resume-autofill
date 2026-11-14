// Which language a resume is written in, for the default of a new resume. E-mail addresses, links and digits say
// nothing about that, so they are left out before counting.
import type { TextLine } from '../../../../src/import/extract/types';
import type { Locale } from '../../../../src/schema';
import type { DetectedLanguage } from './types';

/** Below this many letters and characters together, the text is too short to say. */
const TOO_LITTLE = 20;

export function detectLanguage(lines: TextLine[], fallback: Locale): DetectedLanguage {
  const text = lines
    .map((l) => l.text)
    .join('\n')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\b\w+:\/\/\S+/g, ' ')
    .replace(/www\.\S+/g, ' ')
    .replace(/\d/g, '');
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (han + latin < TOO_LITTLE) return { locale: fallback, mixed: false };
  // The parser's rule: a Han character weighs as much as four letters.
  const locale: Locale = han > 0 && han * 4 >= latin ? 'zh-CN' : 'en-AU';
  const weighted = han * 4;
  const mixed = han >= 20 && latin >= 80 && Math.min(weighted, latin) / Math.max(weighted, latin) >= 0.5;
  return { locale, mixed };
}
