// A text box that asks for a date often says how in its placeholder: "MM/YYYY", "DD/MM/YYYY".

const TOKEN = /Y{4}|Y{2}|M{2}|D{2}/gi;
const PATTERN = /^(?:Y{4}|(?:Y{2}|Y{4}|M{2}|D{2})(?:\s*[-/.]\s*(?:Y{4}|Y{2}|M{2}|D{2}))+)$/i;

export interface DateParts {
  year: number;
  month: number;
  day?: number;
}

/** True for text that is nothing but a date pattern with a year in it. */
export function isDatePattern(text: string): boolean {
  const t = text.trim();
  return PATTERN.test(t) && /y/i.test(t);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Month-only data on a pattern with a day takes the first of the month, as on a native date input. */
export function formatByPattern(pattern: string, date: DateParts): string {
  return pattern.trim().replace(TOKEN, (token) => {
    const kind = token[0]!.toUpperCase();
    if (kind === 'Y') return token.length === 4 ? String(date.year).padStart(4, '0') : pad(date.year % 100);
    return kind === 'M' ? pad(date.month) : pad(date.day ?? 1);
  });
}
