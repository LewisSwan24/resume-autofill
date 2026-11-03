// Text normalization shared by the dictionaries, classifier and option matcher.

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;

export function hasCjk(s: string): boolean {
  return CJK.test(s);
}

// Boilerplate that carries no field meaning. Order matters: phrases first, punctuation afterwards.
const NOISE_PHRASES: RegExp[] = [
  /\b(?:required|optional)\b/g,
  /\bplease\s+(?:enter|select|input|choose|fill\s+in|type|provide|upload)\b/g,
  /(?:非必填|必填|选填|必选)/g,
  /请(?:输入|选择|填写|选填|上传|选)/g,
];

// ( ) [ ] * : plus sentence punctuation. Full-width forms are already folded by NFKC.
const PUNCTUATION = /[*:()[\]?!;,。、]/g;

/**
 * Canonical comparable form of a label: NFKC (full-width → half-width), lower-case, noise phrases
 * and decoration removed, whitespace collapsed (and dropped between adjacent CJK characters).
 */
export function normalizeLabel(s: string): string {
  let t = s.normalize('NFKC').toLowerCase();
  t = t.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2013\u2014]/g, '-');
  t = t.replace(/\(s\)/g, 's');
  for (const re of NOISE_PHRASES) t = t.replace(re, ' ');
  t = t.replace(PUNCTUATION, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/(?<=[\u3400-\u9fff\uf900-\ufaff]) (?=[\u3400-\u9fff\uf900-\ufaff])/g, '');
  return t;
}

/** Aggressive key for exact comparisons: normalized, then spaces / hyphens / slashes / dots / apostrophes dropped. */
export function compactKey(s: string): string {
  return normalizeLabel(s).replace(/[\s\-_/.'"·]/g, '');
}

/** CJK characters as unigrams + bigrams, latin/digit words as lower-case words. De-duplicated, in order. */
export function tokens(s: string): string[] {
  const n = normalizeLabel(s);
  const out: string[] = [];
  let cursor = 0;
  const pushWords = (chunk: string) => {
    for (const w of chunk.split(/[^a-z0-9+#]+/)) if (w) out.push(w);
  };
  for (const m of n.matchAll(CJK_RUN)) {
    pushWords(n.slice(cursor, m.index));
    const run = m[0];
    const chars = [...run];
    out.push(...chars);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
    cursor = m.index + run.length;
  }
  pushWords(n.slice(cursor));
  return [...new Set(out)];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LATIN_PHRASE = /^[a-z0-9 .'\-/&+#]+$/;

/**
 * Whether `text` contains `phrase` (both should already be normalized).
 * Phrases without CJK must start (mode 'prefix') or start and end (mode 'word') on a word boundary,
 * so "man" is not found in "woman". CJK-bearing phrases match as plain substrings.
 */
export function containsPhrase(text: string, phrase: string, mode: 'word' | 'prefix' = 'word'): boolean {
  if (!phrase) return false;
  if (!LATIN_PHRASE.test(phrase)) return text.includes(phrase);
  const tail = mode === 'word' ? '(?![a-z0-9])' : '';
  return new RegExp(`(?<![a-z0-9])${escapeRe(phrase)}${tail}`).test(text);
}
