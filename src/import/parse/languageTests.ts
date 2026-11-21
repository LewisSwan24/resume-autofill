// English tests a resume lists ("英语六级 520 分", "CET4：560", "IELTS 7.0"): the test and, when one follows its name, its
// score. They go to the test-score list of one English entry, always to be checked. Only where a resume lists what
// someone holds: a line about work done can name a test without anyone having sat it.
import { isEnglishTest, testsAt } from '../../engine/languageAsked';
import type { Locale } from '../../schema';
import type { DraftField } from './types';

/** Scores each test can have: anything else beside its name (a year, a count) is not its score. */
const SCORE_RANGE: Readonly<Record<string, readonly [number, number]>> = {
  cet4: [220, 710],
  cet6: [220, 710],
  tem4: [0, 100],
  tem8: [0, 100],
  ielts: [1, 9],
  toefl: [0, 120],
  toeic: [10, 990],
  pte: [10, 90],
  duolingo: [10, 160],
};

/** A number standing on its own, not part of a date (2023.06, 2023年) or of a longer number. */
const NUMBER = /(?<![\d.])(\d{1,3}(?:\.\d)?)(?![\d.]|\s*[年月日.\-/])/g;

function scoreOf(test: string, text: string): string | undefined {
  const range = SCORE_RANGE[test];
  if (!range) return undefined;
  for (const m of text.matchAll(NUMBER)) {
    const n = Number(m[1]);
    if (n >= range[0] && n <= range[1] && (test === 'ielts' || Number.isInteger(n))) return m[1];
  }
  return undefined;
}

/** The tests on these lines, each once, in reading order. `lineIndexes` are positions in `lines`. */
export function readLanguageTests(lineIndexes: readonly number[], lines: readonly { text: string }[], locale: Locale): DraftField[] {
  const seen = new Set<string>();
  const out: DraftField[] = [];
  for (const i of lineIndexes) {
    const text = lines[i]!.text;
    const found = testsAt(text).filter((t) => isEnglishTest(t.test));
    found.forEach((t, k) => {
      if (seen.has(t.test)) return;
      seen.add(t.test);
      // Its score is the first that fits, between its name and the next test's.
      const score = scoreOf(t.test, text.slice(t.end, found[k + 1]?.at ?? text.length));
      const n = seen.size - 1;
      out.push({ path: `languages.0.tests.${n}.test`, value: t.test, certainty: 'check', line: i });
      if (score) out.push({ path: `languages.0.tests.${n}.score`, value: score, certainty: 'check', line: i });
    });
  }
  if (out.length === 0) return out;
  return [{ path: 'languages.0.language', value: locale === 'zh-CN' ? '英语' : 'English', certainty: 'check', line: out[0]!.line }, ...out];
}
