// String similarity used by the classifier and the option matcher.
import { containsPhrase, normalizeLabel } from './normalize';

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

function containment(longer: string, shorter: string): number {
  if (!shorter || shorter.length >= longer.length) return 0;
  const ratio = shorter.length / longer.length;
  if (ratio < 0.5) return 0;
  if (!containsPhrase(longer, shorter)) return 0;
  return 0.9 * (0.8 + 0.2 * ratio);
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
  const fuzzy = 0.6 * dice(na, nb) + 0.4 * jaroWinkler(na, nb);
  return Math.max(contain, fuzzy);
}
