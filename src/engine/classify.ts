// Classify: score every control against the field-key dictionary, then assign keys globally (assign.ts).
import {
  FIELD_SYNONYMS,
  askedFor,
  isExactOnlySynonym,
  isExcluded,
  countryAskedAbout,
  isNeverFill,
  namesSpareAddressLine,
  isOtherPersonHeading,
  isResumeParser,
  matchSection,
  normalizeLabel,
  normalizedSimilarity,
} from '../dictionary';
import { ABOUT_SOMEONE_ELSE } from '../dictionary/sections';
import { FIELD_KEYS, getFieldKeyDef, type FieldKeyDef } from '../schema/fieldKeys';
import { assign } from './assign';
import type { Classification, Control, FieldContext, FieldKey, SectionKey } from './types';

export const FILL_THRESHOLD = 0.75;
export const REVIEW_THRESHOLD = 0.5;

// ---- tuning constants -----------------------------------------------------------------------------------

/** Added to the score of a key that legitimately appears in the control's section. */
const IN_SECTION_BONUS = 0.05;
/** Extra bonus when the section is the key's own (first listed) section: family.name beats emergencyContact.name in 家庭成员. */
const PRIMARY_SECTION_BONUS = 0.03;
/** The bonus only lifts evidence that is already a plausible match. */
const BONUS_MIN_RAW = 0.4;
/** basics.* / contact.* keys may appear in any section. */
const GLOBAL_MODULE_FACTOR = 0.9;
/** Any other key outside its sections (kept as a weaker candidate so "About you" can still reach selfIntroduction). */
const OUT_OF_SECTION_FACTOR = 0.85;
/** Penalty when the control kind cannot hold the key's value type. */
const TYPE_MISMATCH_FACTOR = 0.5;
/** A name/id attribute equal to a multi-word synonym ("linkedin_url") is deliberate: weigh it more than a fuzzy guess. */
const NAME_ID_DISTINCT_WEIGHT = 0.8;
/** Candidates this close to the best are ambiguous: none may exceed AMBIGUOUS_CAP (→ needs review). */
const AMBIGUITY_MARGIN = 0.02;
export const AMBIGUOUS_CAP = 0.7;
/** This many bare labels (name, email, phone...) under no heading read as one person's details. */
const MIN_BARE_LABELS_FOR_ONE_PERSON = 3;
/** Similarities below this are ignored. */
const MIN_SIMILARITY = 0.45;
const MIN_CANDIDATE = 0.3;
/** Inferred sections (no usable heading) are reported with a discount. */
const INFERRED_SECTION_FACTOR = 0.8;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---- synonym index --------------------------------------------------------------------------------------

interface Synonym {
  norm: string;
  exactOnly: boolean;
}
interface KeyEntry {
  def: FieldKeyDef;
  synonyms: Synonym[];
}

let keyEntries: KeyEntry[] | null = null;

function entries(): KeyEntry[] {
  if (!keyEntries) {
    keyEntries = FIELD_KEYS.map((def) => {
      const syn = FIELD_SYNONYMS[def.key];
      const all = syn ? [...syn.zh, ...syn.en] : [];
      const seen = new Set<string>();
      const synonyms: Synonym[] = [];
      for (const s of all) {
        const norm = normalizeLabel(s);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        synonyms.push({ norm, exactOnly: isExactOnlySynonym(s) });
      }
      return { def, synonyms };
    });
  }
  return keyEntries;
}

interface SimHit {
  key: FieldKey;
  sim: number;
  /** Exact equality with a multi-word synonym. */
  distinct: boolean;
}

/** A question that asks for X counts as the label X, a little below X said plainly. */
const ASKED_FACTOR = 0.95;
/**
 * "Your phone number" is the applicant's. Outside a section about someone else, a family member's or a referee's key
 * drops this far behind, so it no longer ties with the applicant's own.
 */
const YOURS_FACTOR = 0.9;

const simCache = new Map<string, SimHit[]>();
const MAX_SIM_CACHE = 4000;

