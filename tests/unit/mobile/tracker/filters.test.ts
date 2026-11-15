// The list's status filter, search and sort, and Home's two sections.
import { describe, expect, it } from 'vitest';
import { ApplicationRecordSchema, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { countByStatus, filterRecords, homeSections, matchesQuery } from '../../../../mobile/app/src/tracker/model/filters';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-15T04:00:00Z'); // 12:00 in Shanghai

const rec = (o: Partial<ApplicationRecord> & { id: string }): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    url: `https://jobs.example.com/${o.id}`,
    host: 'jobs.example.com',
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    ...o,
  });

const ids = (list: readonly ApplicationRecord[]) => list.map((r) => r.id);
const nav = (o: Partial<Parameters<typeof filterRecords>[1]> = {}) => ({ filter: 'all' as const, query: '', sort: 'opened' as const, ...o });

const records = [
  rec({ id: 'a', status: 'wish', company: '示例科技', openedAt: 50 }),
  rec({ id: 'b', status: 'filling', company: '示例银行', position: '产品经理', openedAt: 40 }),
  rec({ id: 'c', status: 'submitted', host: 'careers.example.org', url: 'https://careers.example.org/c', openedAt: 30 }),
  rec({ id: 'd', status: 'interview', title: '示例集团 2027 校招', openedAt: 20 }),
  rec({ id: 'e', status: 'closed', notes: '笔试没过', openedAt: 10 }),
];

describe('filters', () => {
  it('each status filter', () => {
    expect(ids(filterRecords(records, nav(), NOW, SH))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(filterRecords(records, nav({ filter: 'wish' }), NOW, SH))).toEqual(['a']);
    expect(ids(filterRecords(records, nav({ filter: 'filling' }), NOW, SH))).toEqual(['b']);
    expect(ids(filterRecords(records, nav({ filter: 'submitted' }), NOW, SH))).toEqual(['c']);
    expect(ids(filterRecords(records, nav({ filter: 'interview' }), NOW, SH))).toEqual(['d']);
    expect(ids(filterRecords(records, nav({ filter: 'closed' }), NOW, SH))).toEqual(['e']);
  });

  it('counts per status ignore the query', () => {
    expect(countByStatus(records)).toEqual({ all: 5, wish: 1, filling: 1, submitted: 1, interview: 1, closed: 1 });
    expect(countByStatus([])).toEqual({ all: 0, wish: 0, filling: 0, submitted: 0, interview: 0, closed: 0 });
  });

  it('search covers company, position, host, title and notes, all terms must match', () => {
    expect(ids(filterRecords(records, nav({ query: '示例科技' }), NOW, SH))).toEqual(['a']);
    expect(ids(filterRecords(records, nav({ query: '产品' }), NOW, SH))).toEqual(['b']);
    expect(ids(filterRecords(records, nav({ query: 'example.org' }), NOW, SH))).toEqual(['c']);
    expect(ids(filterRecords(records, nav({ query: '校招' }), NOW, SH))).toEqual(['d']);
    expect(ids(filterRecords(records, nav({ query: '笔试' }), NOW, SH))).toEqual(['e']);
    expect(ids(filterRecords(records, nav({ query: '示例银行  产品' }), NOW, SH))).toEqual(['b']);
    expect(ids(filterRecords(records, nav({ query: '示例银行 笔试' }), NOW, SH))).toEqual([]);
    expect(ids(filterRecords(records, nav({ query: '示例', filter: 'wish' }), NOW, SH))).toEqual(['a']);
    expect(ids(filterRecords(records, nav({ query: '   ' }), NOW, SH))).toHaveLength(5);
  });

  it('full-width letters match', () => {
    const r = rec({ id: 'x', company: 'Example Corp' });
    expect(matchesQuery(r, 'ＥＸＡＭＰＬＥ')).toBe(true);
    expect(matchesQuery(rec({ id: 'y', company: 'ＡＢＣ公司' }), 'abc')).toBe(true);
  });

  it('sort by opened', () => {
    const shuffled = [records[2]!, records[0]!, records[4]!, records[1]!, records[3]!];
    expect(ids(filterRecords(shuffled, nav(), NOW, SH))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sort by deadline: upcoming soonest first, then passed, then none', () => {
    const list = [
      rec({ id: 'none-old', openedAt: 1 }),
      rec({ id: 'passed-long', deadline: { date: '2026-11-01' }, openedAt: 9 }),
      rec({ id: 'later', deadline: { date: '2026-12-01' }, openedAt: 8 }),
      rec({ id: 'none-new', openedAt: 7 }),
      rec({ id: 'today', deadline: { date: '2026-11-15', time: '18:00' }, openedAt: 6 }),
      rec({ id: 'passed-recent', deadline: { date: '2026-11-15', time: '09:00' }, openedAt: 5 }),
      rec({ id: 'tomorrow', deadline: { date: '2026-11-16' }, openedAt: 4 }),
    ];
    expect(ids(filterRecords(list, nav({ sort: 'deadline' }), NOW, SH))).toEqual([
      'today',
      'tomorrow',
      'later',
      'passed-recent',
      'passed-long',
      'none-new',
      'none-old',
    ]);
  });

  it('Home sections: ≤ 3 each, 14-day window, only 想投/填写中, no record twice', () => {
    const list = [
      rec({ id: 'd1', status: 'filling', deadline: { date: '2026-11-20' }, openedAt: 100 }),
      rec({ id: 'd2', status: 'wish', deadline: { date: '2026-11-16' }, openedAt: 90 }),
      rec({ id: 'd3', status: 'wish', deadline: { date: '2026-11-29' }, openedAt: 80 }),
      rec({ id: 'd4', status: 'filling', deadline: { date: '2026-11-25' }, openedAt: 70 }),
      rec({ id: 'far', status: 'filling', deadline: { date: '2026-11-30' }, openedAt: 60 }),
      rec({ id: 'gone', status: 'filling', deadline: { date: '2026-11-14' }, openedAt: 50 }),
      rec({ id: 'sub', status: 'submitted', deadline: { date: '2026-11-16' }, openedAt: 45 }),
      rec({ id: 'f1', status: 'filling', openedAt: 40 }),
      rec({ id: 'f2', status: 'filling', openedAt: 30 }),
      rec({ id: 'f3', status: 'filling', openedAt: 20 }),
    ];
    const s = homeSections(list, NOW, SH);
    expect(ids(s.dueSoon)).toEqual(['d2', 'd1', 'd4']);
    expect(ids(s.inProgress)).toEqual(['far', 'gone', 'f1']);
    expect(s.total).toBe(10);
    expect(homeSections([], NOW, SH)).toEqual({ dueSoon: [], inProgress: [], total: 0 });
  });
});
