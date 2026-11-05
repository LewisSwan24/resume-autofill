// What every line goes through before anything reads it: no line can hang the page, and a number standing beside the
// word for a document comes out. That part is best effort, and says so on the page: the ways to write a number have no
// end, and no shape tells it from a phone. What keeps the rest safe is that the source stays folded away until asked for,
// that free text is always left to check, and that the fields with a format of their own have to meet it (parse/index.ts).
import { toSimplified } from '../../dictionary/normalize';
import type { TextLine } from '../extract/types';
import { findPhone } from './contact';

/** A line longer than this is no line of a resume, and the rest of it is not read. */
const MAX_LINE = 4000;
/** More lines than this is no resume, and the rest of the file is not read. */
const MAX_LINES = 2000;
/** More stretches than this on one line is no table, and the rest of the line is not read. */
const MAX_CELLS = 50;
/** A label alone on its line or in its cell is no longer than this. */
const MAX_LABEL = 30;

const ID_WORD_HAN = '身份证|身份号|证件|护照|通行证|社保|社会保障|社会保险|驾照|驾驶证|驾驶执照|居住证|军官证|士兵证|パスポート|マイナンバー|在留カード|免許証|주민등록|여권';
const ID_WORD_ANY_CASE = new RegExp(
  `${ID_WORD_HAN}` +
    "|(?<![a-z])(?:passport|passeport|pasaporte|reisepass|personalausweis|c[eé]dula|social security|social insurance|tax file|tax id|national insurance|national id|national identity|identity (?:number|no|card)|government id|driving licen[cs]e|driver['’]?s? licen[cs]e|medicare|aadha?a?r|id (?:number|no\\b|card)|id#|ic no|hk ?id|nric|ssn|tfn)(?![a-z])" +
    '|(?<![a-z] )(?<![A-Za-z])id\\s*[:#]',
  'i',
);
/** Short forms that are words too, in lower case: "sin", "ni", "pan". */
const ID_WORD_CAPITALS = /(?<![A-Za-z])(?:SIN|NI|CPF|DNI|PAN)(?![A-Za-z])/;

const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
const ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f]/g;

/** One way of writing everything: full-width digits and letters, spaces that are not spaces, characters nobody can see. */
function plain(text: string): string {
  // The wide space parts things as two spaces do, and would otherwise turn into one.
  return text.replace(/\u3000/g, '  ').normalize('NFKC').replace(INVISIBLE, '').replace(ODD_SPACE, ' ');
}

/** The same with its words pulled together, for finding a word however it was spaced out. */
const pulledTogether = (text: string): string =>
  toSimplified(text)
    .replace(/(?<=\p{Script=Han}) +(?=\p{Script=Han})/gu, '')
    .replace(/ {2,}/g, ' ');

function wordAt(text: string): number {
  const a = toSimplified(text).search(ID_WORD_ANY_CASE);
  const b = text.search(ID_WORD_CAPITALS);
  if (a < 0) return b;
  return b < 0 ? a : Math.min(a, b);
}

const namesDocument = (text: string): boolean => wordAt(text) >= 0 || ID_WORD_ANY_CASE.test(pulledTogether(text));

const EMAIL_OR_LINK = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}|(?:https?:\/\/|www\.)\S+/g;
const DATES = /(?<![A-Za-z0-9])(?:19|20)\d{2}(?:[./-](?:0?[1-9]|1[0-2])(?:[./-](?:0?[1-9]|[12]\d|3[01]))?)?(?![A-Za-z0-9])/g;

/** Digits, leaving out the things with digits in them that are no document's number. */
const DATES_ZH = /(?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*日)?/g;
const withoutThose = (text: string): string => text.replace(EMAIL_OR_LINK, ' ').replace(DATES_ZH, ' ').replace(DATES, ' ');
const holdsDigits = (text: string): boolean => /\d/.test(withoutThose(text));

