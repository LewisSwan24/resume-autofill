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
  verdictSelectors,
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

/** The report of a run that filled the three fields of `expected()`. */
const allFilled = (extra: Partial<FieldReport>[] = []): FillReport =>
  report([
    { label: 'Email', outcome: 'filled', observed: 'a@b.example' },
    { label: 'Phone', outcome: 'filled', observed: '0412345678' },
    { label: 'Resume', outcome: 'filled', observed: 'cv.pdf' },
    ...extra,
  ]);

const sample = (e = expected()) => ({ ats: 'ats', name: 's', expected: e });
const problems = (e: CapturedExpected, after: Inspection, r = allFilled()) =>
  scoreProblems(scoreSample(sample(e), 'harness', emptyPage, after, r), e);

describe('scoreSample', () => {
  it('passes a perfect fill and counts it', () => {
    const score = scoreSample(sample(), 'harness', emptyPage, filled(), allFilled());
    expect(score.correct).toBe(3);
    expect(scoreProblems(score, expected())).toEqual([]);
    expect(accuracyOf(score)).toBe(100);
  });

  it('fails a wrong value and says what it found', () => {
    const out = problems(expected(), filled({ readings: { Email: 'other@b.example' } }));
    expect(out.join()).toMatch(/wrong Email.*other@b\.example/);
  });

  it('fails a field left empty, separately from a wrong one', () => {
    const score = scoreSample(sample(), 'harness', emptyPage, filled({ readings: { Phone: '' } }), allFilled());
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

  it('lets the page change an input it keeps for itself, and nothing else beside it', () => {
    const e = expected({ __pageOwn: { 'Change count': { selector: '#other', reason: 'the page counts its own edits' } } });
    expect(problems(e, filled({ snapshot: { 'text#other': '7' }, coverage: { 'Change count': ['text#other'] } }))).toEqual([]);
    const out = problems(e, filled({ snapshot: { 'text#other': '7', 'text#new': 'x' }, coverage: { 'Change count': ['text#other'] } }));
    expect(out.join()).toMatch(/unexpected change text#new/);
    expect(verdictSelectors(e)).toContain('#other');
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
      return scoreSample(sample(expected({ __knownGaps: gap, __knownGapsMax: 1 })), mode, emptyPage, after, allFilled(city ? [{ label: 'City', outcome: 'filled', observed: city }] : []));
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

  describe('controls with no id or name are told apart by their order', () => {
    const before: Inspection = { ...emptyPage, snapshot: { ...emptyPage.snapshot, 'checkbox=': '', 'checkbox=~1': 'true' } };

    it('one the fill adds in front of another moves its number, which is not a change', () => {
      const after = filled({ snapshot: { 'checkbox=': '', 'checkbox=~1': '', 'checkbox=~2': 'true' } });
      expect(scoreSample(sample(expected()), 'harness', before, after, allFilled()).extras).toEqual([]);
    });

    it('one the fill adds that holds a value nothing covers is a change', () => {
      const after = filled({ snapshot: { 'checkbox=': '', 'checkbox=~1': 'true', 'checkbox=~2': 'true' } });
      expect(scoreSample(sample(expected()), 'harness', before, after, allFilled()).extras).toHaveLength(1);
    });

    it('a value that really went is still a change', () => {
      const after = filled({ snapshot: { 'checkbox=': '', 'checkbox=~1': '' } });
      expect(scoreSample(sample(expected()), 'harness', before, after, allFilled()).extras).toEqual([{ key: 'checkbox=~1', before: 'true', after: '' }]);
    });

    it('a tick that moved to another box, with none added, is a change', () => {
      const after = filled({ snapshot: { 'checkbox=': 'true', 'checkbox=~1': '' } });
      expect(scoreSample(sample(expected()), 'harness', before, after, allFilled()).extras).toHaveLength(2);
    });

    it('a tick that moved further down, with none added, is a change', () => {
      const three: Inspection = { ...emptyPage, snapshot: { ...emptyPage.snapshot, 'checkbox=': 'true', 'checkbox=~1': '', 'checkbox=~2': '' } };
      const after = filled({ snapshot: { 'checkbox=': '', 'checkbox=~1': '', 'checkbox=~2': 'true' } });
      expect(scoreSample(sample(expected()), 'harness', three, after, allFilled()).extras).toHaveLength(2);
    });

    it('a tick that moved ahead of where it was, with one added, is a change', () => {
      const three: Inspection = { ...emptyPage, snapshot: { ...emptyPage.snapshot, 'checkbox=': '', 'checkbox=~1': 'true' } };
      // One box added, but the tick now sits on the first box, before every empty one that was there.
      const after = filled({ snapshot: { 'checkbox=': 'true', 'checkbox=~1': '', 'checkbox=~2': '' } });
      expect(scoreSample(sample(expected()), 'harness', three, after, allFilled()).extras.length).toBeGreaterThan(0);
    });
  });

  it('counts known gaps as not correct', () => {
    const e = expected({ __knownGaps: { Other: { selector: '#other', reason: 'no driver' } }, __knownGapsMax: 1 });
    const score = scoreSample(sample(e), 'harness', emptyPage, filled({ coverage: { Other: ['text#other'] } }), allFilled());
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
    expect(problems(e, filled(), allFilled([{ label: 'Agreement to Arbitrate', outcome: 'filled' }])).join()).toMatch(/trap filled/);
    expect(problems(e, filled(), allFilled([{ label: 'Agreement to Arbitrate', outcome: 'unmatched' }]))).toEqual([]);
  });

  describe('review fields', () => {
    const e = expected({ __review: { Pronouns: { selector: '#p', labelRe: 'pronouns' } } });
    const after = (reading: Inspection['readings'][string]) =>
      filled({ readings: { Pronouns: reading }, coverage: { Pronouns: ['text#p'] } });

    it('pass when empty and reported needs_review or no_option', () => {
      expect(problems(e, after(''), allFilled([{ label: 'Pronouns', outcome: 'needs_review' }]))).toEqual([]);
      expect(problems(e, after(''), allFilled([{ label: 'Pronouns', outcome: 'no_option' }]))).toEqual([]);
    });

    it('fail when filled, unreported or reported otherwise', () => {
      expect(problems(e, after('he/him'), allFilled([{ label: 'Pronouns', outcome: 'needs_review' }])).join()).toMatch(/not empty/);
      expect(problems(e, after('')).join()).toMatch(/no report row/);
      expect(problems(e, after(''), allFilled([{ label: 'Pronouns', outcome: 'unmatched' }])).join()).toMatch(/reported unmatched/);
    });

    it('pick their report row by resume path, when entries of a section share a label', () => {
      const e2 = expected({ __review: { 'Dates 2': { selector: '#d2', labelRe: '^dates$', source: 'work[1].period' } } });
      const page = filled({ readings: { 'Dates 2': '' }, coverage: { 'Dates 2': ['text#d2'] } });
      const rows = allFilled([
        { label: 'Dates', outcome: 'filled', observed: '2020-01', source: 'work[0].period' },
        { label: 'Dates', outcome: 'needs_review', source: 'work[1].period' },
      ]);
      expect(problems(e2, page, rows)).toEqual([]);
      const unsourced = expected({ __review: { 'Dates 2': { selector: '#d2', labelRe: '^dates$' } } });
      expect(problems(unsourced, page, rows).join()).toMatch(/reported filled/);
    });
  });

  it('passes an exists field only when the element is there, and does not call it stale', () => {
    const e = expected({ fields: { Upload: { selector: '.progress', exists: true } } });
    const at = (reading: boolean): Inspection => ({ snapshot: {}, readings: { Upload: reading }, coverage: { Upload: [] } });
    const shown = allFilled([{ label: 'Upload', outcome: 'filled', observed: 'cv.pdf' }]);
    expect(scoreProblems(scoreSample(sample(e), 'harness', emptyPage, at(true), shown), e)).toEqual([]);
    expect(scoreProblems(scoreSample(sample(e), 'harness', emptyPage, at(false), allFilled()), e)).toEqual(['missing Upload']);
  });

  it('fails a row reported filled with nothing read back, but not a checkbox left unchecked', () => {
    const lost = allFilled([{ label: 'Gender', outcome: 'filled', value: 'Male', observed: '' }]);
    expect(problems(expected(), filled(), lost).join()).toMatch(/nothing read back: Gender/);
    const unchecked = allFilled([{ label: 'Remote', outcome: 'filled', value: 'false', observed: '' }]);
    expect(problems(expected(), filled(), unchecked)).toEqual([]);
  });

  it('renders the accuracy table, with unexpected changes counted as wrong', () => {
    const score = scoreSample(sample(), 'extension', emptyPage, filled({ snapshot: { 'text#other': 'x' } }), report());
    expect(renderAccuracyTable([score])).toContain('| ats/s | 电脑 | extension | 3 | 3 | 100% | 0 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |');
  });

  describe('fields filled only once the replay showed the steps the page held back', () => {
    // As far as the step loop reached: Email filled, Phone and Resume on a step the page would not move on to.
    const reached = filled({ readings: { Phone: '', Resume: [] }, snapshot: { 'text#phone': '', 'file#resume': '' } });

    it('are named, apart from what the fill reached by itself', () => {
      const score = scoreSample(sample(), 'harness', emptyPage, filled(), allFilled(), reached);
      expect(score.correct).toBe(3);
      expect(score.revealedOnly).toEqual(['Phone', 'Resume']);
    });

    it('do not count a field that came out wrong or a known gap', () => {
      const wrong = filled({ readings: { Phone: '+61 400000000' } });
      expect(scoreSample(sample(), 'harness', emptyPage, wrong, allFilled(), reached).revealedOnly).toEqual(['Resume']);
    });

    it('are none when nothing was held back', () => {
      expect(scoreSample(sample(), 'harness', emptyPage, filled(), allFilled()).revealedOnly).toEqual([]);
    });

    it('get a column of their own in the table and a word in the score line', () => {
      const score = scoreSample(sample(), 'harness', emptyPage, filled(), allFilled(), reached);
      const table = renderAccuracyTable([score]);
      expect(table).toContain('| 应填 | 填对 | 填对率 | 代答后才填 | 错填 |');
      expect(table).toContain('| ats/s | 电脑 | harness | 3 | 3 | 100% | 2 | 0 |');
      expect(scoreLine(score)).toContain('3/3 = 100% (2 only once the held-back steps were shown)');
      expect(scoreLine(scoreSample(sample(), 'harness', emptyPage, filled(), allFilled()))).not.toContain('held-back');
    });
  });

  it('prints a table line that counts unexpected changes as wrong', () => {
    const score = scoreSample(sample(), 'harness', emptyPage, filled({ snapshot: { 'text#other': 'x' } }), report());
    expect(scoreLine(score)).toContain('ats/s (harness): 3/3 = 100%, wrong 1, missing 0 (0 known), false reports 3, left empty 0/0, wrong guesses 0');
  });
});

describe('a report that says something else than the page', () => {
  it('counts a right value reported as failed, as what happened on one real page', () => {
    const r = report([
      { label: 'Email', outcome: 'action_failed', value: 'a@b.example' },
      { label: 'Phone', outcome: 'filled', observed: '0412345678' },
      { label: 'Resume', outcome: 'filled', observed: 'cv.pdf' },
    ]);
    const score = scoreSample(sample(), 'harness', emptyPage, filled(), r);
    expect(score.correct).toBe(3);
    expect(score.falselyFailed).toEqual(['Email: reported action_failed']);
    expect(scoreProblems(score, expected()).join()).toMatch(/false report Email: reported action_failed/);
  });

  it('counts a right value with no report row at all', () => {
    const r = report([
      { label: 'Phone', outcome: 'filled', observed: '0412345678' },
      { label: 'Resume', outcome: 'filled', observed: 'cv.pdf' },
    ]);
    expect(problems(expected(), filled(), r).join()).toMatch(/false report Email: no report row/);
  });

  it('finds the row by field key when the label on the page reads differently', () => {
    const e = expected({ fields: { 'Email address': { selector: '#email', expect: 'a@b.example', fieldKey: 'contact.email' } } });
    const after: Inspection = { ...filled(), readings: { 'Email address': 'a@b.example' }, coverage: { 'Email address': ['text#email'] } };
    const before: Inspection = { ...emptyPage, snapshot: { ...filled().snapshot } };
    const r = report([{ label: 'E-mail *', fieldKey: 'contact.email', outcome: 'filled', observed: 'a@b.example' }]);
    expect(scoreSample(sample(e), 'harness', before, after, r).falselyFailed).toEqual([]);
  });

  describe('a list that takes several, holding only the answers it offers', () => {
    const partial = expected({ fields: { ...expected().fields, Email: { selector: '#email', expect: 'a@b.example', partial: true } } });
    const rowsWith = (outcome: FieldReport['outcome']) =>
      report([
        { label: 'Email', outcome, observed: 'a@b.example' },
        { label: 'Phone', outcome: 'filled', observed: '0412345678' },
        { label: 'Resume', outcome: 'filled', observed: 'cv.pdf' },
      ]);

    it('is right when it is reported for review, since the rest of the answers were not there', () => {
      const score = scoreSample(sample(partial), 'harness', emptyPage, filled(), rowsWith('needs_review'));
      expect(score.correct).toBe(3);
      expect(scoreProblems(score, partial)).toEqual([]);
    });

    it('is a false report when it says filled, as if every answer had been taken', () => {
      expect(scoreSample(sample(partial), 'harness', emptyPage, filled(), rowsWith('filled')).falselyFailed).toEqual(['Email: reported filled, not needs_review']);
    });
  });

  describe("a search with no row in the resume's words, holding the nearest one it offers", () => {
    const picked = expected({ fields: { ...expected().fields, Email: { selector: '#email', expect: 'a@b.example', picked: true } } });
    const rowsWith = (outcome: FieldReport['outcome']) =>
      report([
        { label: 'Email', outcome, observed: 'a@b.example' },
        { label: 'Phone', outcome: 'filled', observed: '0412345678' },
        { label: 'Resume', outcome: 'filled', observed: 'cv.pdf' },
      ]);

    it('is right when it is reported for review, so the applicant checks the name the site picked', () => {
      const score = scoreSample(sample(picked), 'harness', emptyPage, filled(), rowsWith('needs_review'));
      expect(score.correct).toBe(3);
      expect(scoreProblems(score, picked)).toEqual([]);
    });

    it("is a false report when it says filled, as if the resume's own words were there", () => {
      expect(scoreSample(sample(picked), 'harness', emptyPage, filled(), rowsWith('filled')).falselyFailed).toEqual(['Email: reported filled, not needs_review']);
    });
  });

  it('does not call a wrong value a false report: the report is right to fail it', () => {
    const r = report([
      { label: 'Email', outcome: 'action_failed' },
      { label: 'Phone', outcome: 'filled', observed: '0412345678' },
      { label: 'Resume', outcome: 'filled', observed: 'cv.pdf' },
    ]);
    const score = scoreSample(sample(), 'harness', emptyPage, filled({ readings: { Email: 'x@y.example' } }), r);
    expect(score.falselyFailed).toEqual([]);
    expect(score.wrong.map((w) => w.label)).toEqual(['Email']);
  });
});

describe('controls that should stay empty', () => {
  const withEmpty = expected({ __leaveEmpty: { 'Why us?': { selector: '#why', reason: 'nothing in a resume answers it' } } });
  const page = (after: unknown): Inspection => {
    const base = filled();
    return { ...base, readings: { ...base.readings, 'Why us?': after as string } };
  };
  const before: Inspection = { ...emptyPage, readings: { ...emptyPage.readings, 'Why us?': '' } };
  const run = (after: Inspection, r: FillReport) => scoreSample(sample(withEmpty), 'harness', before, after, r);

  it('count as right when they did not change and were not reported filled', () => {
    const score = run(page(''), allFilled([{ label: 'Why us?', outcome: 'unmatched' }]));
    expect(score.leaveEmpty).toBe(1);
    expect(score.touched).toEqual([]);
    expect(scoreProblems(score, withEmpty)).toEqual([]);
    expect(scoreLine(score)).toContain('left empty 1/1');
  });

  it('fail when they changed', () => {
    const score = run(page('Because'), allFilled());
    expect(score.touched).toEqual(['Why us?']);
    expect(scoreProblems(score, withEmpty).join()).toMatch(/should stay empty: Why us\?/);
    expect(scoreLine(score)).toContain('left empty 0/1');
  });

  it('fail when the report says it filled them, even if the reader saw nothing', () => {
    const score = run(page(''), allFilled([{ label: 'Why us?', outcome: 'filled', observed: 'x' }]));
    expect(score.touched).toEqual(['Why us?']);
  });

  it('keep a value the page already held', () => {
    const held: Inspection = { ...before, readings: { ...before.readings, 'Why us?': 'Australia' } };
    const score = scoreSample(sample(withEmpty), 'harness', held, page('Australia'), allFilled());
    expect(score.touched).toEqual([]);
  });
});

describe('a control the engine takes for something it is not', () => {
  const e = (over: Partial<CapturedExpected> = {}) =>
    expected({
      __leaveEmpty: {
        'Why us?': { selector: '#why', reason: 'r' },
        Portfolio: { selector: '#portfolio', reason: 'the resume has none', fieldKey: 'contact.portfolio' },
      },
      __wrongGuessesMax: 1,
      ...over,
    });
  const run = (extra: Partial<FieldReport>[], ex = e()) => scoreSample(sample(ex), 'harness', emptyPage, filled(), allFilled(extra));

  it('counts a field key on a control that has no such field', () => {
    const score = run([{ label: 'Why us?', fieldKey: 'diversity.veteran', outcome: 'needs_review' }]);
    expect(score.wrongGuesses).toEqual(['Why us?: diversity.veteran']);
    expect(scoreProblems(score, e())).toEqual([]);
  });

  it('does not count the right field with nothing to fill it, or no key at all', () => {
    const score = run([
      { label: 'Portfolio', fieldKey: 'contact.portfolio', outcome: 'no_data' },
      { label: 'Why us?', fieldKey: null, outcome: 'unmatched' },
    ]);
    expect(score.wrongGuesses).toEqual([]);
  });

  it('forces the allowance to move with the count, in both directions', () => {
    const none = run([]);
    expect(scoreProblems(none, e()).join()).toMatch(/wrong guesses: 0, but __wrongGuessesMax is 1/);
    const two = run([{ label: 'Why us?', fieldKey: 'a.b', outcome: 'needs_review' }, { label: 'Portfolio', fieldKey: 'a.c', outcome: 'needs_review' }]);
    expect(scoreProblems(two, e()).join()).toMatch(/wrong guesses: 2, but __wrongGuessesMax is 1/);
  });

  it('counts it on a known gap too', () => {
    const ex = expected({ __knownGaps: { City: { selector: '#city', expect: 'Brisbane', reason: 'r' } }, __knownGapsMax: 1, __wrongGuessesMax: 1 });
    const score = scoreSample(sample(ex), 'harness', emptyPage, filled(), allFilled([{ label: 'City', fieldKey: 'diversity.veteran', outcome: 'needs_review' }]));
    expect(score.wrongGuesses).toEqual(['City: diversity.veteran']);
  });
});

describe('every control gets a verdict', () => {
  const e = expected({
    __review: { Source: { selector: '#source', labelRe: 'source' } },
    __knownGaps: { City: { selector: '#city', expect: 'Brisbane', reason: 'r' } },
    __knownGapsMax: 1,
    __leaveEmpty: { Why: { selector: '#why', reason: 'r' } },
  });

  it('collects the selector of every verdict', () => {
    expect(verdictSelectors(e).sort()).toEqual(['#city', '#email', '#phone', '#resume', '#source', '#why']);
  });

  it('leaves out a field on an entry the fill adds, which the page before the fill does not have', () => {
    const added = expected({
      fields: { 'Company 2': { selector: '#company-2', expect: 'Acme', added: true } },
      __review: { 'Dates 2': { selector: '#dates-2', labelRe: 'dates', added: true } },
    });
    expect(verdictSelectors(added)).toEqual([]);
  });

  it('uses the control of a field that only checks what the site shows afterwards', () => {
    const shown = expected({ fields: { Resume: { selector: '.uploaded', exists: true, control: '#resume' } } });
    expect(verdictSelectors(shown)).toEqual(['#resume']);
  });

  it('leaves out a field on an entry the fill adds, which the page before the fill does not have', () => {
    const later = expected({
      fields: {
        Email: { selector: '#email', expect: 'a@b.example' },
        'School, second entry': { selector: '.entry:nth-child(2) input', expect: 'Example University', added: true },
      },
    });
    expect(verdictSelectors(later)).toEqual(['#email']);
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

  it('replays a sample on the device and locale it was captured with', () => {
    write('moka/phone/meta.json', { url: 'https://x.example/m', device: 'mobile', locale: 'zh-CN' });
    write('moka/phone/expected.json', expected());
    write('lever/old/meta.json', { url: 'https://x.example/o' });
    write('lever/old/expected.json', expected());
    const byName = Object.fromEntries(listSamples(root).map((s) => [s.name, s]));
    expect(byName.phone).toMatchObject({ device: 'mobile', locale: 'zh-CN' });
    // Captures from before the device was recorded were all desktop, in en-AU.
    expect(byName.old).toMatchObject({ device: 'desktop', locale: 'en-AU' });
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

describe('scoreSample, entries saved into a list', () => {
  const __entries = { Education: { selector: '.saved', section: 'education', shows: [['Later Uni', 'July 2024'], ['Earlier Uni']] } };
  const fieldsNone = { fields: {}, __entries };
  const page = (saved: string[]): Inspection => ({ ...emptyPage, readings: { Education: saved } });
  const score = (saved: string[], rows: Partial<FieldReport>[] = []) =>
    scoreSample({ ats: 'x', name: 'y', expected: expected(fieldsNone) }, 'harness', emptyPage, page(saved), report(rows));

  it('counts every text an entry has to show', () => {
    const s = score(['School Later Uni Period July 2024', 'School Earlier Uni']);
    expect([s.fields, s.correct]).toEqual([3, 3]);
    expect(scoreProblems(s, expected(fieldsNone))).toEqual([]);
  });

  it('calls an entry that never appeared missing', () => {
    const s = score(['School Later Uni Period July 2024']);
    expect(s.correct).toBe(2);
    expect(s.missing).toEqual(['Education 2: Earlier Uni']);
  });

  it('calls text in the wrong entry wrong, so the order on the page counts', () => {
    const s = score(['School Earlier Uni', 'School Later Uni Period July 2024']);
    expect(s.wrong.map((w) => w.label)).toEqual(['Education 1: Later Uni', 'Education 1: July 2024', 'Education 2: Earlier Uni']);
  });

  it('calls an entry too many wrong, because a run must not add duplicates', () => {
    const s = score(['Later Uni July 2024', 'Earlier Uni', 'Earlier Uni']);
    expect(s.wrong.map((w) => w.label)).toEqual(['Education: 3 entries, expected 2']);
  });

  it('calls a failed section row a false report when the entries are all there', () => {
    const s = score(['Later Uni July 2024', 'Earlier Uni'], [{ fieldId: 'section:education', label: 'Update', outcome: 'action_failed' }]);
    expect(s.falselyFailed).toEqual(['section:education: reported action_failed']);
  });

  it('leaves the failure of another section to that section', () => {
    const s = score(['Later Uni July 2024', 'Earlier Uni'], [{ fieldId: 'section:work', label: 'Update', outcome: 'action_failed' }]);
    expect(s.falselyFailed).toEqual([]);
  });

  it('says nothing about a section row on a sample with no entries', () => {
    const s = scoreSample({ ats: 'x', name: 'y', expected: expected() }, 'harness', emptyPage, emptyPage, report([{ fieldId: 'section:work', label: 'Add', outcome: 'action_failed' }]));
    expect(s.falselyFailed).toEqual([]);
  });
});
