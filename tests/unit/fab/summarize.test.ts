import { describe, expect, it } from 'vitest';
import { summarize } from '../../../entrypoints/fab.content/summarize';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';

const OUTCOMES: Outcome[] = ['filled', 'needs_review', 'unmatched', 'no_data', 'no_control', 'no_option', 'action_failed'];

function field(fieldId: string, outcome: Outcome, extra: Partial<FieldReport> = {}): FieldReport {
  return { fieldId, label: `label-${fieldId}`, fieldKey: null, section: null, outcome, confidence: 0.5, ...extra };
}

function report(fields: FieldReport[]): FillReport {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const f of fields) counts[f.outcome]++;
  return { url: 'https://example.test/', startedAt: 0, finishedAt: 1, fields, counts };
}

describe('summarize', () => {
  it('returns zero counts, no groups and no entries for an empty report', () => {
    expect(summarize(report([]))).toEqual({ filled: 0, review: 0, unrecognized: 0, noData: 0, groups: [], entries: [] });
  });

  it('groups outcomes: review = needs_review + no_option, unrecognized = unmatched + action_failed', () => {
    const s = summarize(
      report([
        field('a', 'filled'),
        field('b', 'filled'),
        field('c', 'needs_review'),
        field('d', 'no_option'),
        field('e', 'unmatched'),
        field('f', 'action_failed'),
        field('g', 'no_data'),
      ]),
    );
    expect(s).toMatchObject({ filled: 2, review: 2, unrecognized: 2, noData: 1 });
  });

  it('lists every field not filled in four groups by reason, in this order, page order within a group', () => {
    const s = summarize(
      report([
        field('1', 'no_data'),
        field('2', 'filled'),
        field('3', 'unmatched'),
        field('4', 'no_option'),
        field('5', 'needs_review'),
        field('6', 'action_failed'),
        field('7', 'needs_review'),
        field('8', 'no_data'),
      ]),
    );
    expect(s.groups.map((g) => [g.id, g.items.map((i) => i.fieldId)])).toEqual([
      ['review', ['5', '7']],
      ['no_option', ['4']],
      ['failed', ['3', '6']],
      ['nodata', ['1', '8']],
    ]);
  });

  it('leaves out empty groups, and a card the page already held (its entry says so)', () => {
    const s = summarize(report([field('a', 'filled'), field('b', 'no_data', { note: 'entry_held' }), field('c', 'no_option')]));
    expect(s.groups.map((g) => g.id)).toEqual(['no_option']);
    expect(s.noData).toBe(1);
  });

  it('carries label, frame id, section and entry; a missing frame id defaults to the top frame (0)', () => {
    const s = summarize(
      report([
        field('x', 'needs_review', { label: '  学校  ', frameId: 3, section: 'education', entry: 1 }),
        field('y', 'unmatched', { label: '' }),
      ]),
    );
    expect(s.groups.flatMap((g) => g.items)).toEqual([
      { fieldId: 'x', frameId: 3, label: '学校', outcome: 'needs_review', section: 'education', entry: 1 },
      { fieldId: 'y', frameId: 0, label: '', outcome: 'unmatched', section: null },
    ]);
  });

  it('ignores no_control (the control vanished; nothing the user can act on)', () => {
    const s = summarize(report([field('z', 'no_control'), field('w', 'filled')]));
    expect(s).toEqual({ filled: 1, review: 0, unrecognized: 0, noData: 0, groups: [], entries: [] });
  });

  it('counts from the field list, not from the (possibly stale) counts record', () => {
    const r = report([field('a', 'filled')]);
    r.counts.filled = 99;
    expect(summarize(r).filled).toBe(1);
  });

  it('shows the site’s option a search box picked under another name, and never the value written or its path', () => {
    const s = summarize(
      report([
        field('a', 'needs_review', {
          note: 'picked_other_name',
          value: '星河示例理工大学',
          observed: '星河理工',
          source: 'education[0].school',
        }),
        field('b', 'needs_review', { value: 'secret', observed: 'secret2', source: 'basics.email' }),
      ]),
    );
    const [picked, plain] = s.groups[0]!.items;
    expect(picked).toMatchObject({ note: 'picked_other_name', picked: '星河理工' });
    expect(Object.keys(plain!).sort()).toEqual(['fieldId', 'frameId', 'label', 'outcome', 'section']);
    expect(JSON.stringify(s)).not.toContain('星河示例理工大学');
    expect(JSON.stringify(s)).not.toContain('secret');
  });
});

