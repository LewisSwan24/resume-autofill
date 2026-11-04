import { describe, expect, it } from 'vitest';
import { formatByPattern, isDatePattern } from '../../../src/engine/dateFormat';

describe('date patterns in a placeholder', () => {
  it.each([
    ['MM/YYYY', '02/2019'],
    ['mm/yyyy', '02/2019'],
    ['MM / YYYY', '02 / 2019'],
    ['YYYY-MM', '2019-02'],
    ['YYYY/MM', '2019/02'],
    ['YYYY.MM', '2019.02'],
    ['MM/YY', '02/19'],
    ['YYYY', '2019'],
    ['YYYY-MM-DD', '2019-02-01'],
    ['DD/MM/YYYY', '01/02/2019'],
    ['MM/DD/YYYY', '02/01/2019'],
  ])('writes %s as %s', (pattern, want) => {
    expect(isDatePattern(pattern)).toBe(true);
    expect(formatByPattern(pattern, { year: 2019, month: 2 })).toBe(want);
  });

  it('keeps a day the resume has', () => {
    expect(formatByPattern('DD/MM/YYYY', { year: 2019, month: 2, day: 14 })).toBe('14/02/2019');
  });

  it.each(['', 'Start date', 'e.g. 2019', 'MM', 'DD/MM', 'Enter MM/YYYY', 'YYYYMMDD please'])('does not read %j as a pattern', (text) => {
    expect(isDatePattern(text)).toBe(false);
  });
});
