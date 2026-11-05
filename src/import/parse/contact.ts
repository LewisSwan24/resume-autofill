// What a resume proves by its format: emails, phone numbers, links. And what it says by a label.
import { toSimplified } from '../../dictionary/normalize';
import type { TextLine } from '../extract/types';
import type { DraftField } from './types';

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,6}\.[A-Za-z]{2,24}/;
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s，,、|；;）)]+|(?:linkedin\.com\/in|github\.com)\/[^\s，,、|；;）)]+/gi;
/** A person's page has one name after the host. Two is a project of theirs, or of someone else. */
const GITHUB_PROFILE = /github\.com\/[A-Za-z0-9-]+\/?$/i;

/** A number that can only be a phone: with a country code, or a mobile number by its own country's shape. */
const WITH_CODE = /(?<![\d+])\+\s?((?:\d[\s().-]{0,3}){7,15})(?![\d%])/;
const YEARS = /(?:19|20)\d{2}\s*[-–—~]\s*(?:19|20)\d{2}/;
/** Calling codes never start one another, so the digits alone say where the code ends. */
const CODE_ONE = new Set(['1', '7']);
const CODE_TWO = new Set(['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);
const callingCode = (all: string): string => (CODE_ONE.has(all[0]!) ? all.slice(0, 1) : CODE_TWO.has(all.slice(0, 2)) ? all.slice(0, 2) : all.slice(0, 3));
const CN_MOBILE = /(?<!\d)(1[3-9]\d[\s-]?\d{4}[\s-]?\d{4})(?!\d)/;
const AU_MOBILE = /(?<!\d)(04\d{2}[\s-]?\d{3}[\s-]?\d{3})(?!\d)/;
/** A number under a phone label may have any shape. */
const ANY_NUMBER = /(?<!\d)(\d(?:[\s().-]*\d){6,14})(?!\d)/;

export interface Phone {
  code: string;
  number: string;
  /** Read from the shape of the number and not written down, so there is a chance it is wrong. */
  inferred?: boolean;
}

const digits = (s: string): string => s.replace(/\D/g, '');

/** The number under a phone label, if nothing but a number is there. */
export function phoneUnderLabel(text: string): Phone | { code: null; number: string } | null {
  const t = text.trim();
  if (!/^[+()\d\s.-]+$/.test(t) || YEARS.test(t)) return null;
  const known = findPhone(t);
  if (known) return isAllOfIt(t, known) ? known : null;
  if (t.startsWith('+')) return null;
  const m = ANY_NUMBER.exec(t);
  return m ? { code: null, number: digits(m[1]!) } : null;
}

/** A phone found in a longer run of digits is no phone: "0412 345 678 123 456 782". */
function isAllOfIt(text: string, phone: Phone): boolean {
  return digits(text).length <= digits(phone.code).length + phone.number.length;
}

export const isEmail = (text: string): boolean => {
  const m = EMAIL.exec(text.trim());
  return !!m && m[0] === text.trim();
};

export function findPhone(text: string): Phone | null {
  const coded = WITH_CODE.exec(text.replace(/\(0\)/g, ' '));
  if (coded && !YEARS.test(coded[1]!)) {
    const all = digits(coded[1]!);
    const bare = callingCode(all);
    const national = all.slice(bare.length);
    if (national.length < 6 || national.length > 12) return null;
    const code = `+${bare}`;
    // Kept with the trunk 0, the way a local form wants it. Filling drops it again where a code goes first.
    return { code, number: code === '+61' && national.length === 9 ? `0${national}` : national };
  }
  if (coded) return null;
  const cn = CN_MOBILE.exec(text);
  if (cn) return { code: '+86', number: digits(cn[1]!), inferred: true };
  const au = AU_MOBILE.exec(text);
  if (au) return { code: '+61', number: digits(au[1]!), inferred: true };
  return null;
}

const field = (path: string, value: string, line: number, certainty: DraftField['certainty'] = 'high'): DraftField => ({ path, value, line, certainty });

/** "asha@example.comLinkedIn" and "asha@example.com1" were cut somewhere, and nobody knows quite where. */
function endsCleanly(text: string, email: RegExpExecArray): boolean {
  const next = text[email.index + email[0].length];
  const tld = email[0].slice(email[0].lastIndexOf('.') + 1);
  return !(next && /[A-Za-z0-9]/.test(next)) && (tld === tld.toLowerCase() || tld === tld.toUpperCase());
}

const OTHER_PEOPLE_WORDS = /父|母|爸|妈|配偶|爱人|丈夫|妻子|兄|弟|姐|妹|联系人|老师|导师|教授|同学|经理|主管|\b(?:father|mother|dad|mum|mom|parent|spouse|wife|husband|brother|sister|manager|recruiter|agent|referee|supervisor|emergency|prof|professor|dr)\b/i;
const NAME_OR_PLACE = /^(?:\p{Lu}[\p{L}'’.-]*(?: \p{Lu}[\p{L}'’.-]*){0,3}(?: \d{3,6})?|\p{Script=Han}{2,5})$/u;
const CLEARLY_A_PLACE = /^(?:\p{Lu}[\p{L} ]{1,24}\s+(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)(?: \d{4})?|(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT) \d{4}|\p{Script=Han}{2,12}[省市区县])$/u;
const ABOUT_THEMSELVES = /^(?:男|女|\d{1,2}岁|已婚|未婚)$/;
const CONTACT_WORD = 'phone|mobile|mob|tel|ph|cell|email|e-mail|linkedin|github|website|web|site|blog|portfolio|location|city|address|电话|手机|手机号|手机号码|电话号码|联系电话|联系方式|邮箱|邮件|个人网站|个人主页|网站|主页|博客|领英|现居城市|现居地|居住地|所在地|所在城市|城市|地址';
const CONTACT_LABEL = new RegExp(String.raw`^(?:${CONTACT_WORD})\s*[:：]?\s*`, 'i');
const SAYS_ITS_LABEL = new RegExp(String.raw`^(?:${CONTACT_WORD})\s*[:：]\s*(.*)$`, 'i');
/** What only the applicant would say of themselves on this line, followed by one thing and no more. */
const ABOUT_THEMSELVES_LABEL = /^(?:微信|wechat|qq|性别|年龄|籍贯|民族|学历|政治面貌|出生年月|出生日期|婚姻状况)\s*[:：]\s*\S*$/i;

const BEFORE_A_LABEL = /\s+(?=[\p{Script=Han}A-Za-z-]{1,12}\s*[:：])/gu;

/** The pieces of a line, once the addresses and links that hold the marks parting everything else are out of it. */
const partsOf = (text: string): string[] => text.replace(EMAIL, ' ').replace(URL_LIKE, ' ').replace(BEFORE_A_LABEL, '  ').split(CHUNKS);

/** The line above says whose this is: "Agent:", "Father". */
function introducedBySomeoneElse(above: string | undefined): boolean {
  const t = toSimplified(above?.trim() ?? '');
  if (!t || t.length > 30) return false;
  return OTHER_PEOPLE_WORDS.test(t) || (/[:：]$/.test(t) && !CONTACT_LABEL.test(t));
}

/**
 * Whether the details on a line can be called the applicant's. Numbers, addresses and links can stand alone, or under
 * a label of their own. Any other word could be whose they are ("Dad", "李教授"). Only the line with the applicant's
 * name on it gets to have any, as the name or a town, and the line right after it gets to have a town that says so.
 */
function holdsOnlyContactDetails(line: TextLine, isNameLine: boolean, afterName: boolean, above: string | undefined): boolean {
  if (introducedBySomeoneElse(above)) return false;
  const texts = line.cells.length > 1 ? line.cells : [line.text];
  return texts.every((text) =>
    partsOf(text).every((raw) => {
      const whole = toSimplified(raw.trim());
      if (OTHER_PEOPLE_WORDS.test(whole)) return false;
      if (ABOUT_THEMSELVES_LABEL.test(whole)) return true;
      const labelled = SAYS_ITS_LABEL.exec(whole);
      if (labelled) return (labelled[1] ?? '').trim().split(/\s+/).length <= 4;
      const chunk = whole.replace(CONTACT_LABEL, '');
      if (!chunk || /^[+()\d\s.-]+$/.test(chunk) || ABOUT_THEMSELVES.test(chunk)) return true;
      if (isNameLine) return NAME_OR_PLACE.test(chunk);
      return afterName && CLEARLY_A_PLACE.test(chunk);
    }),
  );
}

const CHUNKS = /\s*[|｜•·,，;；/]\s*|\s{2,}|　+/;

/** A number in a piece of its own. On a line that goes on about something else it could be anything. */
function standingPhone(line: TextLine): Phone | null {
  const cells = line.cells.length > 1 ? line.cells : [line.text];
  for (const cell of cells) {
    for (const chunk of partsOf(cell)) {
      const t = toSimplified(chunk.trim()).replace(CONTACT_LABEL, '');
      if (!/^[+()\d\s.-]+$/.test(t)) continue;
      const phone = findPhone(t);
      if (phone && isAllOfIt(t, phone)) return phone;
    }
  }
  return null;
}

/**
 * Only the top of a file and its contact section speak for the applicant. Further down an email is one to check,
 * a profile link says whose it is, and a number or a site belongs to whatever the line is about.
 * Everyone else's details stay out: a referee's email is not the applicant's.
 */
export function readFormats(lines: TextLine[], otherPeople: Set<number>, ownLines: Set<number>): DraftField[] {
  const out: DraftField[] = [];
  const once = new Set<string>();
  // The first thing in a file, when it starts with what could be a name.
  const first = lines.findIndex((l) => l.text.trim());
  // "Zhiyuan (Leo) Lin": what goes by another name is still a name.
  const firstPart = toSimplified((lines[first]?.cells[0] ?? '').split(CHUNKS)[0] ?? '').replace(/\s*[(（][^)）]*[)）]/g, '').trim();
  const nameLine = NAME_OR_PLACE.test(firstPart) && !OTHER_PEOPLE_WORDS.test(firstPart) ? first : -1;
  const add = (f: DraftField): void => {
    if (once.has(f.path)) return;
    once.add(f.path);
    out.push(f);
  };
  lines.forEach((l, i) => {
    if (otherPeople.has(i)) return;
    const own = ownLines.has(i);
    const email = l.text.includes('@') ? EMAIL.exec(l.text) : null;
    // Not once: a certain one further down is better than one to check higher up, and parseResume keeps the better.
    const plainContact = own && holdsOnlyContactDetails(l, i === nameLine, nameLine >= 0 && i === nameLine + 1, lines[i - 1]?.text);
    if (email) out.push(field('contact.email', email[0], i, plainContact && endsCleanly(l.text, email) ? 'high' : 'check'));
    const noMail = email ? l.text.replace(EMAIL, ' ') : l.text;
    for (const hit of noMail.match(URL_LIKE) ?? []) {
      const url = hit.replace(/[.。]+$/, '');
      const full = /^https?:/i.test(url) ? url : `https://${url}`;
      if (/linkedin\.com\/in\//i.test(url)) add(field('contact.linkedin', full, i, plainContact ? 'high' : 'check'));
      else if (/github\.com\//i.test(url)) {
        if (GITHUB_PROFILE.test(url)) add(field('contact.github', full, i, plainContact ? 'high' : 'check'));
      } else if (own) add(field('contact.website', full, i, plainContact ? 'high' : 'check'));
    }
    if (!own || once.has('contact.phone')) return;
    const phone = standingPhone(l);
    if (phone) {
      add(field('contact.phone', phone.number, i, plainContact ? 'high' : 'check'));
      add(field('contact.phoneCountryCode', phone.code, i, phone.inferred || !plainContact ? 'check' : 'high'));
    }
  });
  return out;
}

interface Label {
  words: RegExp;
  path: string;
  /** Sensitive or easily misread: it stays yellow even with a label, however clear the file looks. */
  always?: 'check';
}

const LABELS: Label[] = [
  { words: /^(?:姓名|名字|full name|name)$/i, path: 'name' },
  { words: /^(?:电话|手机|手机号|手机号码|联系电话|phone|mobile|tel|telephone|contact number)$/i, path: 'contact.phone' },
  { words: /^(?:邮箱|电子邮箱|电子邮件|e-?mail)$/i, path: 'contact.email' },
  { words: /^(?:微信|微信号|wechat)$/i, path: 'contact.wechat', always: 'check' },
  { words: /^(?:现居城市|现居地|现居住地|所在地|所在城市|居住地|location|city|current location)$/i, path: 'location' },
  { words: /^(?:地址|通讯地址|联系地址|address)$/i, path: 'contact.address.street', always: 'check' },
  { words: /^(?:性别|gender)$/i, path: 'basics.gender', always: 'check' },
  { words: /^(?:民族|ethnicity)$/i, path: 'basics.ethnicity', always: 'check' },
  { words: /^(?:籍贯)$/i, path: 'nativePlace', always: 'check' },
  { words: /^(?:婚姻状况|婚否|marital status)$/i, path: 'basics.maritalStatus', always: 'check' },
  { words: /^(?:政治面貌)$/i, path: 'basics.politicalStatus', always: 'check' },
  { words: /^(?:出生日期|出生年月|生日|date of birth|dob|birthday)$/i, path: 'basics.birthDate', always: 'check' },
  { words: /^(?:国籍|nationality)$/i, path: 'basics.nationality', always: 'check' },
];

/** Never brought in, so that a number like this cannot reach storage without anyone having noticed. */
const NEVER_READ = /^(?:身份证|身份证号|身份证号码|证件号|证件号码|护照|护照号|护照号码|passport|passport number|id number|id card)$/i;

const labelOf = (raw: string): Label | null => {
  const t = toSimplified(raw.replace(/[：:\s]+$/, '').trim());
  if (NEVER_READ.test(t)) return null;
  return LABELS.find((l) => l.words.test(t)) ?? null;
};

const isLabelCell = (raw: string): boolean => /[：:]\s*$/.test(raw) && (!!labelOf(raw) || NEVER_READ.test(toSimplified(raw).replace(/[：:\s]+$/, '').trim()));

/** Label and value: in two cells of a table, or in a run of text. */
export function readLabels(lines: TextLine[], otherPeople: Set<number>, ownLines: Set<number>): DraftField[] {
  const out: DraftField[] = [];
  const seen = new Set<string>();
  const add = (label: Label, value: string, line: number): void => {
    const v = value.trim();
    if (!v || seen.has(label.path)) return;
    seen.add(label.path);
    const unproved = label.path === 'contact.email' && !isEmail(v);
    out.push(field(label.path, v, line, unproved ? 'check' : (label.always ?? 'high')));
  };
  lines.forEach((l, i) => {
    // A label further down is about whatever that part of the file is about.
    if (otherPeople.has(i) || !ownLines.has(i)) return;
    // Cells that say "姓名：" and the cell after them.
    for (let c = 0; c < l.cells.length; c++) {
      const cell = l.cells[c]!;
      if (!isLabelCell(cell)) continue;
      const label = labelOf(cell);
      const next = l.cells[c + 1];
      if (next !== undefined && !isLabelCell(next)) {
        if (label) add(label, next, i);
        c++;
      }
    }
    // "电话：13800138000　邮箱：a@b.co", with whatever the label is written in.
    const pair = /([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z -]{0,15})\s*[：:]\s*([^：:　|｜]*?)(?=\s*(?:[　|｜]|$|\s[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z -]{0,15}\s*[：:]))/gu;
    if (l.cells.length === 1) {
      for (const m of l.text.matchAll(pair)) {
        if (m.index > 0 && /[A-Za-z0-9/]/.test(l.text[m.index - 1]!)) continue;
        const label = labelOf(m[1]!);
        if (label) add(label, m[2]!, i);
      }
    }
  });
  return out;
}
