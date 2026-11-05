// What every line goes through before anything reads it: identity numbers come out, and no line can hang the page.
// There are too many ways to write one to recognise the number, so the word decides: from the word on, the line is gone.
import type { TextLine } from '../extract/types';

/** A line longer than this is no line of a resume, and the rest of it is not read. */
const MAX_LINE = 4000;
/** More lines than this is no resume, and the rest of the file is not read. */
const MAX_LINES = 2000;
/** A label alone on its line or in its cell is no longer than this. */
const MAX_LABEL = 30;

const ID_WORD = new RegExp(
  [
    '身份[证證]|[证證]件|[护護][照]|通行[证證]|社保|社会保障|社會保障|[驾駕]照|[驾駕]驶[证證]|[驾駕]駛[證证]|居住[证證]',
    "(?<![A-Za-z])(?:passport|social security|tax file|national insurance|national id|national identity|identity (?:number|no|card)|government id|driving licen[cs]e|driver'?s? licen[cs]e|medicare|aadhaar|id (?:number|no\\b|card)|id#)",
    '(?<![A-Za-z])(?:PASSPORT|SSN|TFN|NRIC|HKID|SIN|NI|CPF|DNI|ssn|tfn|nric|hkid)(?![A-Za-z])',
  ].join('|'),
);
const ID_WORD_ANY_CASE = new RegExp(
  "身份[证證]|[证證]件|[护護]照|通行[证證]|社保|社会保障|社會保障|[驾駕]照|[驾駕]驶[证證]|[驾駕]駛[證证]|居住[证證]|(?<![a-z])(?:passport|social security|tax file|national insurance|national id|national identity|identity (?:number|no|card)|government id|driving licen[cs]e|driver'?s? licen[cs]e|medicare|aadhaar|id (?:number|no\\b|card)|id#)",
  'i',
);

/** China's number, in one piece or in groups, which means one thing wherever it stands. */
const BARE_CN_ID = /(?<!\d)\d{6}[ -]?(?:19|20)\d{2}[ -]?(?:0[1-9]|1[0-2])[ -]?(?:0[1-9]|[12]\d|3[01])[ -]?\d{3}[\dXx](?![\dA-Za-z])/g;
const YEAR_RANGE = /(?:19|20)\d{2}(?:[./-]\d{1,2})?\s*(?:-|–|—|~|to|至)\s*(?:(?:19|20)\d{2}(?:[./-]\d{1,2})?)/g;

const digitCount = (s: string): number => (s.match(/\d/g) ?? []).length;

/** Something that could be an identity number: five digits or more in a run, or a code of letters and digits. */
function holdsNumber(text: string): boolean {
  const t = text.replace(YEAR_RANGE, ' ');
  for (const m of t.match(/\d[\d\s.\-()]{3,}/g) ?? []) if (digitCount(m) >= 5) return true;
  return (t.match(/[A-Za-z0-9]{6,}/g) ?? []).some((w) => digitCount(w) >= 2);
}

function wordAt(text: string): number {
  const a = text.search(ID_WORD);
  const b = text.search(ID_WORD_ANY_CASE);
  if (a < 0) return b;
  return b < 0 ? a : Math.min(a, b);
}

/** Runs of blank space hold nothing, and every pattern that looks past them pays for each one. */
const tidy = (text: string): string => text.slice(0, MAX_LINE).replace(/[ \t ]{3,}/g, '  ').replace(/　{2,}/g, '　');

/** The text without its identity number, and whether it was a label waiting for one on the next line or in the next cell. */
function scrub(raw: string): { text: string; labelOnly: boolean } {
  const at = wordAt(raw);
  const text = raw.replace(BARE_CN_ID, ' ');
  if (at < 0) return { text, labelOnly: false };
  const before = raw.slice(0, at);
  if (!holdsNumber(raw.slice(at))) {
    // "E12345678 (passport)": the number first.
    if (holdsNumber(before)) return { text: '', labelOnly: false };
    return { text, labelOnly: text.trim().length <= MAX_LABEL };
  }
  return { text: holdsNumber(before) ? '' : before.replace(/[\s:：,，;；|｜(（-]+$/, ''), labelOnly: false };
}

function cleanCells(cells: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    const { text, labelOnly } = scrub(tidy(cells[i]!));
    if (labelOnly) {
      if (i + 1 < cells.length && holdsNumber(cells[i + 1]!)) {
        i++;
        continue;
      }
    }
    if (text.trim()) out.push(text.trim());
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
    if (afterLabel && holdsNumber(tidied) && tidied.length <= MAX_LABEL) {
      out.push({ ...line, text: '', cells: [''] });
      afterLabel = false;
      continue;
    }
    const { text, labelOnly } = scrub(tidied);
    const next = lines[index + 1];
    // The label goes with its number, or it reads as something of its own.
    const paired = labelOnly && !!next && next.cells.length <= 1 && holdsNumber(tidy(next.text)) && next.text.length <= MAX_LABEL;
    const kept = paired ? '' : text;
    out.push({ ...line, text: kept, cells: [kept] });
    afterLabel = paired;
  }
  return out;
}

const LONG_NUMBER = /(?<![\dA-Za-z])(?:[A-Za-z]{1,3}[ -]?)?\d(?:[ .-]?\d){7,}[A-Za-z]?(?![\dA-Za-z])/g;
const LETTERS_THEN_NUMBER = /(?<![\dA-Za-z])[A-Za-z]{1,3}\d{6,}[A-Za-z]?(?![\dA-Za-z])/g;

/**
 * For what the applicant wrote freely, where no number this long belongs anyway: it could be anyone's anything.
 * Amounts with commas and years stay. Whatever else this takes, the check page shows the line it came from.
 */
export function withoutLongNumbers(text: string): string {
  return text
    .replace(LONG_NUMBER, (m) => (/^(?:19|20)\d{2}\D+(?:19|20)\d{2}/.test(m) ? m : ' '))
    .replace(LETTERS_THEN_NUMBER, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}
