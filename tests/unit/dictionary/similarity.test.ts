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

describe('whole questions that only share their small words', () => {
  it.each([
    ['How many years of professional experience do you have working in this industry?', 'Have you served in the Australian Defence Force'],
    ['How comfortable are you with AI-assisted development tools in engineering workflows?', 'Are you of Aboriginal or Torres Strait Islander origin'],
    ['Are you currently located in the country?', 'Are you a veteran'],
    ['If you were referred to this role, please enter the name of the employee', 'How do you know this referee'],
    ['How many years of experience do you have leading engineering teams?', 'Years of experience'],
    ['Which location are you applying for?', 'Are you willing to relocate'],
    ['Which location are you applying for?', 'Role applying for'],
  ])('"%s" is nothing like "%s"', (a, b) => {
    expect(labelSimilarity(a, b)).toBeLessThan(0.45);
  });

  it.each([
    ['Educaton', 'Education'],
    ['Emial address', 'Email address'],
    ['Phone numbr', 'Phone number'],
    ['Years of experiense', 'Years of experience'],
    ['Do you need visa sponsorship to work here', 'Do you require visa sponsorship to work'],
  ])('still sees "%s" as close to "%s"', (a, b) => {
    expect(labelSimilarity(a, b)).toBeGreaterThanOrEqual(0.45);
  });

  it('leaves Chinese alone, which has no small words to split on', () => {
    expect(labelSimilarity('毕业学校名称', '毕业院校名称')).toBeGreaterThanOrEqual(0.45);
  });
});

describe('a long phrase inside a much longer question', () => {
  const long = 'Do you have full legal working rights within this country and do not require further visa sponsorship now or in the future?';

  it('says what the question touches on, but never enough to fill it', () => {
    const sim = labelSimilarity(long, 'Full legal working rights');
    expect(sim).toBeGreaterThanOrEqual(0.5);
    expect(sim).toBeLessThan(0.75);
  });

  it('needs three words that say something', () => {
    expect(labelSimilarity(long, 'Working rights')).toBeLessThan(0.45);
    expect(labelSimilarity(long, 'Do you have')).toBeLessThan(0.45);
  });

  it('needs them in that order and next to each other', () => {
    expect(labelSimilarity(long, 'Rights full working legal')).toBeLessThan(0.45);
  });
});


describe('a unit written after a measure, as 实习时长（月）', () => {
  it.each([
    ['可实习时长（月）', '可实习时长'],
    ['工作年限（年）', '工作年限'],
    ['每周实习天数（天）', '每周实习天数'],
    ['目前月薪（元）', '目前月薪'],
  ])('"%s" still contains "%s"', (label, synonym) => {
    expect(labelSimilarity(label, synonym)).toBeGreaterThanOrEqual(0.75);
  });

  it.each([
    ['出生年月', '出生年'],
    ['开始时间年', '开始时间'],
    ['公司规模', '公司'],
  ])('"%s" is still about something other than "%s"', (label, synonym) => {
    expect(labelSimilarity(label, synonym)).toBeLessThan(0.75);
  });
});
