// String similarity used by the classifier and the option matcher.
import { containsPhrase, hasCjk, normalizeLabel } from './normalize';

function bigrams(s: string): Map<string, number> {
  const chars = [...s];
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const g = chars[i]! + chars[i + 1]!;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams (multiset). Strings shorter than 2 chars only match when equal. */
export function dice(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if ([...a].length < 2 || [...b].length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let common = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0);
  return (2 * common) / total;
}

function jaro(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true;
        bMatched[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

/** Jaro–Winkler similarity (prefix scale 0.1, up to 4 prefix chars, boost only when Jaro > 0.7). */
export function jaroWinkler(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  const j = jaro(ca, cb);
  if (j <= 0.7) return j;
  let prefix = 0;
  while (prefix < 4 && prefix < ca.length && prefix < cb.length && ca[prefix] === cb[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/** Words every question has. Two sentences that share only these are not about the same thing. */
const SMALL_WORDS = new Set(
  ('a an and any are as at be been but by can could did do does for from had has have how i if in into is it its many ' +
    'may me much my no not of on or our please should so than that the their them there this to was we were what when ' +
    'where which who why will with would yes you your').split(' '),
);

/**
 * Letters are good at spotting a typo and poor at comparing sentences: long questions look alike because of
 * "are you" and "how many". From four words on, most of what the longer text is about must be shared.
 */
function aboutTheSameThing(a: string, b: string): boolean {
  if (hasCjk(a) || hasCjk(b)) return true;
  const wordsOf = (t: string) => t.split(/[^a-z0-9]+/).filter(Boolean);
  const [wa, wb] = [wordsOf(a), wordsOf(b)];
  if (Math.max(wa.length, wb.length) < 4) return true;
  const content = (w: string[]) => new Set(w.filter((x) => !SMALL_WORDS.has(x)));
  const [ca, cb] = [content(wa), content(wb)];
  const shared = [...ca].filter((x) => cb.has(x)).length;
  return shared * 2 > Math.max(ca.size, cb.size);
}

/** Edits between two words, a swap of neighbours counting as one. */
function editDistance(a: string, b: string): number {
  let before: number[] = [];
  let last = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(last[j]! + 1, row[j - 1]! + 1, last[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, before[j - 2]! + 1);
      row[j] = best;
    }
    before = last;
    last = row;
  }
  return last[b.length]!;
}

/** "Current" and "currency" share a stem and differ too much for a typo. */
const MAX_TYPO_SHARE = 0.2;

const singular = (w: string): string => w.replace(/ies$/, 'y').replace(/s$/, '');

function isTypoOf(a: string, b: string): boolean {
  const [sa, sb] = [singular(a), singular(b)];
  return editDistance(sa, sb) <= MAX_TYPO_SHARE * Math.max(sa.length, sb.length);
}

/** Words about the act of attaching a file, and not about which file it is. */
const FILE_ACT_WORDS = new Set(['upload', 'choose', 'file', 'attach', 'drag', 'drop']);
/** From this many words on, one different word no longer changes the meaning: "need" or "require" visa sponsorship. */
const MANY_WORDS = 4;

/**
 * "Current pay" and "current age" share most of their letters and mean different things. Each word of a short
 * label has to be there in the other one, give or take a typo. Written together, as in "postcode", also counts.
 */
function sharesItsWords(a: string, b: string): boolean {
  if (hasCjk(a) || hasCjk(b)) return true;
  const wordsOf = (t: string) => t.split(/[^a-z0-9]+/).filter((w) => w && !SMALL_WORDS.has(w) && !FILE_ACT_WORDS.has(w));
  const [wa, wb] = [wordsOf(a), wordsOf(b)];
  if (wa.length === 0 || wb.length === 0) return true;
  if (jaroWinkler(wa.join(''), wb.join('')) >= 0.95) return true;
  const [fewer, more] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (fewer.length >= MANY_WORDS) return true;
  return fewer.every((w) => more.some((m) => isTypoOf(w, m)));
}

/** Enough to put a question in front of the user, and too little to fill it. */
const PHRASE_IN_QUESTION = 0.55;
const MIN_PHRASE_WORDS = 3;

function containment(longer: string, shorter: string): number {
  if (!shorter || shorter.length >= longer.length) return 0;
  if (!containsPhrase(longer, shorter)) return 0;
  const ratio = shorter.length / longer.length;
  if (ratio >= 0.5) return 0.9 * (0.8 + 0.2 * ratio);
  if (hasCjk(shorter)) return 0;
  const said = shorter.split(/[^a-z0-9]+/).filter((w) => w && !SMALL_WORDS.has(w));
  return said.length >= MIN_PHRASE_WORDS ? PHRASE_IN_QUESTION : 0;
}

/**
 * Label similarity in [0, 1]: max of exact (1), containment (0.81–0.9, scaled by length ratio ≥ 0.5,
 * word-bounded for latin text) and a fuzzy blend 0.6·dice + 0.4·Jaro–Winkler. Inputs are normalized first.
 */
export function labelSimilarity(a: string, b: string): number {
  return normalizedSimilarity(normalizeLabel(a), normalizeLabel(b));
}

/** `labelSimilarity` for inputs that already went through `normalizeLabel` (hot path of the classifier). */
export function normalizedSimilarity(na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const [longer, shorter] = na.length >= nb.length ? [na, nb] : [nb, na];
  const contain = containment(longer, shorter);
  if (!aboutTheSameThing(na, nb) || !sharesItsWords(na, nb)) return contain;
  const fuzzy = 0.6 * dice(na, nb) + 0.4 * jaroWinkler(na, nb);
  return Math.max(contain, fuzzy);
}
