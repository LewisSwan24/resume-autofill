// @vitest-environment node
// The triage says why each control on a sample page was or was not filled; the work list for new fields reads it.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { renderAccuracyTable, scoreSample, type CapturedExpected, type Inspection } from '../../../tests/shared/capturedExpectations';
import {
  coverageOf,
  recordTriage,
  renderTriage,
  triageCounts,
  triageSample,
  untaggedEntries,
  type TriageRow,
} from '../../../tests/shared/coverageTriage';

const report = (fields: Partial<FieldReport>[]): FillReport => ({
  url: 'https://x.example',
  startedAt: 0,
  finishedAt: 0,
  fields: fields as FieldReport[],
  counts: { filled: 0, needs_review: 0, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
});

const expected: CapturedExpected = {
  __resume: 'en-AU',
  __knownGapsMax: 1,
  fields: {
    Email: { selector: '#email', expect: 'a@b.example', fieldKey: 'contact.email' },
    Phone: { selector: '#phone', expect: '0412345678' },
  },
  __review: { Salary: { selector: '#salary', labelRe: 'salary expectations' } },
  __knownGaps: { School: { selector: '#school', reason: 'search service', fieldKey: 'education.school' } },
  __leaveEmpty: {
    'Privacy consent': { selector: '#consent', reason: 'consent', triage: 'keep' },
    'Security clearance': { selector: '#clear', reason: 'screening', triage: 'no_field' },
    'Which of our offices': { selector: '#office', reason: 'the company’s', triage: 'site_own' },
    'Portfolio URL': { selector: '#portfolio', reason: 'the sample has none', fieldKey: 'contact.portfolio' },
    'Willing to relocate': { selector: '#relocate', reason: 'not recognised', fieldKey: 'jobIntention.acceptRelocation' },
    'Work rights': { selector: '#rights', reason: 'no option fits', fieldKey: 'workRights.hasFullWorkRights' },
  },
  __pageOwn: { 'Edit count': { selector: '#count', reason: 'the page counts edits' } },
};

const page = (readings: Inspection['readings']): Inspection => ({ snapshot: {}, readings, coverage: {} });
const before = page({});
const after = page({ Email: 'a@b.example', Phone: '' });

const fillReport = report([
  { label: 'Email', fieldKey: 'contact.email', outcome: 'filled', observed: 'a@b.example' },
  { label: 'Phone number', fieldKey: 'contact.phone', outcome: 'no_data' },
  { label: 'What are your salary expectations?', fieldKey: 'jobIntention.salaryMin', outcome: 'needs_review' },
  { label: 'School', fieldKey: 'education.school', outcome: 'action_failed' },
  { label: 'Privacy consent *', fieldKey: null, outcome: 'unmatched' },
  { label: 'Security clearance held?', fieldKey: null, outcome: 'unmatched' },
  { label: 'Which of our offices could you work from?', fieldKey: null, outcome: 'unmatched' },
  { label: 'Portfolio URL', fieldKey: 'contact.portfolio', outcome: 'no_data' },
  { label: 'Willing to relocate?', fieldKey: null, outcome: 'unmatched' },
  { label: 'Work rights in Australia', fieldKey: 'workRights.hasFullWorkRights', outcome: 'no_option' },
  { label: 'Edit count', fieldKey: null, outcome: 'unmatched' },
  { label: 'Favourite colour', fieldKey: null, outcome: 'unmatched' },
]);

const rows = (): TriageRow[] => {
  const score = scoreSample({ ats: 'ats', name: 's', expected }, 'harness', before, after, fillReport);
  return triageSample({ ats: 'ats', name: 's', expected }, score, fillReport);
};
const triageOf = (label: string): string | undefined => rows().find((r) => r.label === label)?.triage;

describe('triageSample', () => {
  it('gives every judged control one category', () => {
    expect(rows().filter((r) => r.kind !== 'orphan').map((r) => [r.label, r.triage])).toEqual([
      ['Email', 'filled'],
      ['Phone', 'missing'],
      ['Salary', 'needs_review'],
      ['School', 'no_driver'],
      ['Privacy consent', 'keep'],
      ['Security clearance', 'no_field'],
      ['Which of our offices', 'site_own'],
      ['Portfolio URL', 'no_value'],
      ['Willing to relocate', 'no_dictionary'],
      ['Work rights', 'no_driver'],
    ]);
  });

  it('carries the report outcome of each control, and none for a control with no row', () => {
    const noRow = report(fillReport.fields.filter((f) => !/relocate/.test(f.label)));
    const score = scoreSample({ ats: 'ats', name: 's', expected }, 'harness', before, after, noRow);
    const out = triageSample({ ats: 'ats', name: 's', expected }, score, noRow);
    expect(out.find((r) => r.label === 'Willing to relocate')).toMatchObject({ triage: 'no_dictionary', outcome: 'none' });
    expect(out.find((r) => r.label === 'Work rights')).toMatchObject({ outcome: 'no_option', fieldKey: 'workRights.hasFullWorkRights' });
  });

  it('calls a recognised field the resume has no value for no_value, even when it was also asked about', () => {
    expect(triageOf('Portfolio URL')).toBe('no_value');
  });

  it('takes a tag over the report when an entry has both, as for an answer the applicant gave before', () => {
    const e: CapturedExpected = {
      ...expected,
      __leaveEmpty: { 'Portfolio URL': { selector: '#portfolio', reason: 'their own answer', fieldKey: 'contact.portfolio', triage: 'keep' } },
    };
    const score = scoreSample({ ats: 'ats', name: 's', expected: e }, 'harness', before, after, fillReport);
    expect(triageSample({ ats: 'ats', name: 's', expected: e }, score, fillReport).find((r) => r.label === 'Portfolio URL')?.triage).toBe('keep');
  });

  it('lists an unfilled report row that no expected entry covers as an orphan, but not a page-own box', () => {
    const orphans = rows().filter((r) => r.kind === 'orphan');
    expect(orphans.map((r) => r.label)).toEqual(['Favourite colour']);
    expect(orphans[0]).toMatchObject({ triage: 'orphan', outcome: 'unmatched' });
  });

  it('does not take another control’s row of the same field when the entry’s own label has one', () => {
    const e: CapturedExpected = {
      ...expected,
      __leaveEmpty: { 'Second email': { selector: '#email2', reason: 'a copy box', fieldKey: 'contact.email' } },
    };
    const r = report([...fillReport.fields, { label: 'Second email', fieldKey: null, outcome: 'unmatched' }]);
    const score = scoreSample({ ats: 'ats', name: 's', expected: e }, 'harness', before, after, r);
    expect(triageSample({ ats: 'ats', name: 's', expected: e }, score, r).find((x) => x.label === 'Second email')).toMatchObject({
      outcome: 'unmatched',
      triage: 'no_dictionary',
    });
  });

  it('sorts an uncovered row that names a field by its outcome, as on a card the fill added', () => {
    const r = report([...fillReport.fields, { label: 'Project link', fieldKey: 'projects.link', outcome: 'no_data' }]);
    const score = scoreSample({ ats: 'ats', name: 's', expected }, 'harness', before, after, r);
    expect(triageSample({ ats: 'ats', name: 's', expected }, score, r).find((x) => x.label === 'Project link')).toMatchObject({
      kind: 'orphan',
      triage: 'no_value',
      fieldKey: 'projects.link',
    });
  });

  it('takes the rows an entry names by labelRe when the page words it otherwise', () => {
    const e: CapturedExpected = {
      ...expected,
      __leaveEmpty: { ...expected.__leaveEmpty, 'Colour question': { selector: '#c', reason: 'the company’s', triage: 'site_own', labelRe: '^favourite colour$' } },
    };
    const score = scoreSample({ ats: 'ats', name: 's', expected: e }, 'harness', before, after, fillReport);
    const out = triageSample({ ats: 'ats', name: 's', expected: e }, score, fillReport);
    expect(out.find((x) => x.label === 'Colour question')).toMatchObject({ triage: 'site_own', outcome: 'unmatched' });
    expect(out.filter((x) => x.kind === 'orphan')).toEqual([]);
  });

  it('marks a leave-empty entry with no field key and no tag as untagged', () => {
    const e: CapturedExpected = { ...expected, __leaveEmpty: { Notes: { selector: '#n', reason: 'why' } } };
    const score = scoreSample({ ats: 'ats', name: 's', expected: e }, 'harness', before, after, fillReport);
    expect(triageSample({ ats: 'ats', name: 's', expected: e }, score, fillReport).find((r) => r.label === 'Notes')?.triage).toBe('untagged');
    expect(untaggedEntries(e)).toEqual(['Notes']);
    expect(untaggedEntries(expected)).toEqual([]);
  });
});

describe('coverage', () => {
  it('counts categories and leaves deliberate and site-own controls out of what can be answered', () => {
    const counts = triageCounts(rows());
    expect(counts).toMatchObject({ filled: 1, missing: 1, keep: 1, site_own: 1, no_field: 1, orphan: 1 });
    // 10 judged controls, minus keep and site_own: 8 answerable, 1 filled. Still to win: no_field, no_value, no_dictionary and two no_driver.
    expect(coverageOf(counts)).toEqual({ controls: 10, answerable: 8, rate: 12.5, actionable: 5 });
  });

  it('adds coverage to the accuracy table, and a dash for a row recorded before triage', () => {
    const score = scoreSample({ ats: 'ats', name: 's', expected }, 'harness', before, after, fillReport);
    const withTriage = { ...score, triage: triageCounts(rows()) };
    const table = renderAccuracyTable([withTriage, { ...score, sample: 'ats/old' }]);
    expect(table).toContain('| 页面栏位 | 可答 | 覆盖率 | 可补 | 未识别 | 简历没有 |');
    const line = (name: string) => table.split('\n').find((l) => l.startsWith(`| ${name} |`))!;
    expect(line('ats/s')).toMatch(/\| 10 \| 8 \| 12\.5% \| 5 \| 0 \| 0 \|/);
    expect(line('ats/old')).toMatch(/\| — \| — \| — \| — \| 0 \| 0 \|/);
  });
});

describe('renderTriage', () => {
  const other = (label: string, triage: TriageRow['triage'], sample = 'ats/t'): TriageRow => ({ sample, label, kind: 'leaveEmpty', triage, outcome: 'unmatched' });

  it('totals each category and lists what is not filled by how many samples ask it, most first', () => {
    const md = renderTriage([
      ...rows(),
      other('Security clearance', 'no_field', 'ats/t'),
      other('security  CLEARANCE', 'no_field', 'ats/u'),
      other('Notes', 'untagged'),
    ]);
    expect(md).toMatch(/\| 已填 \| 1 \|/);
    expect(md).toMatch(/\| 缺字段 \| 3 \|/);
    const list = md.split('## 工作清单')[1]!.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| 题目') && !l.startsWith('|---'));
    expect(list[0]).toMatch(/^\| Security clearance \| 3 \| 缺字段 \| unmatched \|/);
    // Filled and deliberately empty controls are not work.
    expect(list.join('\n')).not.toMatch(/\| Email \||Privacy consent/);
    expect(md).toMatch(/未归类.*Favourite colour/s);
    expect(md).toMatch(/未标.*Notes/s);
  });
});

describe('recordTriage', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('replaces a sample’s rows and keeps the others', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'triage-'));
    const file = path.join(dir, 'triage.json');
    recordTriage('ats/a', [{ sample: 'ats/a', label: 'x', kind: 'field', triage: 'filled', outcome: 'filled' }], file);
    recordTriage('ats/b', [{ sample: 'ats/b', label: 'y', kind: 'field', triage: 'filled', outcome: 'filled' }], file);
    recordTriage('ats/a', [{ sample: 'ats/a', label: 'z', kind: 'field', triage: 'missing', outcome: 'none' }], file);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as TriageRow[];
    expect(saved.map((r) => r.label).sort()).toEqual(['y', 'z']);
  });
});
