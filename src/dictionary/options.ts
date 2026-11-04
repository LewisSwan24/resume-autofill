// Option dictionary lookup and the option matcher used when filling select / radio / checkbox controls.
import type { OptionMatch } from '../drivers/types';
import type { OptionInfo } from '../engine/types';
import { OPTION_SYNONYMS } from './optionData';
import { compactKey, containsPhrase, hasCjk, normalizeLabel } from './normalize';
import { labelSimilarity } from './similarity';

export { OPTION_SYNONYMS };

// ------------------------------------------------------------------ confidence per tier

const CONF_SYNONYM = 0.95;
const CONF_SYNONYM_CONTAINMENT = 0.85;
const CONF_EXACT = 1;
const CONF_DIAL_CODE = 0.9;
const MIN_FUZZY = 0.85;
const FUZZY_MARGIN = 0.1;
const MIN_FUZZY_LENGTH = 4;
const MIN_CONTAIN_RATIO = 0.5;

// ------------------------------------------------------------------ placeholders

const PLACEHOLDER_LATIN =
  /^[\s\-–—_.…]*(?:please\s+)?(?:select|choose|pick)(?:\s+(?:one|an?\s+option|an?\s+item|an?\s+value|option|item|value|from\s+(?:the\s+)?list))?[\s\-–—_.…]*$/i;
const PLACEHOLDER_CJK = /^[\s\-–—_.…]*请(?:选择|选)[\s\S]*$/;
const PLACEHOLDER_DASHES = /^[\s\-–—_.…]*$/;

/** Empty-value, blank, "请选择…", "Select…" and "---" entries are prompts, not choices. */
export function isPlaceholderOption(o: OptionInfo): boolean {
  if (o.value === '') return true;
  const label = o.label.trim();
  return PLACEHOLDER_DASHES.test(label) || PLACEHOLDER_CJK.test(label) || PLACEHOLDER_LATIN.test(label);
}

// ------------------------------------------------------------------ synonym indexes

interface DomainIndex {
  /** code → compact keys of its synonyms */
  keys: Map<string, Set<string>>;
  /** compact key → codes that list it */
  owners: Map<string, Set<string>>;
}

const indexCache = new Map<string, DomainIndex>();

function domainIndex(domain: string): DomainIndex | undefined {
  const table = OPTION_SYNONYMS[domain];
  if (!table) return undefined;
  let idx = indexCache.get(domain);
  if (!idx) {
    idx = { keys: new Map(), owners: new Map() };
    for (const [code, syns] of Object.entries(table)) {
      const set = new Set(syns.map(compactKey));
      idx.keys.set(code, set);
      for (const k of set) {
        const owners = idx.owners.get(k) ?? new Set<string>();
        owners.add(code);
        idx.owners.set(k, owners);
      }
    }
    indexCache.set(domain, idx);
  }
  return idx;
}

/**
 * Canonical code for `value` within `domain`: the value itself when it is a code, else the single code
 * whose synonym list contains it. `undefined` when unknown or ambiguous.
 */
export function resolveCode(domain: string | null, value: string): string | undefined {
  if (!domain) return undefined;
  const idx = domainIndex(domain);
  if (!idx) return undefined;
  const v = value.trim();
  if (idx.keys.has(v)) return v;
  if (idx.keys.has(v.toLowerCase())) return v.toLowerCase();
  const owners = idx.owners.get(compactKey(v));
  return owners?.size === 1 ? [...owners][0] : undefined;
}

// ------------------------------------------------------------------ matching helpers

interface Cand {
  index: number;
  norm: string;
  key: string;
}

function candidates(options: OptionInfo[]): Cand[] {
  const out: Cand[] = [];
  options.forEach((o, index) => {
    if (o.disabled || isPlaceholderOption(o)) return;
    const norm = normalizeLabel(o.label);
    if (norm) out.push({ index, norm, key: compactKey(o.label) });
  });
  return out;
}

const NEGATION = /(?<![a-z])(?:no|not|non|never|without)(?![a-z])|n't|[不否无没非未勿]/;
const hasNegation = (norm: string) => NEGATION.test(norm);

/** Containment in either direction with length ratio ≥ 0.5; returns the ratio or 0. */
function containmentRatio(a: string, b: string): number {
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (!shorter || shorter.length === longer.length) return 0;
  const ratio = shorter.length / longer.length;
  if (ratio < MIN_CONTAIN_RATIO || !containsPhrase(longer, shorter)) return 0;
  return ratio;
}

function result(hits: Cand[], confidence: number): OptionMatch | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return { status: 'matched', index: hits[0]!.index, confidence };
  return { status: 'ambiguous', candidates: hits.map((h) => h.index) };
}

const NONE: OptionMatch = { status: 'none' };

