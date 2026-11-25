// How long an answer may be, and cutting one down to that at a sentence: Chinese counts characters, English words or
// characters, as the form says.

export interface LengthLimit {
  max: number;
  unit: 'chars' | 'words';
}

/** Words that make a number a floor, not a ceiling: 至少 500 字, at least 200 words. */
const FLOOR = /(?:至少|不少于|最少|不低于|at least|minimum of|min\.?)\s*$/i;
const ZH_RANGE = /(\d+)\s*[-~～至到]\s*(\d+)\s*个?字/;
const ZH_COUNT = /(\d+)\s*个?字/g;
const EN_RANGE = /(\d+)\s*[-–]\s*(\d+)\s*(words?|characters?|chars?)\b/i;
const EN_BEFORE = /(?:max(?:imum)?\.?(?:\s+of)?|up to|no more than|not more than|not exceeding|under|less than|fewer than|within|limit(?:ed)? to|at most)\s*(\d+)\s*(words?|characters?|chars?)\b/i;
const EN_AFTER = /(\d+)\s*(words?|characters?|chars?)\s*(?:max(?:imum)?|or less|or fewer|limit)\b/i;

const unitOf = (word: string): LengthLimit['unit'] => (/^w/i.test(word) ? 'words' : 'chars');

/** The limit a question states in its own words: （200字以内）, (max 500 characters), in no more than 150 words. */
function limitInLabel(label: string): LengthLimit | null {
  const zhRange = ZH_RANGE.exec(label);
  if (zhRange) return { max: Number(zhRange[2]), unit: 'chars' };
  for (const m of label.matchAll(ZH_COUNT)) {
    if (!FLOOR.test(label.slice(0, m.index))) return { max: Number(m[1]), unit: 'chars' };
  }
  const enRange = EN_RANGE.exec(label);
  if (enRange) return { max: Number(enRange[2]), unit: unitOf(enRange[3]!) };
  const en = EN_BEFORE.exec(label) ?? EN_AFTER.exec(label);
  return en ? { max: Number(en[1]), unit: unitOf(en[2]!) } : null;
}

/**
 * The box's own maxlength and the limit its question states. Both in characters: the tighter. In different units, the
 * box's, which the browser enforces whatever the question says.
 */
export function lengthLimitOf(el: Element, label: string): LengthLimit | null {
  const attr = Number(el.getAttribute('maxlength'));
  const box: LengthLimit | null = Number.isInteger(attr) && attr > 0 && attr < 100_000 ? { max: attr, unit: 'chars' } : null;
  const asked = limitInLabel(label);
  if (!box || !asked) return box ?? asked;
  if (box.unit === asked.unit) return { max: Math.min(box.max, asked.max), unit: 'chars' };
  return box;
}

const lengthOf = (text: string, unit: LengthLimit['unit']): number =>
  unit === 'chars' ? [...text].length : text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

/** Sentences with their closing marks and the space after them, so joining them back gives the text. */
const SENTENCE = /[^。！？!?.\n]+(?:[。！？!?.]+|$)\s*|\n+/g;

function cutSentence(sentence: string, limit: LengthLimit): string {
  const s = sentence.trim();
  if (limit.unit === 'words') return s.split(/\s+/).slice(0, limit.max).join(' ');
  const chars = [...s];
  if (/\p{Script=Han}/u.test(s)) return chars.slice(0, limit.max).join('');
  // Latin text is cut at the last space that fits, never inside a word.
  const head = chars.slice(0, limit.max + 1).join('');
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : chars.slice(0, limit.max).join('')).replace(/[\s,;:]+$/, '');
}

/** Whole sentences from the start while they fit; a first sentence too long alone is cut at a word or a character. */
export function fitLength(text: string, limit: LengthLimit): { text: string; cut: boolean } {
  const whole = text.trim();
  if (lengthOf(whole, limit.unit) <= limit.max) return { text: whole, cut: false };
  const sentences = whole.match(SENTENCE) ?? [whole];
  let kept = '';
  for (const sentence of sentences) {
    const next = kept + sentence;
    if (lengthOf(next.trimEnd(), limit.unit) > limit.max) break;
    kept = next;
  }
  const out = kept.trim();
  return { text: out || cutSentence(sentences[0]!, limit), cut: true };
}
