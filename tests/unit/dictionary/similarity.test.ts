import { describe, expect, it } from 'vitest';
import { dice, jaroWinkler, labelSimilarity } from '../../../src/dictionary/similarity';

describe('dice', () => {
  it('identical strings → 1', () => expect(dice('night', 'night')).toBe(1));
  it('disjoint strings → 0', () => expect(dice('abcd', 'wxyz')).toBe(0));
  it('known value: night vs nacht = 0.25', () => expect(dice('night', 'nacht')).toBeCloseTo(0.25, 5));
  it('is symmetric', () => expect(dice('学校名称', '学校')).toBeCloseTo(dice('学校', '学校名称'), 10));
  it('single chars: only equal → 1, otherwise 0', () => {
    expect(dice('a', 'a')).toBe(1);
    expect(dice('a', 'b')).toBe(0);
    expect(dice('a', 'ab')).toBe(0);
  });
  it('empty strings → 0', () => expect(dice('', 'abc')).toBe(0));
  it('counts repeated bigrams as a multiset', () => {
    // "aaaa" has 3 × "aa"; "aa" has 1 → 2*1/(3+1)
    expect(dice('aaaa', 'aa')).toBeCloseTo(0.5, 5);
  });
});

describe('jaroWinkler', () => {
  it('identical → 1', () => expect(jaroWinkler('martha', 'martha')).toBe(1));
  it('both empty → 1, one empty → 0', () => {
    expect(jaroWinkler('', '')).toBe(1);
    expect(jaroWinkler('', 'a')).toBe(0);
  });
  it('classic MARTHA/MARHTA = 0.9611', () => expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3));
  it('classic DIXON/DICKSONX = 0.8133', () => expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.8133, 3));
  it('disjoint → 0', () => expect(jaroWinkler('abc', 'xyz')).toBe(0));
  it('shared prefix scores higher', () => {
    expect(jaroWinkler('prefixabc', 'prefixxyz')).toBeGreaterThan(jaroWinkler('abcprefix', 'xyzprefix'));
  });
});

describe('labelSimilarity', () => {
  it('exact after normalization → 1', () => {
    expect(labelSimilarity('Email *', 'email')).toBe(1);
    expect(labelSimilarity('姓名：', '姓名')).toBe(1);
  });
  it('is symmetric', () => {
    expect(labelSimilarity('First name', 'first')).toBeCloseTo(labelSimilarity('first', 'First name'), 10);
  });
  it('empty input → 0', () => {
    expect(labelSimilarity('', 'abc')).toBe(0);
    expect(labelSimilarity('请输入', '')).toBe(0);
  });
  it('containment is high but below exact', () => {
    const s = labelSimilarity('毕业学校', '学校');
    expect(s).toBeGreaterThanOrEqual(0.8);
    expect(s).toBeLessThan(1);
  });
  it('containment requires length ratio ≥ 0.5 (otherwise falls back to fuzzy)', () => {
    expect(labelSimilarity('name', 'please tell us the name of your favourite pet')).toBeLessThan(0.7);
  });
  it('latin containment respects word boundaries', () => {
    expect(labelSimilarity('username', 'name')).toBeLessThan(0.8);
    expect(labelSimilarity('home address', 'address')).toBeGreaterThanOrEqual(0.8);
  });
  it('monotonic: exact > containment > near-typo > unrelated', () => {
    const exact = labelSimilarity('education', 'education');
    const contain = labelSimilarity('education history', 'education');
    const typo = labelSimilarity('educaton', 'education');
    const unrelated = labelSimilarity('xyzzy', 'education');
    expect(exact).toBeGreaterThan(contain);
    expect(contain).toBeGreaterThan(unrelated);
    expect(typo).toBeGreaterThan(unrelated);
    expect(exact).toBeGreaterThan(typo);
  });
  it('closer containment ratio scores higher', () => {
    expect(labelSimilarity('毕业学校', '学校')).toBeGreaterThan(labelSimilarity('毕业学校名称全称', '学校'));
  });
  it('stays within [0, 1]', () => {
    for (const [a, b] of [['a', 'b'], ['学校', '学历'], ['Phone', 'Mobile phone']] as const) {
      const s = labelSimilarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