/** Best similarity of one evidence text to every key (exclusion words and exact-only synonyms honoured). */
function similarityHits(text: string): SimHit[] {
  const norm = normalizeLabel(text);
  if (!norm) return [];
  const asked = askedFor(text);
  const askedNorm = asked ? normalizeLabel(asked) : '';
  const viaAsk = askedNorm !== '' && askedNorm !== norm;
  const cacheKey = viaAsk ? JSON.stringify([norm, askedNorm]) : norm;
  const cached = simCache.get(cacheKey);
  if (cached) return cached;
  const hits: SimHit[] = [];
  for (const { def, synonyms } of entries()) {
    let best = 0;
    let distinct = false;
    for (const s of synonyms) {
      let sim: number;
      if (s.exactOnly) sim = s.norm === norm ? 1 : 0;
      else sim = normalizedSimilarity(norm, s.norm);
      if (viaAsk) {
        const askedSim = ASKED_FACTOR * (s.exactOnly ? (s.norm === askedNorm ? 1 : 0) : normalizedSimilarity(askedNorm, s.norm));
        if (askedSim > sim) sim = askedSim;
      }
      if (sim > best) {
        best = sim;
        distinct = sim === 1 && s.norm.includes(' ');
      }
    }
    if (best < MIN_SIMILARITY) continue;
    if (isExcluded(def.key, text)) continue;
    hits.push({ key: def.key, sim: best, distinct });
  }
  if (simCache.size >= MAX_SIM_CACHE) simCache.clear();
  simCache.set(cacheKey, hits);
  return hits;
}

// ---- type compatibility ---------------------------------------------------------------------------------

function isSingleCheckbox(c: Control): boolean {
  return c.kind === 'checkbox' && !c.options;
}

/** 1 when a control of this kind can hold the key's value, else TYPE_MISMATCH_FACTOR. */
export function typeFactor(def: FieldKeyDef, control: Control): number {
  const t = def.type;
  const kind = control.kind;
  if (kind === 'file') return t === 'file' ? 1 : TYPE_MISMATCH_FACTOR;
  if (t === 'file') return TYPE_MISMATCH_FACTOR;
  if (isSingleCheckbox(control)) return t === 'bool' ? 1 : TYPE_MISMATCH_FACTOR;
  if (kind === 'date') return t === 'date' || t === 'period' ? 1 : TYPE_MISMATCH_FACTOR;
  const text = kind === 'text' || kind === 'textarea' || kind === 'richtext';
  switch (t) {
    case 'bool':
      return text || kind === 'cascader' ? TYPE_MISMATCH_FACTOR : 1;
    case 'longtext':
      return kind === 'textarea' || kind === 'richtext' || kind === 'text' ? 1 : TYPE_MISMATCH_FACTOR;
    case 'date':
      return kind === 'text' ? 1 : TYPE_MISMATCH_FACTOR;
    case 'period':
      return text ? 1 : TYPE_MISMATCH_FACTOR;
    default:
      return 1;
  }
}

// ---- scoring --------------------------------------------------------------------------------------------

export interface ScoredCandidate {
  fieldKey: FieldKey;
  confidence: number;
  /** Weight of the strongest evidence behind this candidate (assignment tie-break). */
  weight: number;
  /** Confidence before the cap at 1: keeps strong candidates ordered (bonuses can lift several above 1). */
  score: number;
  /** A key of another part of the form than the one the control is in (a school's city under 基本信息). */
  elsewhere?: true;
}

export interface FieldScores {
  /** Captcha / password / consent control: never fill. */
  neverFill: boolean;
  /** Sorted by confidence desc. */
  candidates: ScoredCandidate[];
}

/** A question that names its country and only that: clear enough to fill, on a list with the answers on it. */
const ASKED_COUNTRY_CONFIDENCE = 0.85;
/** Where a question about a place is about where the applicant is, not a job, a school or a project. */
const ABOUT_THE_APPLICANT = new Set<SectionKey>(['basics', 'contact', 'jobIntention', 'workRights', 'diversity', 'selfIntro', 'other']);

const ASKED_WITH_THE_NAME = new Set<FieldKey>(['education.degree', 'education.endDate', 'education.school', 'education.major']);

const WHOSE_IS_UNSAID = /^联系人(?:信息)?$/;
const BARE_PLACE = /^所在地点?$/;

/** A key of a part of the form other than `section`, that no word in a label could bring here. */
function belongsElsewhere(def: FieldKeyDef, section: SectionKey | null): boolean {
  if (!section || def.sections.length === 0 || def.sections.includes(section)) return false;
  if (section === 'basics' && ASKED_WITH_THE_NAME.has(def.key)) return false;
  const module = def.key.split('.')[0];
  return module !== 'basics' && module !== 'contact';
}

