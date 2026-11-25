// Global assignment: within one scope (repeated card, or section for ungrouped fields) a field key goes
// to at most one control. Greedy by descending confidence; losers fall back to their next candidate.
import type { FieldScores, ScoredCandidate } from './classify';
import { asksPartScore, scoreSubject } from './languageAsked';
import type { Classification, FieldContext, FieldKey, SectionKey } from './types';

/**
 * Keys that may legitimately be mapped by several controls of one scope:
 * contact.email (confirm-email field) and education.degree (forms ask for both 学历 and 学位).
 */
export const ALLOW_DUPLICATE_KEYS: ReadonlySet<FieldKey> = new Set(['contact.email', 'education.degree']);

/**
 * A score per test or language (四级成绩 beside 六级成绩): repeated in one scope only when each control names a
 * different one, and the question then picks the entry (languageRow in values.ts). A box for one skill's part of a
 * test (听力成绩) never takes it.
 */
const SCORE_KEY: FieldKey = 'languages.score';

/**
 * Places a form may ask twice, once on a picker (a tree of regions, a list) and once in a text box (所在地点 and
 * 目前所在地): one of each kind may take the place. Two boxes of one kind still share one answer.
 */
const PLACE_KEYS: ReadonlySet<FieldKey> = new Set([
  'basics.currentLocation', 'basics.nativePlace', 'basics.studentOrigin', 'basics.household',
]);

/** The key as the one-per-scope rule counts it: a place on a text box and on a picker count apart. */
function takenAs(key: FieldKey, ctx: FieldContext): string {
  if (!PLACE_KEYS.has(key)) return key;
  const kind = ctx.control.kind;
  return `${key}@${kind === 'text' || kind === 'textarea' ? 'typed' : 'picked'}`;
}

/** Confidence ceiling of a fallback assignment (the best key went to another control). */
const FALLBACK_CAP = 0.7;

/** Candidates below this never become a classification's key. */
const DEFAULT_MIN_CONFIDENCE = 0.5;

/** Scope in which keys must be unique. */
/**
 * The best guess belongs to another part of the form, and so does another just as good: the bare label (描述 under 作品)
 * says nothing of which part it is, so neither is taken.
 */
function tiedElsewhere(candidates: readonly ScoredCandidate[]): boolean {
  const [first, second] = candidates;
  return !!first?.elsewhere && !!second?.elsewhere && Math.abs(first.confidence - second.confidence) < 1e-6;
}

export function scopeKey(ctx: FieldContext, section: SectionKey | null): string {
  return ctx.group ? `g:${ctx.group.key}#${ctx.group.index}` : `s:${section ?? ''}`;
}

const topThree = (cands: ScoredCandidate[]) =>
  cands.slice(0, 3).map((c) => ({ fieldKey: c.fieldKey, confidence: c.confidence }));

export function assign(
  contexts: FieldContext[],
  scores: FieldScores[],
  sections: (SectionKey | null)[],
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): Classification[] {
  const out: Classification[] = contexts.map((_, i) => {
    const s = scores[i]!;
    const section = sections[i] ?? null;
    if (s.neverFill) return { fieldKey: null, confidence: 1, section, candidates: [], reason: 'never_fill' };
    return { fieldKey: null, confidence: s.candidates[0]?.confidence ?? 0, section, candidates: topThree(s.candidates) };
  });

  interface Claim {
    index: number;
    cand: ScoredCandidate;
    scope: string;
  }
  const claims: Claim[] = [];
  contexts.forEach((ctx, index) => {
    const s = scores[index]!;
    if (s.neverFill) return;
    const scope = scopeKey(ctx, sections[index] ?? null);
    for (const cand of s.candidates) if (cand.confidence >= minConfidence) claims.push({ index, cand, scope });
  });

  // Highest confidence first, then stronger evidence, then document order. Because every control
  // lists its candidates by descending confidence, the first claim a control wins is its best free one.
  claims.sort(
    (a, b) => b.cand.confidence - a.cand.confidence ||
      b.cand.score - a.cand.score ||
      b.cand.weight - a.cand.weight ||
      a.index - b.index,
  );

  const assigned = new Set<number>();
  const taken = new Map<string, Set<FieldKey>>();
  const scoreSubjects = new Map<string, Set<string>>();
  for (const { index, cand, scope } of claims) {
    if (assigned.has(index)) continue;
    // Its own key went to another control: a key of another part of the form is no second answer.
    if (cand.elsewhere && (cand !== scores[index]!.candidates[0] || tiedElsewhere(scores[index]!.candidates))) continue;
    let keys = taken.get(scope);
    if (!keys) taken.set(scope, (keys = new Set()));
    if (cand.fieldKey === SCORE_KEY) {
      const label = contexts[index]!.evidence[0]?.text ?? '';
      if (asksPartScore(label)) continue;
      let subjects = scoreSubjects.get(scope);
      if (!subjects) scoreSubjects.set(scope, (subjects = new Set()));
      const subject = scoreSubject(label);
      if (subjects.has(subject)) continue;
      subjects.add(subject);
    } else if (keys.has(takenAs(cand.fieldKey, contexts[index]!)) && !ALLOW_DUPLICATE_KEYS.has(cand.fieldKey)) continue;
    keys.add(takenAs(cand.fieldKey, contexts[index]!));
    assigned.add(index);
    out[index]!.fieldKey = cand.fieldKey;
    // A control that lost its best key settles for a weaker guess: never above the review band.
    out[index]!.confidence = cand === scores[index]!.candidates[0] ? cand.confidence : Math.min(cand.confidence, FALLBACK_CAP);
  }
  // Controls that had plausible candidates but lost every one of them to a better control.
  for (const claim of claims) {
    const c = out[claim.index]!;
    if (!assigned.has(claim.index) && !c.reason) c.reason = 'key_taken';
  }
  return out;
}
