// Language questions: which test or language a label asks about, and which a resume entry holds. A test someone sat
// is one language entry: the language, the test as its certificate, and its score. Chinese forms ask for English by
// test, a level (英语等级: CET-4/6, TEM-4/8) with or without its score, or a score per test (四级成绩, 六级成绩).
import { resolveCode } from '../dictionary';

/** English tests a Chinese form ranks, lowest first. Other tests are not placed against these. */
export const ENGLISH_LADDER: readonly string[] = ['cet4', 'cet6', 'tem4', 'tem8'];
const ENGLISH_TESTS: ReadonlySet<string> = new Set([...ENGLISH_LADDER, 'ielts', 'toefl', 'toeic', 'pte', 'duolingo']);

export const isEnglishTest = (code: string | undefined): boolean => code !== undefined && ENGLISH_TESTS.has(code);

/** 四六级 names both CET tests, so it says English and no more. */
const BOTH_CET = /四六级/g;
/** Tests as labels and certificates write them, with or without more words around them. */
const TEST_NAMED: ReadonlyArray<readonly [string, RegExp]> = [
  ['tem4', /专四|专业四级|TEM[-\s]?4/i],
  ['tem8', /专八|专业八级|TEM[-\s]?8/i],
  ['cet4', /(?<!专业)四级|CET[-\s]?4/i],
  ['cet6', /(?<!专业)六级|CET[-\s]?6/i],
  ['ielts', /雅思|IELTS/i],
  ['toefl', /托福|TOEFL/i],
  ['toeic', /托业|TOEIC/i],
  ['pte', /培生|\bPTE\b/i],
  ['duolingo', /多邻国|Duolingo/i],
];

/** Each language by the names forms and resumes give it. English first: a label naming two languages means English. */
const LANGUAGE_NAMES: ReadonlyArray<readonly [string, RegExp]> = [
  ['en', /英语|英文|四六级|\bEnglish\b/i],
  ['ja', /日语|日文|日本语|\bJapanese\b/i],
  ['ko', /韩语|韩文|韩国语|朝鲜语|\bKorean\b/i],
  ['de', /德语|德文|\b(?:German|Deutsch)\b/i],
  ['fr', /法语|法文|\bFrench\b/i],
  ['ru', /俄语|俄文|\bRussian\b/i],
  ['es', /西班牙语|西班牙文|\bSpanish\b/i],
  ['ar', /阿拉伯语|阿拉伯文|阿语|\bArabic\b/i],
  ['it', /意大利语|意大利文|\bItalian\b/i],
  ['pt', /葡萄牙语|葡萄牙文|\bPortuguese\b/i],
];

/** A question about the languages besides English. On a Chinese form 其他外语 follows the English question. */
const BESIDES_ENGLISH = /除(?:了)?英语|英语(?:除外|以外|之外)|非英语|其[他它]外语|other than English|besides English|apart from English/i;

/** One skill's part of a test (IELTS and the like report four beside the overall score). */
const PART_SCORE = /听力|阅读|写作|口语|\b(?:listening|reading|writing|speaking)\b/i;

/** Every test a text names, in TEST_NAMED order. */
export function testsNamed(text: string): string[] {
  const words = text.replace(BOTH_CET, '');
  return TEST_NAMED.filter(([, re]) => re.test(words)).map(([test]) => test);
}

/** Every place a text names a test, in reading order: where the name starts and ends. */
export function testsAt(text: string): { test: string; at: number; end: number }[] {
  // Blanked, not removed, so that places stay where they are in the text.
  const words = text.replace(BOTH_CET, (m) => ' '.repeat(m.length));
  const found = TEST_NAMED.flatMap(([test, re]) =>
    [...words.matchAll(new RegExp(re.source, `${re.flags}g`))].map((m) => ({ test, at: m.index, end: m.index + m[0].length })),
  );
  return found.sort((a, b) => a.at - b.at);
}

/** The language a question names, as a code; English wins when it names more than one. */
export const languageNamed = (text: string): string | undefined => LANGUAGE_NAMES.find(([, re]) => re.test(text))?.[0];

export const asksBesidesEnglish = (label: string): boolean => BESIDES_ENGLISH.test(label);

/** A score box for one skill (听力成绩, Reading score): the overall score is not its answer. */
export const asksPartScore = (label: string): boolean => PART_SCORE.test(label);

/**
 * What a score question is about, so that two score boxes in one place may each take a score only when they ask
 * about different things (四级成绩 beside 六级成绩). '' when it names no test or language.
 */
export function scoreSubject(label: string): string {
  if (asksBesidesEnglish(label)) return 'besides:en';
  const tests = testsNamed(label);
  if (tests.length > 0) return `test:${tests.join('+')}`;
  const language = languageNamed(label);
  return language ? `language:${language}` : '';
}

/** The language an entry names, as a code. */
function languageByName(entry: unknown): string | undefined {
  const name = (entry as { language?: string }).language?.trim() ?? '';
  return name ? languageNamed(name) : undefined;
}

/**
 * The test an entry's certificate is: its dictionary name, or the one test its words name ('大学英语六级（CET-6）',
 * 'CET-6 560分'). A certificate naming two tests is neither, and an entry for another language holds no English test
 * (日语四级 is not CET-4).
 */
export function testOf(entry: unknown): string | undefined {
  const cert = (entry as { certificate?: string }).certificate?.trim();
  if (!cert) return undefined;
  const named = testsNamed(cert);
  const code = resolveCode('languageCert', cert) ?? (named.length === 1 ? named[0] : undefined);
  const language = languageByName(entry);
  return code && ENGLISH_TESTS.has(code) && language && language !== 'en' ? undefined : code;
}

/** The language of an entry, as a code: by its name, or else by the test it holds. */
export function languageOf(entry: unknown): string | undefined {
  const byName = languageByName(entry);
  if (byName) return byName;
  const test = testOf(entry);
  if (!test) return undefined;
  if (ENGLISH_TESTS.has(test)) return 'en';
  return test.startsWith('jlpt_') ? 'ja' : undefined;
}

/**
 * Of the entries that may answer an English question, the one to use. When every one holds a test on the CET/TEM
 * ladder, the highest; otherwise the first in the resume, since nothing says how IELTS or TOEIC compares with CET-4.
 * Entries with no certificate step aside for those with one.
 */
export function bestEnglish<T extends { entry: unknown }>(rows: T[]): T | undefined {
  const certified = rows.filter((r) => (r.entry as { certificate?: string }).certificate?.trim());
  const pool = certified.length > 0 ? certified : rows;
  const rank = (r: T) => ENGLISH_LADDER.indexOf(testOf(r.entry) ?? '');
  if (pool.length === 0 || pool.some((r) => rank(r) < 0)) return pool[0];
  return pool.reduce((top, r) => (rank(r) > rank(top) ? r : top));
}