describe('summarize – entries of repeated sections', () => {
  const edu = (fieldId: string, outcome: Outcome, entry: number) => field(fieldId, outcome, { section: 'education', entry });

  it('counts each entry’s fields by outcome, in the report’s entry order', () => {
    const r = report([
      edu('s1', 'filled', 0),
      edu('m1', 'filled', 0),
      edu('r1', 'needs_review', 0),
      edu('g1', 'no_data', 0),
      edu('s2', 'filled', 1),
      edu('g2', 'no_data', 1),
      edu('x2', 'unmatched', 1),
      field('w1', 'filled', { section: 'internship', entry: 0 }),
    ]);
    r.entries = [
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'added', label: '云岭示例大学' },
      { section: 'internship', index: 0, state: 'added' },
      { section: 'internship', index: 1, state: 'skipped', reason: 'add_failed', button: '添加实习经历' },
    ];
    expect(summarize(r).entries).toEqual([
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学', filled: 2, review: 1, failed: 0, noData: 1 },
      { section: 'education', index: 1, state: 'added', label: '云岭示例大学', filled: 1, review: 0, failed: 1, noData: 1 },
      { section: 'internship', index: 0, state: 'added', filled: 1, review: 0, failed: 0, noData: 0 },
      { section: 'internship', index: 1, state: 'skipped', reason: 'add_failed', button: '添加实习经历', filled: 0, review: 0, failed: 0, noData: 0 },
    ]);
  });

  it('does not count a held card’s fields as missing from the resume', () => {
    const r = report([field('s1', 'no_data', { section: 'education', entry: 0, note: 'entry_held' })]);
    r.entries = [{ section: 'education', index: 0, state: 'held' }];
    expect(summarize(r).entries[0]).toMatchObject({ state: 'held', noData: 0 });
  });

  it('puts a sensitive field held back by the settings in the review group, marked so the card can say it was not written', () => {
    const s = summarize(report([field('id', 'needs_review', { fieldKey: 'basics.idNumber', note: 'sensitive_held' }), field('n', 'needs_review')]));
    expect(s.groups.map((g) => g.id)).toEqual(['review']);
    expect(s.groups[0]!.items.map((i) => [i.fieldId, i.note])).toEqual([['id', 'sensitive_held'], ['n', undefined]]);
  });
});

describe('summarize – the first field with no data', () => {
  it('is the first no_data field, in page order, that names a resume field', () => {
    const s = summarize(
      report([
        field('a', 'filled', { fieldKey: 'contact.email' }),
        field('b', 'no_data'), // no field key: nowhere to send the user
        field('c', 'no_data', { fieldKey: 'education.gpa', source: 'education[1].gpa' }),
        field('d', 'no_data', { fieldKey: 'contact.wechat' }),
      ]),
    );
    expect(s.firstMissing).toEqual({ fieldKey: 'education.gpa', source: 'education[1].gpa' });
  });

  it('is absent when no field with data missing names a resume field', () => {
    expect(summarize(report([field('a', 'filled'), field('b', 'no_data')])).firstMissing).toBeUndefined();
    expect(summarize(report([field('a', 'filled', { fieldKey: 'contact.email' })])).firstMissing).toBeUndefined();
  });

  it('carries a path into the resume, never a value', () => {
    const s = summarize(report([field('a', 'no_data', { fieldKey: 'contact.email', value: 'secret' })]));
    expect(s.firstMissing).toEqual({ fieldKey: 'contact.email' });
  });
});
