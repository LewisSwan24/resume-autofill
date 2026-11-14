// When a recent page was added, in words short enough for a phone row: 刚刚, 5 分钟前, 昨天 20:05, 11月3日.
import type { Language } from '../../../../src/i18n';
import { mt } from '../i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const dayStart = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const pad = (n: number) => String(n).padStart(2, '0');

export function relativeTime(ts: number, now: number, language: Language): string {
  const when = Math.min(ts, now); // a clock change can put a time in the future: treat it as now
  const diff = now - when;
  if (diff < MINUTE) return mt(language, 'm.time.justNow');
  if (diff < HOUR) return mt(language, 'm.time.minutes', { n: Math.floor(diff / MINUTE) });

  const today = dayStart(now);
  const day = dayStart(when);
  if (day === today) return mt(language, 'm.time.hours', { n: Math.floor(diff / HOUR) });

  const date = new Date(when);
  const yesterday = dayStart(today - 1);
  if (day === yesterday) return mt(language, 'm.time.yesterday', { time: `${pad(date.getHours())}:${pad(date.getMinutes())}` });

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
  }).format(date);
}
