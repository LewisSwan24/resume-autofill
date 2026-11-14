// Recent pages show when each link was added, in words that fit a phone row.
import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../../mobile/app/src/home/relativeTime';

// Local times, so the calendar-day rules hold in any time zone.
const now = new Date(2026, 10, 15, 14, 30).getTime();
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();

describe('relativeTime', () => {
  it('just now under a minute, and a future time counts as now', () => {
    expect(relativeTime(now - 30_000, now, 'zh')).toBe('刚刚');
    expect(relativeTime(now - 30_000, now, 'en')).toBe('Just now');
    expect(relativeTime(now + 3_600_000, now, 'zh')).toBe('刚刚');
  });

  it('minutes under an hour', () => {
    expect(relativeTime(now - 5 * 60_000, now, 'zh')).toBe('5 分钟前');
    expect(relativeTime(now - 59 * 60_000, now, 'en')).toBe('59 min ago');
  });

  it('hours on the same day', () => {
    expect(relativeTime(at(2026, 11, 15, 9, 10), now, 'zh')).toBe('5 小时前');
    expect(relativeTime(at(2026, 11, 15, 0, 5), now, 'en')).toBe('14 h ago');
  });

  it('yesterday with the time', () => {
    expect(relativeTime(at(2026, 11, 14, 20, 5), now, 'zh')).toBe('昨天 20:05');
    expect(relativeTime(at(2026, 11, 14, 8, 0), now, 'en')).toBe('Yesterday 08:00');
    // Under 24 hours but on the previous calendar day is still "yesterday".
    const earlyNow = at(2026, 11, 15, 1, 0);
    expect(relativeTime(at(2026, 11, 14, 23, 30), earlyNow, 'zh')).toBe('昨天 23:30');
  });

  it('a date in the same year, and the year for older ones', () => {
    expect(relativeTime(at(2026, 11, 3, 10, 0), now, 'zh')).toBe('11月3日');
    expect(relativeTime(at(2026, 11, 3, 10, 0), now, 'en')).toBe('3 November');
    expect(relativeTime(at(2025, 11, 3, 10, 0), now, 'zh')).toBe('2025年11月3日');
    expect(relativeTime(at(2025, 11, 3, 10, 0), now, 'en')).toBe('3 November 2025');
  });
});
