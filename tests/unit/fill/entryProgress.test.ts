import { describe, expect, it } from 'vitest';
import type { SectionGrowth } from '../../../src/fill/ensureCards';
import { entriesInPlace } from '../../../src/fill/entryProgress';

const none = new Map();
const noName = () => '';

describe('entriesInPlace', () => {
  it('says the cap on clicks stopped it, not a button that failed', () => {
    const growth: SectionGrowth[] = [{ section: 'awards', have: 13, need: 14, added: 12, status: 'action_failed', label: '添加奖项', capped: true }];
    const entries = entriesInPlace(growth, [], none, noName);
    expect(entries).toHaveLength(14);
    expect(entries[0]).toEqual({ section: 'awards', index: 0, state: 'existing' });
    expect(entries[12]).toEqual({ section: 'awards', index: 12, state: 'added' });
    expect(entries[13]).toEqual({ section: 'awards', index: 13, state: 'skipped', reason: 'max_adds' });
  });

  it('lists a section that had enough cards from the entries its fields name, in page order', () => {
    const fields = [
      { fieldId: 'a', label: '公司', fieldKey: null, section: 'internship' as const, outcome: 'filled' as const, confidence: 1, entry: 1 },
      { fieldId: 'b', label: '公司', fieldKey: null, section: 'internship' as const, outcome: 'filled' as const, confidence: 1, entry: 0 },
    ];
    expect(entriesInPlace([], fields, none, (s, i) => `${s}-${i}`)).toEqual([
      { section: 'internship', index: 0, state: 'existing', label: 'internship-0' },
      { section: 'internship', index: 1, state: 'existing', label: 'internship-1' },
    ]);
  });
});