/** A number and not a word: a few letters at most before the digits. "E12345678", "12 345", not "Redis 7". */
const NUMBER_FIRST = /^(?:[A-Za-z]{0,3}\s?\d|[A-Za-z]{4,5}\d)/;
/** A version or a count: "2.0", "v0.6", "300 人". */
const NOT_A_NUMBER = /^[A-Za-z]{0,3}\s?(?:\d{1,2}\.\d{1,2}(?![\d.])|\d{1,4}\s*[人名个万元次家项年月日天%])/;
const startsWithNumber = (text: string): boolean => NUMBER_FIRST.test(text) && !NOT_A_NUMBER.test(text);
/** One unbroken run of letters and digits, for what stands right after a label. "ABCDEF1234", "X-1234567". */
const A_CODE = /^(?=(?:[A-Za-z-]*\d){3})[A-Za-z0-9-]{5,}(?![A-Za-z0-9.])/;
/** Something said about the word, up to its colon: "（中国）：", " of China: ". */
const SAID_ABOUT_IT = /^\s*(?:[（(][^)）]{1,12}[)）]|of\s+[A-Za-z ]{1,16})\s*[:：]\s*/i;
const LABEL_TAIL = /^[\s:：#.()（）-]*(?:number|num\b|no\b|nr\b|is\b|号码|字号|证号|编号|号|码|番号|번호|为|是)?[\s:：#.()（）-]*(?:为|是|is\b)?[\s:：#.()（）-]*/i;
const NUMBER_LAST = /[A-Za-z]{0,3}\d(?:[A-Za-z0-9-]{5,}|[\d -]{5,})$/;

function wordLengthAt(text: string, at: number): number {
  const rest = text.slice(at);
  const found = toSimplified(rest).match(ID_WORD_ANY_CASE) ?? rest.match(ID_WORD_CAPITALS);
  return found ? found[0].length : 0;
}

/** Runs of blank space hold nothing, and every pattern that looks past them pays for each one. */
const tidy = (text: string): string => plain(text.slice(0, MAX_LINE)).replace(/[ \t]{3,}/g, '  ');

/** The word and little else: "Passport No.", "身份证号：". */
function isBareLabel(chunk: string): boolean {
  if (chunk.trim().length > MAX_LABEL) return false;
  const rest = pulledTogether(chunk)
    .replace(ID_WORD_ANY_CASE, '')
    .replace(ID_WORD_CAPITALS, '')
    .replace(/number|num\b|no\b|号码|字号|号|番号|번호|[\s:：#.()（）-]/gi, '');
  return rest.length === 0;
}

/** A list, a wide gap, or the next label along: "驾驶证：C1 手机：13812345678". */
const PARTS = /(\s*[|｜•·,，;；]\s*|\s{2,}|\t+|(?<=[:：]\s*\S+)\s+(?=[\p{Script=Han}A-Za-z-]{1,12}\s*[:：]))/u;

/** Part of a line, without a number that stands beside the word, and whether what remains is a label waiting for one. */
function scrubPart(part: string): { text: string; labelOnly: boolean } {
  if (!namesDocument(part)) return { text: part, labelOnly: false };
  if (isBareLabel(part)) return { text: part, labelOnly: true };
  const at = wordAt(part);
  // Only found with its words pulled together: "身 份 证 号：E12345678".
  if (at < 0) return { text: holdsDigits(part) ? '' : part, labelOnly: false };
  if (!holdsDigits(part)) return { text: part, labelOnly: false };
  // The number can come first: "E12345678 (passport)".
  const before = part.slice(0, at).replace(/[\s:：,，;；|｜(（-]+$/, '');
  if (NUMBER_LAST.test(withoutThose(before).trimEnd())) return { text: '', labelOnly: false };
  // A digit somewhere else on the line is someone else's: "办理 300 名员工社会保险", "OAuth 2.0 with Passport.js".
  const wordEnd = at + wordLengthAt(part, at);
  const rest = withoutThose(toSimplified(part.slice(wordEnd)));
  const after = rest.replace(LABEL_TAIL, '');
  // "ID:" brings its colon with it.
  const labelled = /[:#]$/.test(part.slice(at, wordEnd)) || /\S/.test(rest.slice(0, rest.length - after.length));
  const colon = SAID_ABOUT_IT.exec(rest);
  const answer = colon ? rest.slice(colon[0].length) : '';
  const isNumber = startsWithNumber(after) || (labelled && A_CODE.test(after)) || (colon !== null && (startsWithNumber(answer) || A_CODE.test(answer)));
  if (!isNumber) return { text: part, labelOnly: false };
  return { text: holdsDigits(before) ? '' : before, labelOnly: false };
}

/** What can stand after a label and be its number, unless it is plainly a phone or a date. */
function isNumberAfterLabel(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_LABEL && !/[:：]/.test(t) && holdsDigits(t) && (startsWithNumber(t) || (A_CODE.test(t) && !/\s/.test(t))) && !findPhone(t);
}

/** A Chinese ID number with no word beside it: 18 or 15 digits with a date of birth inside. Nothing else looks like one. */
const CN_ID_RUN = /(?<![\dA-Za-z])\d(?:[ -]?\d){14,16}(?:[ -]?[\dXx])?(?![\dA-Za-z])/g;
function isChineseId(run: string): boolean {
  const all = run.replace(/[ -]/g, '');
  if (all.length === 18) return /^\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(all);
  return all.length === 15 && /^\d{8}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}$/.test(all);
}

const withoutChineseId = (text: string): string => text.replace(CN_ID_RUN, (run) => (isChineseId(run) ? ' ' : run)).trim();

function scrub(raw: string): { text: string; labelOnly: boolean } {
  const parts = raw
    // "ID  Number" is one thing, however wide the gap.
    .replace(/(?<![A-Za-z])(id|identity|tax|national|social)\s{2,}(?=[A-Za-z])/gi, '$1 ')
    .split(PARTS);
  if (parts.length === 1) {
    const { text, labelOnly } = scrubPart(parts[0]!);
    return { text: withoutChineseId(text), labelOnly };
  }
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const { text, labelOnly } = scrubPart(parts[i]!);
    // A label beside other things, with its number next along the same line, goes with it.
    if (labelOnly && isNumberAfterLabel(parts[i + 2] ?? '')) {
      i += 2;
      continue;
    }
    if (text) out.push(out.length > 0 ? `${parts[i - 1] ?? ' '}${text}` : text);
  }
  return { text: withoutChineseId(out.join('')), labelOnly: false };
}

function cleanCells(raw: string[]): string[] {
  const cells = raw.slice(0, MAX_CELLS).map(tidy);
  const out: string[] = [];
  let length = 0;
  for (let i = 0; i < cells.length && length < MAX_LINE; i++) {
    const { text, labelOnly } = scrub(cells[i]!);
    if (labelOnly) {
      // Any punctuation between the label and its value is its own cell in some files, and so are groups of digits.
      let next = i + 1;
      while (next < cells.length && !/[\p{L}\d]/u.test(cells[next]!)) next++;
      if (next < cells.length && isNumberAfterLabel(cells[next]!)) {
        while (next + 1 < cells.length && isNumberAfterLabel(cells[next + 1]!)) next++;
        i = next;
        continue;
      }
    }
    const kept = text.trim().slice(0, MAX_LINE - length);
    if (kept) {
      out.push(kept);
      length += kept.length + 1;
    }
  }
  return out;
}

export function cleanLines(all: TextLine[]): TextLine[] {
  const lines = all.slice(0, MAX_LINES);
  const out: TextLine[] = [];
  let afterLabel = false;
  for (const [index, line] of lines.entries()) {
    if (line.cells.length > 1) {
      const cells = cleanCells(line.cells);
      out.push({ ...line, text: cells.join(' '), cells });
      afterLabel = false;
      continue;
    }
    const tidied = tidy(line.text);
    if (afterLabel && isNumberAfterLabel(tidied)) {
      out.push({ ...line, text: '', cells: [''] });
      afterLabel = false;
      continue;
    }
    const { text, labelOnly } = scrub(tidied);
    const next = lines[index + 1];
    // The label goes with its number, or it reads as something of its own.
    const paired = labelOnly && !!next && next.cells.length <= 1 && isNumberAfterLabel(tidy(next.text));
    const kept = paired ? '' : text;
    out.push({ ...line, text: kept, cells: [kept] });
    afterLabel = paired;
  }
  return out;
}

/** A title from a file's name, which can be named after what is in it: no run of six digits or more. */
export function titleFromFileName(fileName: string): string {
  return plain(fileName.replace(/\.[^.]+$/, ''))
    .replace(/[A-Za-z]{0,3}\d(?:[ ._()-]{0,2}\d){5,30}[A-Za-z]?/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}
