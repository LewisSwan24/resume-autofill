// Sanitises what the capture tool records from a real page, and audits the result.
//
// Two outputs need different treatment:
// - The static snapshot loses everything that can run or fetch and all control state.
// - The HAR must keep working on replay, so scripts stay. Replacements are consistent (one secret, one
//   placeholder everywhere) so a URL built from a scrubbed body still matches the scrubbed entry.
//
// Regexes cannot recognise a person's name or address. On logged-in pages those come from an explicit
// term list. The audit walks the parsed structures rather than grepping the file, because a HAR is one line.
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------------------- text patterns

const SECRET_KEY =
  '(?:x[-_])?(?:csrf|xsrf)(?:[-_]?token)?|authenticity[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]token|session[-_]?id|jsessionid|auth[-_]?token|api[-_]?key';

const JWT_RE = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g;
// `"csrfToken":"value"`. The value must be quoted, so code such as `csrfToken:e.token` is left alone.
const SECRET_QUOTED_RE = new RegExp(`((?<![\\w-])["']?(?:${SECRET_KEY})["']?\\s*[:=]\\s*["'])([^"'\\s]{8,})(["'])`, 'gi');
// `?access_token=value`. Only in a query string, so `var csrfToken=document.foo` is left alone.
const SECRET_QUERY_RE = new RegExp(`([?&](?:${SECRET_KEY})=)([^&#"'\\s;<>]{8,})`, 'gi');
const SECRET_COOKIE_RE = /((?:^|[\s;])jsessionid=)([^&#"'\s;<>]{8,})/gi;
const SECRET_ATTR_RE = new RegExp(
  `(name=["'](?:${SECRET_KEY}|_token)["'][^>]*?\\b(?:content|value)=["'])([^"']{8,})(["'])`,
  'gi',
);
const SECRET_ATTR_REV_RE = new RegExp(
  `(\\b(?:content|value)=["'])([^"']{8,})(["'][^>]*?name=["'](?:${SECRET_KEY}|_token)["'])`,
  'gi',
);

// Matched wherever it starts, so nothing in front of an address can hide it. See `splitEscape`.
const EMAIL_RE = /[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,}/g;
const AFTER_BACKSLASH = /^(?:u[\da-fA-F]{4}|x[\da-fA-F]{2}|[a-zA-Z])/;
const AFTER_PERCENT = /^[\da-fA-F]{2}/;

/**
 * A match that starts right after a backslash or a % began inside an escape a script or a URL put before the
 * address (>, \x3e, \n, %3C). That escape is kept whole and only the rest is the address.
 */
function splitEscape(m: string, at: number, s: string): { escape: string; address: string } {
  const lead = s[at - 1] === BACKSLASH ? AFTER_BACKSLASH : s[at - 1] === '%' ? AFTER_PERCENT : null;
  const escape = lead?.exec(m)?.[0] ?? '';
  const address = m.slice(escape.length);
  return escape && /^[\w.+-]+(?:@|%40)/.test(address) ? { escape, address } : { escape: '', address: m };
}
const ASSET_SUFFIX = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|json|html?)$/i;
const EMAIL_PLACEHOLDER = /^redacted-\d+@example\.invalid$/i;

const PHONE_KEYED_RE =
  /(["']?[\w-]*(?:phone|mobile|cell|tel|手机|电话)[\w-]*["']?\s*[:=]\s*["'])([+\d][\d\s().-]{6,})(["'])/gi;
// The lookbehind also rejects / = ? & # so an id in a URL or query is not mistaken for a phone.
const PHONE_RES = [
  /(?<![\w.\-/=?&#])\+\d{1,3}[\s.-]?(?:\(?\d{1,5}\)?[\s.-]?){2,}\d/g, // international
  /(?<![\w.\-/=?&#])04\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![\w-])/g, // AU mobile
  /(?<![\w.\-/=?&#])0[2378][\s.-]?\d{4}[\s.-]?\d{4}(?![\w-])/g, // AU landline
  /(?<![\w.\-/=?&#])1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?![\w-])/g, // CN mobile
];
// Chinese mode. A mainland mobile wherever it stands as a number of its own: a string, a query or form value,
// a list, a tel: link, a bare JSON number, glued to a key. The only boundary that counts is another digit, except
// that a %XX escape just before it (whose hex may end in a digit) also starts a number. The prefix may be +86,
// 0086, 86 or an encoded %2B86, with a space, a dash, a + or %20 after it.
const BEFORE_NUMBER = String.raw`(?:(?<=%[0-9A-Fa-f]{2})|(?<!\d))`;
const CN_PREFIX = String.raw`(?:(?:\+|%2[Bb]|00)?86(?:[\s+-]|%20)?)`;
const CN_MOBILE_RE = new RegExp(String.raw`${BEFORE_NUMBER}(${CN_PREFIX}?)(1[3-9]\d{9})(?!\d)`, 'g');
// Written in three groups (139 0000 1111, 139-0000-1111) only where it stands apart from letters, dots and further
// numbers, so path data and number lists in code are left alone.
const CN_MOBILE_GROUPED_RE = new RegExp(
  String.raw`(?:(?<=%[0-9A-Fa-f]{2})|(?<![\w.\-]))(${CN_PREFIX}?)(1[3-9]\d)( |-|%20)(\d{4})\3(\d{4})(?![\w.\-]|\s\d)`,
  'g',
);
// An ID card number: region, birth date, sequence, check digit, contiguous or in groups (6-8-4, 6-4-4-4). Only a
// real date and a valid check digit count (see isIdCard).
const ID_CARD_RE = new RegExp(String.raw`${BEFORE_NUMBER}[1-9]\d{5}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3}[\dXx](?!\d)`, 'g');
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const isIdCard = (raw: string): boolean => {
  const s = raw.replace(/[ -]/g, '');
  if (s.length !== 18 || !/^\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/.test(s)) return false;
  return '10X98765432'[[...s.slice(0, 17)].reduce((sum, d, i) => sum + Number(d) * ID_WEIGHTS[i]!, 0) % 11] === s[17]!.toUpperCase();
};
// The ID card placeholder is 9000000 and a counter: all digits with no leading zero, so it stays a valid JSON
// number, and its "birth year" 00 means it never matches an ID card or a mobile again.
const SCRIPT_BLOCK = /(<script\b[\s\S]*?<\/script>)/gi;

// A Next.js page carries its data as JSON strings pushed onto self.__next_f, read in order as one stream of
// rows. A text row states its length in UTF-8 bytes ("1:T2a,"), so it is scrubbed as decoded text and given
// its new length; any other row ends at a newline. A stream that does not read this way is left to the plain
// scrub, which keeps the data clean but may leave the page unable to load on replay.
const FLIGHT_OPEN = 'self.__next_f.push([1,';
const BACKSLASH = String.fromCharCode(92);
const FLIGHT_TOKEN = /__RAF_FLIGHT_(\d+)__/g;
const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/** Where a text of `bytes` UTF-8 bytes starting at `from` ends, or -1 when the stream holds fewer. */
function afterBytes(s: string, from: number, bytes: number): number {
  let i = from;
  let n = 0;
  while (n < bytes) {
    if (i >= s.length) return -1;
    const cp = s.codePointAt(i)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return n === bytes ? i : -1;
}

/** The end of the JSON string literal whose opening quote is at `from`, just past its closing quote. */
function literalEnd(s: string, from: number): number {
  for (let i = from + 1; i < s.length; i++) {
    if (s[i] === BACKSLASH) i++;
    else if (s[i] === '"') return i + 1;
  }
  return -1;
}

/** As Next.js writes a string into a script: JSON, with nothing that could end the script or the line. */
const forScript = (s: string): string =>
  JSON.stringify(s).replace(SCRIPT_UNSAFE, (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

interface FlightLiteral {
  start: number;
  end: number;
  value: string;
}

function flightLiterals(html: string): FlightLiteral[] | null {
  const out: FlightLiteral[] = [];
  for (let at = html.indexOf(FLIGHT_OPEN); at >= 0; at = html.indexOf(FLIGHT_OPEN, at + 1)) {
    const start = at + FLIGHT_OPEN.length;
    const end = html[start] === '"' ? literalEnd(html, start) : -1;
    if (end < 0 || !html.startsWith('])', end)) return null;
    try {
      out.push({ start, end, value: JSON.parse(html.slice(start, end)) as string });
    } catch {
      return null;
    }
  }
  return out;
}
// Subresource integrity vouches for the original bytes. Scrubbing changes them and the browser would refuse
// the script, so hashes are emptied in markup, manifests and bundles alike. This only touches the local sample.
const INTEGRITY_RE = /(["']?\bintegrity["']?\s*[:=]\s*["'])sha(?:256|384|512)-[\w+/=\s-]+(["'])/gi;
const isHtmlMime = (mime: string | undefined): boolean => /html/i.test(mime ?? '');
// A mainland mobile becomes 10 and a nine-digit counter: digits only, so url-encoding leaves it as it is and a
// replayed request still finds its recording, eleven long like the original, and never 1[3-9] again. Any other
// phone becomes +000000 and a counter.
const PHONE_PLACEHOLDER = /^(?:\+0{6}\d+|(?:(?:\+|00)?86[\s+-]?)?10\d{9})$/;
const SECRET_PLACEHOLDER = /^REDACTED-/;
const TERM_PLACEHOLDER = 'REDACTED-TERM';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term is matched as a whole word or a whole number. Inside words it would wreck the page: a name part such as
// "Lin" sits in <link>, inline and line-height, and a QQ number sits inside longer ids and constants. Chinese text
// has no spaces, so only an edge that is a Latin letter or a digit gets a boundary. A digit after a %XX escape
// (`%20` before a number) still counts as the start of the number.
const LATIN_WORD = /[\p{Script=Latin}\d_]/u;
function termRe(t: string): RegExp {
  const edge = (c: string, side: 'before' | 'after'): string => {
    if (/\d/.test(c)) return side === 'before' ? String.raw`(?:(?<=%[0-9A-Fa-f]{2})|(?<!\d))` : String.raw`(?!\d)`;
    if (LATIN_WORD.test(c)) {
      return side === 'before' ? String.raw`(?<![\p{Script=Latin}\d_])` : String.raw`(?![\p{Script=Latin}\d_])`;
    }
    return '';
  };
  return new RegExp(`${edge(t[0]!, 'before')}${escapeRe(t)}${edge(t.at(-1)!, 'after')}`, 'giu');
}

function termRes(terms: string[] | undefined): RegExp[] {
  return [...(terms ?? [])]
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => {
      // One letter would replace itself all over the page and break it.
      if (t.length < 2) throw new Error(`scrub term too short: "${t}"`);
      return termRe(t);
    });
}

const isRealEmail = (m: string): boolean => !ASSET_SUFFIX.test(m) && !EMAIL_PLACEHOLDER.test(m.replace('%40', '@'));

export interface ScrubOptions {
  /** Literal strings that must not survive: the account holder's name, address, and so on. */
  terms?: string[] | undefined;
  /** A Chinese portal: mobiles under any key and ID card numbers too. */
  cn?: boolean | undefined;
}

// Resume fields that identify a person, in any section: the applicant, relatives, the emergency contact and
// referees. Bare cities, degrees, majors, skills and titles are left out: they are also the page's own option
// labels, and scrubbing those would break the sample. A home region is taken as a phrase (province and city,
// city and district) for the same reason.
const NAME_KEYS = new Set(['familyName', 'givenName', 'preferredName', 'englishName']);
const HAN = /\p{Script=Han}/u;
const RESUME_TERM_KEYS = new Set([
  'idNumber',
  'email',
  'phone',
  'wechat',
  'qq',
  'street',
  'linkedin',
  'github',
  'portfolio',
  'website',
  'school',
  'schoolEn',
  'company',
  'employer',
  'thesis',
]);
/** Sections whose `name` is a person's. Elsewhere (projects, awards, skills, certificates) it is not. */
const PERSON_SECTIONS = new Set(['family', 'emergencyContact', 'referees']);
/** Keys that identify only inside one section. */
const SECTION_TERM_KEYS: Record<string, string> = { certificates: 'number', projects: 'link' };
const REGION_KEYS = new Set(['nativePlace', 'studentOrigin', 'household', 'currentLocation', 'address']);
const HONORIFIC = /^(?:dr|mr|mrs|ms|miss|mx|prof|professor)\.?\s+/i;

/** A date of birth in the forms a page writes it: 1999-04-07, 1999/4/7, 19990407, 1999年4月7日 and so on. */
function dateForms(v: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return [];
  const [, y, mm, dd] = m as unknown as [string, string, string, string];
  const out = [`${y}${mm}${dd}`];
  for (const [mo, d] of [
    [mm, dd],
    [String(Number(mm)), String(Number(dd))],
  ] as const) {
    out.push(`${y}-${mo}-${d}`, `${y}/${mo}/${d}`, `${y}.${mo}.${d}`, `${y}年${mo}月${d}日`);
  }
  return out;
}

/** A region as phrases of two or three adjacent parts, the way pickers and profile answers write them. */
function regionForms(region: Record<string, unknown>): string[] {
  const part = (k: string): string => (typeof region[k] === 'string' ? (region[k] as string).trim() : '');
  const [province, city, district] = [part('province'), part('city'), part('district')];
  const out: string[] = [];
  for (const run of [
    [province, city],
    [city, district],
    [province, city, district],
  ]) {
    if (run.some((p) => !p)) continue;
    for (const sep of ['', ' ', '/', ' / ', '-']) out.push(run.join(sep));
    out.push([...run].reverse().join(', '));
  }
  return out;
}

/**
 * The identifying values of a resume (an export, any wrapping), as scrub terms. A Chinese name is mostly two
 * or three characters, so family and given name are also joined in both orders; a part under two characters
 * alone is dropped, because it would match all over the page. A bare number needs six digits for the same reason.
 */
export function resumeTerms(resume: unknown): string[] {
  const out = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (t.length < 2 || (/^[\d\s+-]+$/.test(t) && t.replace(/\D/g, '').length < 6)) return;
    out.add(t);
  };
  // A Chinese name part of two characters or more is a term of its own. A Latin one alone is a common word
  // ("Min", "Mark", "Page") that turns up in markup and code, so it only counts inside a full name.
  const addName = (v: unknown): void => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (HAN.test(t) || /\s/.test(t)) add(t);
    const bare = t.replace(HONORIFIC, '');
    if (bare !== t && /\s/.test(bare)) add(bare);
  };
  const walk = (node: unknown, section = ''): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, section);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(o)) {
      if (NAME_KEYS.has(key) || (key === 'name' && PERSON_SECTIONS.has(section))) addName(value);
      else if (RESUME_TERM_KEYS.has(key) || SECTION_TERM_KEYS[section] === key) add(value);
      else if (key === 'birthDate' && typeof value === 'string') dateForms(value).forEach(add);
      else {
        if (REGION_KEYS.has(key) && value && typeof value === 'object') regionForms(value as Record<string, unknown>).forEach(add);
        walk(value, key);
      }
    }
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const family = str(o.familyName);
    if (!family) return;
    if (HAN.test(family)) {
      const given = str(o.givenName);
      if (given) for (const full of [`${family}${given}`, `${family} ${given}`, `${given} ${family}`]) add(full);
      return;
    }
    for (const given of [o.givenName, o.preferredName, o.englishName].map(str)) {
      if (given && !HAN.test(given)) for (const full of [`${given} ${family}`, `${family} ${given}`]) add(full);
    }
  };
  walk(resume);
  return [...out];
}

export interface TextOptions {
  /**
   * `keyed`: only values under a phone-like key. Safe for scripts and JSON, where bare digits are ids.
   * `all`: also anything shaped like a phone number. For human-visible text.
   */
  phones?: 'keyed' | 'all';
}

export class Scrubber {
  private readonly terms: RegExp[];
  private readonly map = new Map<string, string>();
  private readonly cn: boolean;
  private counter = 0;

  constructor(opts: ScrubOptions = {}) {
    this.terms = termRes(opts.terms);
    this.cn = opts.cn ?? false;
  }

  private placeholder(kind: 'secret' | 'email' | 'phone' | 'cn-mobile' | 'id-card', value: string): string {
    const key = `${kind}:${value.toLowerCase().replace('%40', '@')}`;
    let out = this.map.get(key);
    if (!out) {
      const n = ++this.counter;
      out =
        kind === 'secret'
          ? `REDACTED-${n}`
          : kind === 'email'
            ? `redacted-${n}@example.invalid`
            : kind === 'id-card'
              ? `90000000${String(n).padStart(10, '0')}`
              : kind === 'cn-mobile'
                ? `10${String(n).padStart(9, '0')}`
                : `+000000${String(n).padStart(4, '0')}`;
      this.map.set(key, out);
    }
    return out;
  }

  text(input: string, opts: TextOptions = {}): string {
    let s = input;
    // A number stays a number of the same length (9 then zeros), so a term that is a JSON number keeps the JSON valid.
    for (const re of this.terms) {
      s = s.replace(re, (m) => (/^\d+$/.test(m) ? `9${'0'.repeat(m.length - 1)}` : TERM_PLACEHOLDER));
    }
    s = s.replace(JWT_RE, (m) => this.placeholder('secret', m));
    const secret = (m: string, pre: string, value: string, post = ''): string =>
      SECRET_PLACEHOLDER.test(value) ? m : `${pre}${this.placeholder('secret', value)}${post}`;
    s = s.replace(SECRET_QUOTED_RE, secret);
    s = s.replace(SECRET_ATTR_RE, secret);
    s = s.replace(SECRET_ATTR_REV_RE, secret);
    s = s.replace(SECRET_QUERY_RE, (m, pre: string, value: string) => secret(m, pre, value));
    s = s.replace(SECRET_COOKIE_RE, (m, pre: string, value: string) => secret(m, pre, value));
    s = s.replace(EMAIL_RE, (m: string, at: number, all: string) => {
      const { escape, address } = splitEscape(m, at, all);
      return isRealEmail(address) ? `${escape}${this.placeholder('email', address)}` : m;
    });
    if (this.cn) {
      s = s.replace(ID_CARD_RE, (m) => (isIdCard(m) ? this.placeholder('id-card', m.replace(/[ -]/g, '')) : m));
      // The prefix stays, so "+86 " written by the page and by page script around the number match alike.
      const mobile = (prefix: string, digits: string): string => `${prefix}${this.placeholder('cn-mobile', digits)}`;
      s = s.replace(CN_MOBILE_RE, (_m, prefix: string, digits: string) => mobile(prefix, digits));
      s = s.replace(CN_MOBILE_GROUPED_RE, (_m, prefix: string, a: string, _sep: string, b: string, c: string) =>
        mobile(prefix, `${a}${b}${c}`),
      );
    }
    s = s.replace(PHONE_KEYED_RE, (m, pre: string, value: string, post: string) =>
      PHONE_PLACEHOLDER.test(value) ? m : `${pre}${this.placeholder('phone', value)}${post}`,
    );
    if (opts.phones === 'all') {
      for (const re of PHONE_RES) {
        s = s.replace(re, (m) => (PHONE_PLACEHOLDER.test(m) ? m : this.placeholder('phone', m)));
      }
    }
    return s;
  }

  /**
   * An HTML response that must keep working on replay: visible text gets the full phone treatment,
   * script blocks only the keyed one, because bare digits there are usually ids. A phone sitting in JSON
   * or a script under an unrelated key can only be caught by the term list.
   */
  html(input: string): string {
    const flight = this.flight(input);
    const out = (flight?.html ?? input)
      .split(SCRIPT_BLOCK)
      .map((part, i) => this.text(part, i % 2 === 1 ? {} : { phones: 'all' }))
      .join('');
    return flight ? out.replace(FLIGHT_TOKEN, (_m, i: string) => flight.literals[Number(i)]!) : out;
  }

  /** A Next.js page's data stream, scrubbed row by row. Its strings stand aside as tokens while the rest is scrubbed. */
  private flight(input: string): { html: string; literals: string[] } | null {
    const found = flightLiterals(input);
    if (!found?.length) return null;
    const stream = found.map((l) => l.value).join('');
    const starts: number[] = [];
    found.reduce((at, l) => (starts.push(at), at + l.value.length), 0);
    const chunks = found.map(() => '');
    for (let p = 0; p < stream.length; ) {
      const colon = stream.indexOf(':', p);
      if (colon < 0 || !/^[0-9a-f]*$/.test(stream.slice(p, colon))) return null;
      let row: string;
      let next: number;
      if (stream[colon + 1] === 'T') {
        const head = /^T([0-9a-f]+),/.exec(stream.slice(colon + 1, colon + 24));
        const from = colon + 1 + (head?.[0].length ?? 0);
        next = head ? afterBytes(stream, from, parseInt(head[1]!, 16)) : -1;
        if (next < 0) return null;
        const text = this.text(stream.slice(from, next));
        row = `${stream.slice(p, colon)}:T${utf8Length(text).toString(16)},${text}`;
      } else {
        const nl = stream.indexOf('\n', colon);
        next = nl < 0 ? stream.length : nl + 1;
        row = this.text(stream.slice(p, next));
      }
      // A row goes back into the push it started in.
      let chunk = starts.length - 1;
      while (starts[chunk]! > p) chunk--;
      chunks[chunk] += row;
      p = next;
    }
    let html = '';
    let at = 0;
    found.forEach((l, i) => {
      html += `${input.slice(at, l.start)}__RAF_FLIGHT_${i}__`;
      at = l.end;
    });
    return { html: html + input.slice(at), literals: chunks.map(forScript) };
  }

  body(input: string, mime: string | undefined): string {
    const scrubbed = isHtmlMime(mime) ? this.html(input) : this.text(input);
    return scrubbed.replace(INTEGRITY_RE, '$1$2');
  }
}

// ---------------------------------------------------------------------------------------- findings

export interface Finding {
  kind:
    | 'sensitive-header'
    | 'cookie-array'
    | 'email'
    | 'phone'
    | 'secret'
    | 'term'
    | 'id-card'
    | 'unreadable'
    | 'script'
    | 'control-value'
    | 'sign-in-storage';
  where: string;
  /** Masked: a report must not repeat what it found. */
  sample: string;
}

const mask = (s: string): string => (s.length <= 4 ? '****' : `${s.slice(0, 2)}…(${s.length})`);

function scanVisiblePhones(html: string, where: string): Finding[] {
  const out: Finding[] = [];
  html.split(SCRIPT_BLOCK).forEach((part, i) => {
    if (i % 2 === 1) return;
    for (const re of PHONE_RES) {
      for (const m of part.match(re) ?? []) {
        if (!PHONE_PLACEHOLDER.test(m)) out.push({ kind: 'phone', where, sample: mask(m) });
      }
    }
  });
  return out;
}

/**
 * Undoes the encodings a value wears on a page before the audit looks at it: %XX escapes, + for a space, JSON
 * \uXXXX escapes. The scrub matches those forms one by one; decoding first is a separate way of looking, so a form
 * the scrub's patterns miss still shows up here.
 */
function decodeLoosely(text: string): string {
  const hex = (h: string): string => String.fromCharCode(parseInt(h, 16));
  return text
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_m, h: string) => hex(h))
    .replace(/%([0-9A-Fa-f]{2})/g, (_m, h: string) => hex(h))
    .replace(/\+/g, ' ');
}

const LOOSE_MOBILE_RE = /(?<!\d)(?:(?:00)?86[\s-]?)?1[3-9]\d{9}(?!\d)/g;
const LOOSE_MOBILE_GROUPED_RE = /(?<![\w.-])(?:(?:00)?86[\s-]?)?1[3-9]\d([ -])\d{4}\1\d{4}(?![\w.-]|\s\d)/g;
const LOOSE_ID_RE = /(?<!\d)[1-9]\d{5}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3}[\dXx](?!\d)/g;

/** Mainland mobiles and ID numbers left anywhere in `text`, found independently of the scrub's patterns. */
function scanCn(text: string, where: string): Finding[] {
  const decoded = decodeLoosely(text);
  const out: Finding[] = [];
  for (const re of [LOOSE_MOBILE_RE, LOOSE_MOBILE_GROUPED_RE]) {
    for (const m of decoded.match(re) ?? []) out.push({ kind: 'phone', where, sample: mask(m) });
  }
  for (const m of decoded.match(LOOSE_ID_RE) ?? []) if (isIdCard(m)) out.push({ kind: 'id-card', where, sample: mask(m) });
  return out;
}

function scanText(text: string, where: string, terms: RegExp[], cn = false): Finding[] {
  const out: Finding[] = [];
  const add = (kind: Finding['kind'], value: string): void => {
    out.push({ kind, where, sample: mask(value) });
  };
  for (const m of text.matchAll(EMAIL_RE)) {
    const { address } = splitEscape(m[0], m.index, text);
    if (isRealEmail(address)) add('email', address);
  }
  for (const m of text.match(JWT_RE) ?? []) add('secret', m);
  for (const re of [SECRET_QUOTED_RE, SECRET_QUERY_RE, SECRET_COOKIE_RE, SECRET_ATTR_RE, SECRET_ATTR_REV_RE]) {
    for (const m of text.matchAll(re)) {
      if (!SECRET_PLACEHOLDER.test(m[2]!)) add('secret', m[2]!);
    }
  }
  for (const m of text.matchAll(PHONE_KEYED_RE)) {
    if (!PHONE_PLACEHOLDER.test(m[2]!)) add('phone', m[2]!);
  }
  for (const re of terms) {
    for (const m of text.match(re) ?? []) add('term', m);
  }
  if (cn) out.push(...scanCn(text, where));
  return out;
}

// ---------------------------------------------------------------------------------------- static HTML

const KEEP_VALUE_TYPES = new Set(['radio', 'checkbox', 'submit', 'button', 'reset', 'image']);
const REMOVE_SELECTOR = 'script,noscript,link,base,object,embed,applet,meta[http-equiv]';
const VISIBLE_ATTRS = new Set(['href', 'title', 'alt', 'placeholder', 'aria-label', 'value', 'content']);

/** Every parent node in the tree, including the content of templates (declarative shadow roots). */
function allRoots(root: ParentNode): ParentNode[] {
  const out: ParentNode[] = [root];
  for (const t of root.querySelectorAll('template')) out.push(...allRoots(t.content));
  return out;
}

function cleanRoot(root: ParentNode, scrub: Scrubber, win: { NodeFilter: typeof NodeFilter; document: Document }): void {
  for (const el of root.querySelectorAll(REMOVE_SELECTOR)) el.remove();
  for (const el of root.querySelectorAll('meta[name]')) {
    if (/csrf|xsrf|token/i.test(el.getAttribute('name') ?? '')) el.remove();
  }

  for (const el of root.querySelectorAll('input')) {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    el.removeAttribute('checked');
    if (!KEEP_VALUE_TYPES.has(type)) el.removeAttribute('value');
  }
  for (const el of root.querySelectorAll('textarea')) el.textContent = '';
  for (const el of root.querySelectorAll('option')) el.removeAttribute('selected');

  // Comments and text. Templates are walked as their own roots.
  const walker = win.document.createTreeWalker(root as unknown as Node, win.NodeFilter.SHOW_TEXT | win.NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 8) comments.push(n);
    else if (n.parentNode?.nodeName !== 'STYLE') n.nodeValue = scrub.text(n.nodeValue ?? '', { phones: 'all' });
  }
  for (const c of comments) c.parentNode?.removeChild(c);

  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      const next = scrub.text(attr.value, VISIBLE_ATTRS.has(attr.name) ? { phones: 'all' } : {});
      if (next !== attr.value) el.setAttribute(attr.name, next);
    }
  }
}

export interface StaticOptions {
  /** Collected page CSS. Inlined so hidden things stay hidden when the snapshot loads offline. */
  css?: string | undefined;
}

export function sanitizeStaticHtml(html: string, scrub: Scrubber, opts: StaticOptions = {}): string {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const win = { NodeFilter: dom.window.NodeFilter as unknown as typeof NodeFilter, document: document as unknown as Document };
  for (const root of allRoots(document as unknown as ParentNode)) cleanRoot(root, scrub, win);
  if (opts.css) {
    const style = document.createElement('style');
    style.setAttribute('data-raf-inlined', '');
    style.textContent = scrub.text(opts.css);
    document.head.append(style);
  }
  return dom.serialize();
}

export function auditHtml(html: string, opts: ScrubOptions = {}): Finding[] {
  const out: Finding[] = [];
  const dom = new JSDOM(html);
  const roots = allRoots(dom.window.document as unknown as ParentNode);
  for (const root of roots) {
    for (const el of root.querySelectorAll(REMOVE_SELECTOR)) {
      out.push({ kind: 'script', where: 'html', sample: el.tagName.toLowerCase() });
    }
    for (const el of root.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc') out.push({ kind: 'script', where: 'html', sample: attr.name });
      }
    }
    for (const el of root.querySelectorAll('input')) {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (!KEEP_VALUE_TYPES.has(type) && el.getAttribute('value')) {
        out.push({ kind: 'control-value', where: `input ${type}`, sample: mask(el.getAttribute('value')!) });
      }
      if (el.hasAttribute('checked')) out.push({ kind: 'control-value', where: `input ${type}`, sample: 'checked' });
    }
    for (const el of root.querySelectorAll('textarea')) {
      if (el.textContent) out.push({ kind: 'control-value', where: 'textarea', sample: mask(el.textContent) });
    }
    if (root.querySelector('option[selected]')) {
      out.push({ kind: 'control-value', where: 'option', sample: 'selected' });
    }
  }
  out.push(...scanText(html, 'html', termRes(opts.terms), opts.cn));
  return out;
}

// ---------------------------------------------------------------------------------------- HAR

export interface HarPair {
  name: string;
  value: string;
}

export interface HarContent {
  mimeType?: string;
  text?: string;
  encoding?: string;
  _file?: string;
  size?: number;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: HarPair[];
  _file?: string;
}

export interface HarEntry {
  request: {
    method: string;
    url: string;
    headers: HarPair[];
    cookies: unknown[];
    queryString: HarPair[];
    postData?: HarPostData;
  };
  response: {
    status: number;
    headers: HarPair[];
    cookies: unknown[];
    content: HarContent;
    redirectURL?: string;
  };
}

export interface HarFile {
  log: {
    pages?: { title?: string }[];
    entries: HarEntry[];
  };
}

/** Sidecar body files written by Playwright's `updateContent: 'attach'`. */
export interface SidecarIo {
  read(name: string): string | null;
  write(name: string, text: string): void;
  remove(name: string): void;
}

// Besides the standard ones, a header an app names for its own sign-in: Oracle Recruiting sends the candidate's
// session as Ora-Irc-Access-Code. A replay never checks headers, so dropping one costs nothing.
const SENSITIVE_HEADER =
  /^(?:cookie2?|set-cookie2?|authorization|proxy-authorization|.*(?:csrf|xsrf|token|session|secret|api-?key|access[-_]?code|auth).*)$/i;
// The stored body is decoded and changes size.
const STALE_HEADER = /^(?:content-length|content-encoding)$/i;
const TEXT_MIME = /^text\/|json|javascript|xml|html|css|svg|x-www-form-urlencoded|graphql/i;

/** No declared type: treat as text unless it looks binary, so an unlabelled JSON body is still scrubbed. */
function isTextBody(mime: string | undefined, sample: string | null | undefined): boolean {
  if (mime) return TEXT_MIME.test(mime);
  return sample != null && !/[\0�]/.test(sample);
}

function scrubPairs(pairs: HarPair[] | undefined, scrub: Scrubber): HarPair[] {
  return (pairs ?? []).map((p) => ({ ...p, name: p.name, value: scrub.text(p.value) }));
}

/** Query values alone carry no key context, so scrub them in the shape they had in the URL. */
function scrubQuery(pairs: HarPair[] | undefined, scrub: Scrubber): HarPair[] {
  return (pairs ?? []).map((p) => {
    const line = scrub.text(`?${p.name}=${p.value}`);
    return { ...p, value: line.slice(line.indexOf('=') + 1) };
  });
}

function scrubSidecar(name: string, mime: string | undefined, scrub: Scrubber, io: SidecarIo): void {
  const text = io.read(name);
  if (text === null || !isTextBody(mime, text)) return;
  const next = scrub.body(text, mime);
  if (next !== text) io.write(name, next);
}

function scrubContent(c: HarContent, scrub: Scrubber, io: SidecarIo): void {
  if (c._file) {
    scrubSidecar(c._file, c.mimeType, scrub, io);
    return;
  }
  if (c.text === undefined || c.text === '') return;
  const base64 = c.encoding === 'base64';
  const decoded = base64 ? Buffer.from(c.text, 'base64').toString('utf8') : c.text;
  if (!isTextBody(c.mimeType, decoded)) return;
  c.text = scrub.body(decoded, c.mimeType);
  delete c.encoding;
  c.size = Buffer.byteLength(c.text);
}

/**
 * A prefetch is recorded with an empty body. Replayed, it answers the page's real request for the
 * same file with an empty script, and the page hangs with no error. Without the entry, the real
 * load is what replay finds, or the request is aborted where a test can see it.
 */
function dropEmptyPrefetches(har: HarFile, io: SidecarIo): void {
  const isEmptyPrefetch = ({ request, response }: HarEntry) =>
    !response.content.size && request.headers.some((h) => /^(sec-)?purpose$/i.test(h.name) && /prefetch/i.test(h.value));
  const dropped = har.log.entries.filter(isEmptyPrefetch);
  har.log.entries = har.log.entries.filter((e) => !isEmptyPrefetch(e));
  const inUse = new Set(har.log.entries.map((e) => e.response.content._file));
  for (const file of new Set(dropped.map((e) => e.response.content._file))) {
    if (file && !inUse.has(file)) io.remove(file);
  }
}

export function sanitizeHar(har: HarFile, scrub: Scrubber, io: SidecarIo): void {
  for (const page of har.log.pages ?? []) {
    if (page.title) page.title = scrub.text(page.title, { phones: 'all' });
  }
  // A sent body that cannot be read (compressed telemetry) cannot be vouched for, and replay does not need it.
  har.log.entries = har.log.entries.filter(({ request }) => {
    const file = request.postData?._file;
    if (!file || io.read(file) !== null) return true;
    io.remove(file);
    return false;
  });
  dropEmptyPrefetches(har, io);
  for (const { request, response } of har.log.entries) {
    request.url = scrub.text(request.url);
    request.headers = scrubPairs(request.headers.filter((h) => !SENSITIVE_HEADER.test(h.name)), scrub);
    request.cookies = [];
    request.queryString = scrubQuery(request.queryString, scrub);
    const post = request.postData;
    if (post) {
      if (post.text) post.text = scrub.text(post.text);
      if (post.params) post.params = scrubPairs(post.params, scrub);
      if (post._file) scrubSidecar(post._file, post.mimeType, scrub, io);
    }
    response.headers = scrubPairs(
      response.headers.filter((h) => !SENSITIVE_HEADER.test(h.name) && !STALE_HEADER.test(h.name)),
      scrub,
    );
    response.cookies = [];
    if (response.redirectURL) response.redirectURL = scrub.text(response.redirectURL);
    scrubContent(response.content, scrub, io);
  }
}

export function auditHar(har: HarFile, io: SidecarIo, opts: ScrubOptions = {}): Finding[] {
  const terms = termRes(opts.terms);
  const out: Finding[] = [];
  const scan = (text: string | undefined, where: string, mime?: string): void => {
    if (!text) return;
    out.push(...scanText(text, where, terms, opts.cn));
    if (isHtmlMime(mime)) out.push(...scanVisiblePhones(text, where));
  };
  const scanSidecar = (name: string, mime: string | undefined, where: string): void => {
    const text = io.read(name);
    if (text === null) {
      // A body that cannot be read cannot be vouched for, unless its type says it holds no text.
      if (!mime || TEXT_MIME.test(mime)) out.push({ kind: 'unreadable', where, sample: name });
      return;
    }
    if (isTextBody(mime, text)) scan(text, where, mime);
  };

  for (const page of har.log.pages ?? []) scan(page.title, 'page title');
  har.log.entries.forEach(({ request, response }, i) => {
    const where = `entry ${i}`;
    for (const h of [...request.headers, ...response.headers]) {
      if (SENSITIVE_HEADER.test(h.name)) out.push({ kind: 'sensitive-header', where, sample: h.name.toLowerCase() });
      else scan(h.value, `${where} header ${h.name}`);
    }
    if (request.cookies.length || response.cookies.length) {
      out.push({ kind: 'cookie-array', where, sample: String(request.cookies.length + response.cookies.length) });
    }
    scan(request.url, `${where} url`);
    for (const q of request.queryString ?? []) scan(`?${q.name}=${q.value}`, `${where} query`);
    const post = request.postData;
    if (post) {
      scan(post.text, `${where} post`);
      for (const p of post.params ?? []) scan(p.value, `${where} post param`);
      if (post._file) scanSidecar(post._file, post.mimeType, `${where} post sidecar`);
    }
    scan(response.redirectURL, `${where} redirect`);
    const c = response.content;
    if (c._file) {
      scanSidecar(c._file, c.mimeType, `${where} body sidecar`);
    } else if (c.text && isTextBody(c.mimeType, c.text)) {
      scan(c.encoding === 'base64' ? Buffer.from(c.text, 'base64').toString('utf8') : c.text, `${where} body`, c.mimeType);
    }
  });
  return out;
}

// A sign-in a page keeps in session storage: the usual names, and Oracle Recruiting's tokens with the keys that unlock
// them (vt, st, and each one's _ed). A replay puts a made-up one in their place.
const SIGN_IN_STORAGE_KEY = /^(?:vt|st)(?:_ed)?$|token|secret|password|access[-_]?code|auth/i;

/** A tab's session storage as a replay may start from it: no sign-in, every value scrubbed. */
export function sanitizeStorage(items: Record<string, string>, scrub: Scrubber): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(items)) if (!SIGN_IN_STORAGE_KEY.test(key)) out[key] = scrub.text(value);
  return out;
}

export function auditStorage(items: Record<string, string>, opts: ScrubOptions = {}): Finding[] {
  const terms = termRes(opts.terms);
  const out: Finding[] = [];
  for (const [key, value] of Object.entries(items)) {
    if (SIGN_IN_STORAGE_KEY.test(key)) out.push({ kind: 'sign-in-storage', where: 'sessionStorage', sample: key });
    out.push(...scanText(value, `sessionStorage ${key}`, terms, opts.cn));
  }
  return out;
}