/**
 * Modules whose words are shared with fields asked anywhere (作品附件 is the portfolio file on its own): their keys
 * count only inside their own section, and anywhere else, a page with no heading included, stand back.
 */
const SECTION_BOUND_MODULES: ReadonlySet<string> = new Set(['works']);

function sectionAdjust(def: FieldKeyDef, raw: number, section: SectionKey | null): number {
  if (!section) return SECTION_BOUND_MODULES.has(def.key.split('.')[0]!) ? raw * OUT_OF_SECTION_FACTOR : raw;
  if (def.sections.includes(section)) {
    if (raw < BONUS_MIN_RAW) return raw;
    return raw + IN_SECTION_BONUS + (def.sections[0] === section ? PRIMARY_SECTION_BONUS : 0);
  }
  const module = def.key.split('.')[0];
  // "联系方式" under a referee is how to reach the referee, whatever else it could mean.
  // No word in the label can make it about the applicant there: at most, the applicant gets to look at it.
  if (ABOUT_SOMEONE_ELSE.has(section)) return Math.min(raw * OUT_OF_SECTION_FACTOR, AMBIGUOUS_CAP);
  // 最高学历 and 毕业院校 sit with the name on many Chinese forms, about the latest schooling.
  if (section === 'basics' && ASKED_WITH_THE_NAME.has(def.key)) return raw;
  return raw * (module === 'basics' || module === 'contact' ? GLOBAL_MODULE_FACTOR : OUT_OF_SECTION_FACTOR);
}

/** Candidates for one control within `section` (null = unknown section: no bonus / penalty). */
const RANGE_CONFIDENCE = 0.9;

/**
 * A range picker holds a span and nothing else, so its part of the file says which one, whatever its label calls it.
 * With no part of the file to go by, only a label about a span or one of its ends can say.
 */
function rangeCandidates(candidates: ScoredCandidate[], section: SectionKey | null): ScoredCandidate[] {
  const own = section ? FIELD_KEYS.find((d) => d.type === 'period' && d.sections.includes(section)) : undefined;
  if (own) return [{ fieldKey: own.key, confidence: RANGE_CONFIDENCE, weight: 1, score: RANGE_CONFIDENCE }];
  if (section) return [];
  const spans = new Map<FieldKey, ScoredCandidate>();
  for (const c of candidates) {
    const key = c.fieldKey.replace(/\.(?:startDate|endDate)$/, '.period');
    if (getFieldKeyDef(key)?.type === 'period' && !spans.has(key)) spans.set(key, { ...c, fieldKey: key, confidence: Math.min(c.confidence, AMBIGUOUS_CAP) });
  }
  return [...spans.values()];
}

