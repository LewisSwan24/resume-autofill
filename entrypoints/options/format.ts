// Small display formatters for the options page (dates, sizes). Dates follow the UI language, not the system locale.
import type { Language } from '../../src/i18n';

const intlLocale = (language: Language) => (language === 'zh' ? 'zh-CN' : 'en-AU');

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today, 14:05" for today, otherwise a short date ("4 Nov", "4 Nov 2025" for another year). */
export function formatWhen(timestamp: number, language: Language, todayWord: string, now: Date = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const locale = intlLocale(language);
  if (sameDay(date, now)) {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return language === 'zh' ? `${todayWord} ${time}` : `${todayWord}, ${time}`;
  }
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
