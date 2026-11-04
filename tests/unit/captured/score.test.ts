// @vitest-environment node
// The scorer decides whether a real-page sample passes, so it needs proof that it can fail.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import {
  accuracyOf,
  listSamples,
  recordScore,
  renderAccuracyTable,
  scoreLine,
  scoreProblems,
  scoreSample,
  type CapturedExpected,
  type Inspection,
} from '../../../tests/shared/capturedExpectations';

const expected = (over: Partial<CapturedExpected> = {}): CapturedExpected => ({
  __resume: 'en-AU',
  __knownGapsMax: 0,
  fields: {
    Email: { selector: '#email', expect: 'a@b.example' },
    Phone: { selector: '#phone', contains: '412345678' },
    Resume: { selector: '#resume', expect: ['cv.pdf'] },
  },
  ...over,
});

const report = (fields: Partial<FieldReport>[] = []): FillReport => ({
  url: 'https://x.example',
  startedAt: 0,
  finishedAt: 0,
  fields: fields as FieldReport[],
  counts: { filled: 0, needs_review: 0, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
});

const emptyPage: Inspection = {
  snapshot: { 'text#email': '', 'text#phone': '', 'file#resume': '', 'text#other': '' },
  readings: { Email: '', Phone: '', Resume: [] },
  coverage: { Email: ['text#email'], Phone: ['text#phone'], Resume: ['file#resume'] },
};

const filled = (over: { readings?: Inspection['readings']; snapshot?: Inspection['snapshot']; coverage?: Inspection['coverage'] } = {}): Inspection => ({
  snapshot: { ...emptyPage.snapshot, 'text#email': 'a@b.example', 'text#phone': '+61 412345678', 'file#resume': '["cv.pdf"]', ...over.snapshot },
  readings: { Email: 'a@b.example', Phone: '+61 412345678', Resume: ['cv.pdf'], ...over.readings },
  coverage: { ...emptyPage.coverage, ...over.coverage },
});

const sample = (e = expected()) => ({ ats: 'ats', name: 's', expected: e });
const problems = (e: CapturedExpected, after: Inspection, r = report()) =>
  scoreProblems(scoreSample(sample(e), 'harness', emptyPage, after, r), e);

describe('scoreSample', () => {
  it('passes a perfect fill and counts it', () => {
    const score = scoreSample(sample(), 'harness', emptyPage, filled(), report());
    expect(score.correct).toBe(3);
    expect(scoreProblems(score, expected())).toEqual([]);
    expect(accuracyOf(score)).toBe(100);
  });

  it('fails a wrong value and says what it found', () => {
    const out = problems(expected(), filled({ readings: { Email: 'other@b.example' } }));
    expect(out.join()).toMatch(/wrong Email.*other@b\.example/);
  });

  it('fails a field left empty, separately from a wrong one', () => {
    const score = scoreSample(sample(), 'harness', emptyPage, filled({ readings: { Phone: '' } }), report());
    expect(score.missing).toEqual(['Phone']);
    expect(score.wrong).toEqual([]);
    expect(scoreProblems(score, expected()).join()).toMatch(/missing Phone/);
  });

  it('checks `contains` on the text only', () => {
    expect(problems(expected(), filled({ readings: { Phone: '0412345678' } }))).toEqual([]);
    expect(problems(expected(), filled({ readings: { Phone: '0499999999' } })).join()).toMatch(/wrong Phone/);
  });

  it('fails when any control outside the expected fields changed', () => {
    const out = problems(expected(), filled({ snapshot: { 'text#other': 'typed by mistake' } }));
    expect(out.join()).toMatch(/unexpected change text#other/);
  });

  it('fails when a control appears already holding a value', () => {
    const out = problems(expected(), filled({ snapshot: { 'text#new': 'x' } }));
    expect(out.join()).toMatch(/unexpected change text#new/);
  });

  it('treats a filled known gap as an unexpected change, so it must move to fields', () => {
    const e = expected({ __knownGaps: { Other: { selector: '#other', reason: 'no driver' } }, __knownGapsMax: 1 });
    const out = problems(e, filled({ snapshot: { 'text#other': 'x' }, coverage: { Other: ['text#other'] } }));
    expect(out.join()).toMatch(/unexpected change text#other/);
  });

  describe('a gap only a live page can fill, since its answers come from a search service', () => {
    const gap = { City: { selector: '#city', reason: 'r', contains: 'Brisbane', live: true as const } };
    const score = (mode: string, city: string) => {
      const after = filled({
        readings: { City: city },
        snapshot: { 'text#city': city },
        coverage: { City: ['text#city'] },
      });
      return scoreSample(sample(expected({ __knownGaps: gap, __knownGapsMax: 1 })), mode, emptyPage, after, report());
    };

    it('stays a gap in a replay', () => {
      const s = score('harness', '');
      expect(s.gaps).toEqual(['City']);
      expect(accuracyOf(s)).toBeLessThan(100);
      expect(scoreProblems(s, expected({ __knownGaps: gap, __knownGapsMax: 1 }))).toEqual([]);
    });

    it('counts as correct on a live page when it holds the answer', () => {
      const s = score('live', 'Brisbane, Queensland, Australia');
      expect(s.gaps).toEqual([]);
      expect(s.correct).toBe(4);
      expect(s.extras).toEqual([]);
      expect(scoreProblems(s, expected({ __knownGaps: gap, __knownGapsMax: 1 }))).toEqual([]);
    });

    it('is missing on a live page when it stays empty', () => {
      expect(score('live', '').missing).toEqual(['City']);
    });

    it('is wrong on a live page when it holds something else', () => {
      expect(score('live', 'Sydney').wrong.map((w) => w.label)).toEqual(['City']);
    });
  });

  it('counts known gaps as not correct', () => {
    const e = expected({ __knownGaps: { Other: { selector: '#other', reason: 'no driver' } }, __knownGapsMax: 1 });
    const score = scoreSample(sample(e), 'harness', emptyPage, filled({ coverage: { Other: ['text#other'] } }), report());
    expect(accuracyOf(score)).toBe(75);
    expect(scoreProblems(score, e)).toEqual([]);
  });

  it('forces __knownGapsMax to move with the gaps, in both directions', () => {
    const gap = { Other: { selector: '#other', reason: 'r' } };
    const after = filled({ coverage: { Other: ['text#other'] } });
    expect(problems(expected({ __knownGaps: gap, __knownGapsMax: 2 }), after).join()).toMatch(/known gaps: 1/);
    expect(problems(expected({ __knownGaps: gap, __knownGapsMax: 0 }), after).join()).toMatch(/known gaps: 1/);
  });

  it('fails a selector that finds nothing', () => {
    const e = expected({ __knownGaps: { Gone: { selector: '#gone', reason: 'r' } }, __knownGapsMax: 1 });
    expect(problems(e, filled({ coverage: { Gone: [] } })).join()).toMatch(/stale selector Gone/);
    expect(problems(expected(), filled({ coverage: { Email: [] } })).join()).toMatch(/stale selector Email/);
  });

  it('fails a trap reported as filled, and ignores it when not filled', () => {
    const e = expected({ __traps: ['agreement'] });
    expect(problems(e, filled(), report([{ label: 'Agreement to Arbitrate', outcome: 'filled' }])).join()).toMatch(/trap filled/);
    expect(problems(e, filled(), report([{ label: 'Agreement to Arbitrate', outcome: 'unmatched' }]))).toEqual([]);
  });

  describe('review fields', () => {
    const e = expected({ __review: { Pronouns: { selector: '#p', labelRe: 'pronouns' } } });
    const after = (reading: Inspection['readings'][string]) =>
      filled({ readings: { Pronouns: reading }, coverage: { Pronouns: ['text#p'] } });

    it('pass when empty and reported needs_review or no_option', () => {
      expect(problems(e, after(''), report([{ label: 'Pronouns', outcome: 'needs_review' }]))).toEqual([]);
      expect(problems(e, after(''), report([{ label: 'Pronouns', outcome: 'no_option' }]))).toEqual([]);
    });

    it('fail when filled, unreported or reported otherwise', () => {
      expect(problems(e, after('he/him'), report([{ label: 'Pronouns', outcome: 'needs_review' }])).join()).toMatch(/not empty/);
      expect(problems(e, after('')).join()).toMatch(/no report row/);
      expect(problems(e, after(''), report([{ label: 'Pronouns', outcome: 'unmatched' }])).join()).toMatch(/reported unmatched/);
    });
  });

  it('passes an exists field only when the element is there, and does not call it stale', () => {
    const e = expected({ fields: { Upload: { selector: '.progress', exists: true } } });
    const at = (reading: boolean): Inspection => ({ snapshot: {}, readings: { Upload: reading }, coverage: { Upload: [] } });
    expect(scoreProblems(scoreSample(sample(e), 'harness', emptyPage, at(true), report()), e)).toEqual([]);
    expect(scoreProblems(scoreSample(sample(e), 'harness', emptyPage, at(false), report()), e)).toEqual(['missing Upload']);
  });

  it('fails a row reported filled with nothing read back, but not a checkbox left unchecked', () => {
    const lost = report([{ label: 'Gender', outcome: 'filled', value: 'Male', observed: '' }]);
    expect(problems(expected(), filled(), lost).join()).toMatch(/nothing read back: Gender/);
    const unchecked = report([{ label: 'Remote', outcome: 'filled', value: 'false', observed: '' }]);
    expect(problems(expected(), filled(), unchecked)).toEqual([]);
  });

  it('renders the accuracy table, with unexpected changes counted as wrong', () => {
    const score = scoreSample(sample(), 'extension', emptyPage, filled({ snapshot: { 'text#other': 'x' } }), report());
    expect(renderAccuracyTable([score])).toContain('| ats/s | extension | 3 | 3 | 100% | 1 | 0 | 0 | 0 | 0 |');
  });

  it('prints a table line that counts unexpected changes as wrong', () => {
    const score = scoreSample(sample(), 'harness', emptyPage, filled({ snapshot: { 'text#other': 'x' } }), report());
    expect(scoreLine(score)).toContain('ats/s (harness): 3/3 = 100%, wrong 1, missing 0, known gaps 0');
  });
});

describe('listSamples and recordScore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'raf-captured-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, data: unknown) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  };

  it('returns nothing for a missing directory', () => {
    expect(listSamples(path.join(root, 'nope'))).toEqual([]);
  });

  it('only takes captures that have an expected.json', () => {
    write('lever/ready/meta.json', { url: 'https://x.example/a' });
    write('lever/ready/expected.json', expected());
    write('lever/not-ready/meta.json', { url: 'https://x.example/b' });
    const samples = listSamples(root);
    expect(samples.map((s) => `${s.ats}/${s.name}`)).toEqual(['lever/ready']);
    expect(samples[0]!.url).toBe('https://x.example/a');
  });

  it('merges scores by sample and mode', () => {
    const file = path.join(root, 'out', 'acc.json');
    const a = scoreSample(sample(), 'harness', emptyPage, filled(), report());
    recordScore(a, file);
    recordScore({ ...a, mode: 'extension' }, file);
    recordScore({ ...a, correct: 1 }, file);
    const rows = JSON.parse(readFileSync(file, 'utf8')) as { mode: string; correct: number }[];
    expect(rows.map((r) => [r.mode, r.correct]).sort()).toEqual([['extension', 3], ['harness', 1]]);
  });
});
