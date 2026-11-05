// Date ranges in a resume, the anchors entries are cut by.

export interface DateRange {
  start: string;
  end: string | null;
  current: boolean;
  /** A year alone had to be given a month, which the applicant has to look at. */
  monthGuessed: boolean;
  /** The text around the range. */
  rest: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};
const MONTH_WORD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const NOW = '(?:至今|迄今|今|现在|現在|目前|(?:present|current|now|ongoing|today)(?![A-Za-z]))';
const SEPARATOR = '\\s*(?:-|–|—|―|~|～|至|到|to)\\s*';

const NUMERIC = '(?:19|20)\\d{2}\\s*(?:[./-]|年)\\s*(?:0?[1-9]|1[0-2])(?:\\s*月)?';
const WORD = `(?<![A-Za-z])${MONTH_WORD}\\s+(?:19|20)\\d{2}`;
const YEAR = '(?:19|20)\\d{2}(?:\\s*年)?';
const POINT = `(?:${NUMERIC}|${WORD}|${YEAR})`;
const RANGE = new RegExp(`(?<![\\d./-])(${POINT})${SEPARATOR}(${POINT}|${NOW})(?![.\\d]*\\d)`, 'iu');

function readPoint(raw: string, asEnd: boolean): { value: string; guessed: boolean } | null {
  const t = raw.trim().toLowerCase();
  const numeric = /^((?:19|20)\d{2})\s*(?:[./-]|年)\s*(\d{1,2})/.exec(t);
  if (numeric) return { value: `${numeric[1]}-${numeric[2]!.padStart(2, '0')}`, guessed: false };
  const word = /^([a-z]+)\.?\s+((?:19|20)\d{2})/.exec(t);
  if (word) {
    const month = MONTHS[word[1]!.slice(0, 4)] ?? MONTHS[word[1]!.slice(0, 3)];
    return month ? { value: `${word[2]}-${month}`, guessed: false } : null;
  }
  const year = /^((?:19|20)\d{2})/.exec(t);
  return year ? { value: `${year[1]}-${asEnd ? '12' : '01'}`, guessed: true } : null;
}

export function findDateRange(text: string): DateRange | null {
  const m = RANGE.exec(text);
  if (!m) return null;
  const start = readPoint(m[1]!, false);
  if (!start) return null;
  const current = new RegExp(`^${NOW}$`, 'iu').test(m[2]!.trim());
  const end = current ? null : readPoint(m[2]!, true);
  if (!current && !end) return null;
  if (end && end.value < start.value) return null;
  const rest = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').replace(/^[\s,，|·•/-]+|[\s,，|·•/-]+$/g, '');
  return { start: start.value, end: end?.value ?? null, current, monthGuessed: start.guessed || !!end?.guessed, rest };
}