export function scoreField(ctx: FieldContext, section: SectionKey | null): FieldScores {
  if (ctx.evidence.some((e) => e.source === 'fine-print' || isNeverFill(e.text))) return { neverFill: true, candidates: [] };
  const el = ctx.control.el;
  if (namesSpareAddressLine(el.getAttribute('name')) || namesSpareAddressLine(el.id)) return { neverFill: true, candidates: [] };
  if (ctx.control.kind === 'file' && ctx.evidence.some((e) => isResumeParser(e.text))) return { neverFill: true, candidates: [] };
  // Worded differently every time, and the name of the country is the point. The plan works out the answer.
  if ((ctx.control.kind === 'select' || ctx.control.kind === 'radio') && (!section || ABOUT_THE_APPLICANT.has(section)) && countryAskedAbout(ctx.evidence[0]?.text ?? '')) {
    return { neverFill: false, candidates: [{ fieldKey: 'contact.inNamedCountry', confidence: ASKED_COUNTRY_CONFIDENCE, weight: 1, score: ASKED_COUNTRY_CONFIDENCE }] };
  }

  // A legend / nearby heading that merely repeats the section title says nothing about the field itself
  // (unless it is all we have).
  const title = ctx.sectionTitle ? normalizeLabel(ctx.sectionTitle) : null;
  // A "title" that is a question ("Are you over 18 years?", "What's your email?") is the field's own question,
  // which a section never is.
  const titleAsks = ctx.sectionTitle !== undefined && ctx.sectionTitle !== null && (/[?？]\s*$/.test(ctx.sectionTitle) || askedFor(ctx.sectionTitle) !== null);
  const repeatsTitle = (e: FieldContext['evidence'][number]) =>
    title !== null && !titleAsks && (e.source === 'legend' || e.source === 'nearby-text') && normalizeLabel(e.text) === title;
  const usable = ctx.evidence.filter((e) => !repeatsTitle(e));
  const evidence = usable.length > 0 ? usable : ctx.evidence;

  // Asked of the applicant ("What's your email?", "请填写你的邮箱"), outside a section about someone else.
  const askedOfYou = (!section || !ABOUT_SOMEONE_ELSE.has(section)) && evidence.some((e) => askedFor(e.text) !== null);
  const parts = new Map<FieldKey, { miss: number; weight: number }>();
  for (const e of evidence) {
    for (const hit of similarityHits(e.text)) {
      const def = getFieldKeyDef(hit.key);
      if (!def) continue;
      const weight = e.source === 'name-id' && hit.distinct ? NAME_ID_DISTINCT_WEIGHT : e.weight;
      const s = hit.sim * weight * typeFactor(def, ctx.control);
      const acc = parts.get(hit.key) ?? { miss: 1, weight: 0 };
      acc.miss *= 1 - s; // noisy-OR
      acc.weight = Math.max(acc.weight, weight);
      parts.set(hit.key, acc);
    }
  }

  const candidates: ScoredCandidate[] = [];
  for (const [fieldKey, { miss, weight }] of parts) {
    const def = getFieldKeyDef(fieldKey)!;
    // Under a project or an award the bare word is where that was, and the resume has no such place.
    if (fieldKey === 'basics.currentLocation' && section && !def.sections.includes(section) && evidence.some((e) => BARE_PLACE.test(normalizeLabel(e.text)))) continue;
    // 导师 under an internship, a project or a club is the mentor there, not anyone from school.
    if (fieldKey === 'education.supervisor' && section !== 'education') continue;
    const someoneElses = def.sections.length > 0 && def.sections.every((s) => ABOUT_SOMEONE_ELSE.has(s));
    const score = round3(sectionAdjust(def, Math.min(1, 1 - miss), section) * (askedOfYou && someoneElses ? YOURS_FACTOR : 1));
    if (score >= MIN_CANDIDATE) candidates.push({ fieldKey, confidence: Math.min(1, score), weight, score, ...(belongsElsewhere(def, section) ? { elsewhere: true as const } : {}) });
  }
  candidates.sort((a, b) => b.score - a.score || b.weight - a.weight);
  if (ctx.control.dateRange) return { neverFill: false, candidates: rangeCandidates(candidates, section) };
  // 联系人 could be the applicant being reached or someone else to reach. Whoever is looking can tell; the page does not say.
  if (title && WHOSE_IS_UNSAID.test(title)) {
    for (const c of candidates) c.confidence = Math.min(c.confidence, AMBIGUOUS_CAP);
  }
  // A span with no part of the file around it does not say whose.
  if (!section) {
    for (const c of candidates) if (getFieldKeyDef(c.fieldKey)?.type === 'period') c.confidence = Math.min(c.confidence, AMBIGUOUS_CAP);
  }

  // Several keys tie for the top: the label does not say which one it is.
  const top = candidates[0];
  if (top && top.confidence > AMBIGUOUS_CAP) {
    const close = candidates.filter((c) => top.score - c.score < AMBIGUITY_MARGIN);
    // All of them: a key below the tie must not outrank it by having been left uncapped.
    if (close.length > 1) for (const c of candidates) c.confidence = Math.min(c.confidence, AMBIGUOUS_CAP);
  }
  return { neverFill: false, candidates };
}

// ---- sections -------------------------------------------------------------------------------------------

export interface SectionResult {
  section: SectionKey | null;
  confidence: number;
  /** True when guessed from the field itself rather than read from a heading. */
  inferred?: boolean;
}

/**
 * Section of a control: its heading via `matchSection`; without a usable heading, the primary section
 * of the best field match (discounted).
 */
export function classifySection(ctx: FieldContext): SectionResult {
  if (ctx.sectionTitle) {
    const m = matchSection(ctx.sectionTitle);
    if (m) return { section: m.section, confidence: m.confidence };
  }
  const best = scoreField(ctx, null).candidates[0];
  const def = best ? getFieldKeyDef(best.fieldKey) : undefined;
  if (!best || !def || best.confidence < REVIEW_THRESHOLD) return { section: null, confidence: 0 };
  return { section: def.sections[0] ?? null, confidence: round3(best.confidence * INFERRED_SECTION_FACTOR), inferred: true };
}

