// A label written as a question to the applicant ("Can we get your first name, please?", "请输入您的手机号码") asks
// for one thing, named right after "your". That thing is what the label means. Questions that merely mention
// "your" (yes/no questions, "the country of origin of your passport") ask for nothing here.
import { toSimplified } from './normalize';

/** The ways of asking that go straight on to "your <thing>". */
const EN_ASK =
  /^(?:(?:can|could|may)\s+(?:we|i)\s+(?:get|have|grab|take|ask\s+for|know)|what(?:'s|’s|\s+is|\s+are)|(?:what|how)\s+about|(?:please\s+)?(?:enter|provide|give\s+us|share|list|type|add|tell\s+us|let\s+us\s+know))\s+your\s+(.+)$/i;

/** Where the thing asked for ends: punctuation, a request for courtesy, or a clause about why or how. */
const EN_END = /[,;:?!.(*]|\s+(?:please|here|below|so|in\s+case|to|for|that|which|if|as|we|when)\b/i;

/** Said to sound friendly, not part of what is asked: "your best contact number". */
const EN_FILLER = /^(?:best|full\s+legal(?=\s+name))\s+/i;

/** At most this many words: past it, a sentence goes on about something else. */
const MAX_WORDS = 5;

const ZH_ASK =
  /^(?:请问)?(?:请)?(?:输入|填写|填入|提供|留下|告诉我们)?(?:一下)?(?:您|你)的(.+?)(?:是(?:什么|多少|哪里|哪个)?)?[？?。！!]?$/;

/** Where the applicant is now, asked about them rather than about "your" anything. Not where they would like to work. */
const EN_WHERE_YOU_ARE = /^(?:where\s+(?:are|do)\s+you|(?:what|which)\s+(city|town|suburb)\s+(?:are|do)\s+you)\s+(?:currently\s+|now\s+)?(?:based|located|live|living|reside)\b/i;

/** What the applicant holds or has, asked about them: "What visa type do you currently hold?", "Which visa are you on?". */
const EN_WHAT_YOU_HOLD =
  /^(?:what|which)\s+(?!of\b)(.+?)\s+(?:do\s+you\s+(?:currently\s+|now\s+)?(?:hold|have)|are\s+you\s+(?:currently\s+|now\s+)?on)[?.!\s]*$/i;

function englishAsk(text: string): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const where = EN_WHERE_YOU_ARE.exec(sentence.trim());
    if (where) return where[1] ? 'current city' : 'current location';
    const held = EN_WHAT_YOU_HOLD.exec(sentence.trim().replace(/\s*\*+$/, ''));
    if (held && held[1]!.split(/\s+/).length <= MAX_WORDS) return held[1]!;
    const hit = EN_ASK.exec(sentence.trim());
    if (!hit) continue;
    const rest = hit[1]!;
    const end = EN_END.exec(rest);
    const thing = (end ? rest.slice(0, end.index) : rest).replace(EN_FILLER, '').trim();
    const words = thing.split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.length <= MAX_WORDS) return thing;
  }
  return null;
}

function chineseAsk(text: string): string | null {
  const hit = ZH_ASK.exec(toSimplified(text).replace(/[\s*＊]+/g, ''));
  const thing = hit?.[1];
  return thing && thing.length <= 10 ? thing : null;
}

/** What a question to the applicant asks for (Chinese in simplified characters); null when the label is not such a question. */
export function askedFor(label: string): string | null {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return /\p{Script=Han}/u.test(text) ? chineseAsk(text) : englishAsk(text);
}