/** Tier (a): options equal to a synonym of `code`, then synonym containment guarded against other codes. */
function matchSynonymGroup(domain: string, code: string, cands: Cand[]): OptionMatch | null {
  const idx = domainIndex(domain)!;
  const own = idx.keys.get(code)!;
  const exact = result(cands.filter((c) => own.has(c.key)), CONF_SYNONYM);
  if (exact) return exact;

  const synNorms = OPTION_SYNONYMS[domain]![code]!.map(normalizeLabel).filter((n) => {
    return hasCjk(n) ? [...n].length >= 2 : n.length >= 4;
  });
  const hits = cands.filter((c) => {
    const owners = idx.owners.get(c.key);
    if (owners && !owners.has(code)) return false; // the option is another code's label
    return synNorms.some((syn) => containmentRatio(c.norm, syn) > 0 && hasNegation(c.norm) === hasNegation(syn));
  });
  return result(hits, CONF_SYNONYM_CONTAINMENT);
}

/** What follows a place name: a comma, or a region code ending the label or followed by a comma. */
const REGION_AFTER_PLACE = /^(?:\s*,|\s+[A-Z]{2,4}(?:\s*,|\s*$))/;
const CONF_PLACE = 0.8;

const DIAL_CODE = /^\+?(\d{1,4})$/;

/**
 * Pick the option that best represents `value`.
 *
 * - `value` may be a canonical code of `domain` (e.g. 'master', 'yes'), a boolean (→ yes/no), free text,
 *   or an array (only the first element is considered; callers handle multi-select).
 * - Codes (and free text that is a synonym of exactly one code) use the domain's synonym group and never
 *   fall through to fuzzy matching. Free text cascades: exact → dial code → unique containment → fuzzy.
 * - Several equally good options yield `ambiguous`; the first option is never used as a fallback.
 * - Placeholders (`请选择`, `Select…`, empty value) and disabled options are never chosen.
 */
export function matchOption(
  domain: string | null,
  value: string | string[] | boolean,
  options: OptionInfo[],
): OptionMatch {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return NONE;

  let text: string;
  let effectiveDomain = domain;
  let code: string | undefined;
  if (typeof first === 'boolean') {
    code = first ? 'yes' : 'no';
    if (!effectiveDomain || !OPTION_SYNONYMS[effectiveDomain]?.[code]) effectiveDomain = 'yesNo';
    text = code;
  } else {
    text = first.trim();
    code = resolveCode(effectiveDomain, text);
  }
  if (!text) return NONE;

  const cands = candidates(options);
  if (cands.length === 0) return NONE;

  if (code && effectiveDomain) {
    const group = matchSynonymGroup(effectiveDomain, code, cands);
    if (group) return group;
    // Codes never reach containment/fuzzy tiers; only a literal label equal to the text may still match.
    return result(cands.filter((c) => c.key === compactKey(text)), CONF_EXACT) ?? NONE;
  }

  // (b) exact normalized equality
  const key = compactKey(text);
  const exact = result(cands.filter((c) => c.key === key), CONF_EXACT);
  if (exact) return exact;

  // dial codes: "+61" ↔ "Australia (+61)", but not "+1-242"
  const dial = DIAL_CODE.exec(text);
  if (dial) {
    const re = new RegExp(`\\+${dial[1]}(?![\\d-])`);
    const hit = result(cands.filter((c) => re.test(c.norm)), CONF_DIAL_CODE);
    if (hit) return hit;
  }

  // A place followed by its region: "Brisbane" ↔ "Brisbane QLD, Australia". Before containment, so a
  // second place of that name makes it ambiguous rather than leaving whichever is short enough.
  if (text.length >= MIN_FUZZY_LENGTH && !hasCjk(text)) {
    const prefix = text.toLowerCase();
    const hits = cands.filter((c) => {
      const label = options[c.index]!.label.trim();
      return label.toLowerCase().startsWith(prefix) && REGION_AFTER_PLACE.test(label.slice(text.length));
    });
    const place = result(hits, CONF_PLACE);
    if (place) return place;
  }

  // (c) unique containment, length ratio ≥ 0.5
  const norm = normalizeLabel(text);
  const contained = cands
    .map((c) => ({ c, ratio: containmentRatio(c.norm, norm) }))
    .filter((x) => x.ratio > 0);
  if (contained.length > 0) {
    const best = Math.max(...contained.map((x) => x.ratio));
    return result(contained.map((x) => x.c), 0.7 + 0.2 * best) ?? NONE;
  }

  // (d) fuzzy: ≥ 0.85 and clear of the runner-up by 0.1
  if (norm.length >= MIN_FUZZY_LENGTH) {
    const scored = cands.map((c) => ({ c, s: labelSimilarity(text, options[c.index]!.label) }));
    const best = Math.max(...scored.map((x) => x.s));
    if (best >= MIN_FUZZY) {
      const near = scored.filter((x) => best - x.s < FUZZY_MARGIN);
      return result(near.map((x) => x.c), best) ?? NONE;
    }
  }
  return NONE;
}