// ---- entry point ----------------------------------------------------------------------------------------

const isApplicantKey = (key: FieldKey): boolean => {
  const module = key.split('.')[0];
  return module === 'basics' || module === 'contact';
};

/** The one applicant key among the candidates tied for the top, if the control has such a tie. */
function tiedApplicantCandidate(scores: FieldScores): ScoredCandidate | null {
  const top = scores.candidates[0];
  if (!top) return null;
  const tied = scores.candidates.filter((c) => top.score - c.score < AMBIGUITY_MARGIN);
  if (tied.length < 2) return null;
  const own = tied.filter((c) => isApplicantKey(c.fieldKey));
  return own.length === 1 && own[0]!.score > AMBIGUOUS_CAP ? own[0]! : null;
}

/**
 * A bare "Email" under no heading may be anyone's, so alone it goes to review. On a page that is clearly
 * the applicant's own form it is the applicant's: some other field asks about the applicant outright,
 * or several bare labels together read as one person's details.
 */
function settleBareLabels(contexts: FieldContext[], scores: FieldScores[], sections: SectionResult[]): void {
  const bare = scores.flatMap((_, i) => {
    if (sections[i]!.section && !sections[i]!.inferred) return [];
    // Most headings on a flat form are the job title or "Apply". "Who referred you?" is about someone else.
    const title = contexts[i]!.sectionTitle;
    return title && isOtherPersonHeading(title) ? [] : [i];
  });
  const ties = bare.flatMap((i) => {
    const cand = tiedApplicantCandidate(scores[i]!);
    return cand ? [{ i, cand }] : [];
  });
  const outright = bare.some((i) => {
    const top = scores[i]!.candidates[0];
    if (!top || top.confidence < FILL_THRESHOLD) return false;
    return isApplicantKey(top.fieldKey) || top.fieldKey === 'attachments.resume';
  });
  if (!outright && ties.length < MIN_BARE_LABELS_FOR_ONE_PERSON) return;
  for (const { i, cand } of ties) {
    const s = scores[i]!;
    cand.confidence = Math.min(1, cand.score);
    s.candidates = [cand, ...s.candidates.filter((c) => c !== cand)];
    const def = getFieldKeyDef(cand.fieldKey);
    sections[i] = { section: def?.sections[0] ?? null, confidence: round3(cand.confidence * INFERRED_SECTION_FACTOR), inferred: true };
  }
}

/** The widget always takes the number with its code, and any other box that says so by example or in words. */
function takesDialCode(el: HTMLElement): boolean {
  if (el.closest('.PhoneInput')) return true;
  return (el.getAttribute('placeholder') ?? '').trim().startsWith('+') || /country code/i.test(el.getAttribute('aria-label') ?? '');
}

/** A list to pick from: a select, a radio group or a group of boxes. */
const listsChoices = (c: Control): boolean =>
  c.kind === 'select' || c.kind === 'radio' || (c.kind === 'checkbox' && (c.options?.length ?? 0) > 1);

/** Classification of every control: sections, scores, then one global assignment (see assign.ts). */
export function classifyAll(contexts: FieldContext[]): Classification[] {
  const sections = contexts.map(classifySection);
  // An inferred section is reported but never fed back into scoring (it would confirm its own guess).
  const scores = contexts.map((ctx, i) => scoreField(ctx, sections[i]!.inferred ? null : sections[i]!.section));
  settleBareLabels(contexts, scores, sections);
  const assigned = assign(
    contexts,
    scores,
    sections.map((s) => s.section),
  );
  // Given a bare number, such a widget guesses the country. With a code box beside it, the code goes there.
  const hasCodeBox = assigned.some((cls) => cls.fieldKey === 'contact.phoneCountryCode');
  // "Visa type" over a list of kinds of visa (Student, Temporary Graduate…) is answered by the work-rights status,
  // unless another question on the page asks for that.
  const statusAsked = assigned.some((cls) => cls.fieldKey === 'workRights.status');
  return assigned.map((cls, i) => {
    const control = contexts[i]!.control;
    if (cls.fieldKey === 'contact.phone' && !hasCodeBox && takesDialCode(control.el)) return { ...cls, fieldKey: 'contact.phoneFull' as const };
    if (cls.fieldKey === 'workRights.visaType' && !statusAsked && listsChoices(control)) return { ...cls, fieldKey: 'workRights.status' as const };
    return cls;
  });
}
