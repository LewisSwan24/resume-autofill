// The test-score list of a language entry: names for its codes, and the in-version upgrade that fills it from what
// older resumes wrote as a certificate and a score.
import { testOf } from '../engine/languageAsked';
import { LANGUAGE_TESTS, type LanguageEntry, type LanguageTestCode, type Profile } from './resume';

/** How a test is written on forms and resumes, the same in either language. `other` has no name of its own. */
export const LANGUAGE_TEST_LABELS: Readonly<Record<LanguageTestCode, string>> = {
  cet4: 'CET-4',
  cet6: 'CET-6',
  tem4: 'TEM-4',
  tem8: 'TEM-8',
  ielts: 'IELTS',
  toefl: 'TOEFL',
  toeic: 'TOEIC',
  pte: 'PTE',
  duolingo: 'Duolingo',
  jlpt_n1: 'JLPT N1',
  jlpt_n2: 'JLPT N2',
  jlpt_n3: 'JLPT N3',
  other: '',
};

const KNOWN: ReadonlySet<string> = new Set(LANGUAGE_TESTS.filter((t) => t !== 'other'));

export const isLanguageTestCode = (code: string | null | undefined): code is LanguageTestCode => code != null && KNOWN.has(code);

/**
 * The list an entry written before it existed would have: its certificate names exactly one test and it has a score.
 * Nothing is taken away; an entry that already has a list keeps it.
 */
export function derivedTests(entry: LanguageEntry): LanguageEntry['tests'] {
  if (entry.tests.length > 0 || !entry.score.trim()) return entry.tests;
  const test = testOf(entry);
  return isLanguageTestCode(test) ? [{ test, score: entry.score.trim(), date: '' }] : entry.tests;
}

/**
 * One language as a resume prints it: the language, its certificate and score as written, then each test of its list
 * with the score ("英语 CET-6 520, CET-4 560"). A certificate the list already holds is written once, from the list.
 */
export function languageLine(entry: LanguageEntry): string {
  const tests = entry.tests.flatMap((t) => (isLanguageTestCode(t.test) ? [[LANGUAGE_TEST_LABELS[t.test], t.score.trim()].filter(Boolean).join(' ')] : []));
  const own = testOf(entry);
  const repeated = own !== undefined && entry.tests.some((t) => t.test === own);
  const head = [entry.language, ...(repeated ? [] : [entry.certificate, entry.score])].map((s) => s.trim()).filter(Boolean).join(' ');
  return [head, tests.join(', ')].filter(Boolean).join(' ');
}

/** In-version upgrade run on every profile read: fills the test lists of older entries (see derivedTests). */
export function migrateLanguageTests(profile: Profile): Profile {
  let changed = false;
  const resumes = profile.resumes.map((resume) => {
    let touched = false;
    const languages = resume.languages.map((entry) => {
      const tests = derivedTests(entry);
      if (tests === entry.tests) return entry;
      touched = true;
      return { ...entry, tests };
    });
    if (!touched) return resume;
    changed = true;
    return { ...resume, languages };
  });
  return changed ? { ...profile, resumes } : profile;
}
