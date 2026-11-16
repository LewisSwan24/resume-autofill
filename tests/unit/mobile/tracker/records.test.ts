// Application records in AppState v2: the pure reducers.
import { describe, expect, it } from 'vitest';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';
import {
  ApplicationRecordSchema,
  defaultAppState,
  type AppState,
  type ApplicationRecord,
  type FillEntry,
} from '../../../../mobile/app/src/store/appStateStore';
import {
  addManual,
  deleteRecord,
  displayName,
  editRecord,
  isUntouched,
  markFillUndone,
  mergeImported,
  prune,
  recordFill,
  recordKey,
  restoreRecord,
  setDeadline,
  setRemind,
  setStatus,
  upsertOnOpen,
  updateRecordTitle,
} from '../../../../mobile/app/src/tracker/model/records';

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

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

// Not validated, so a test can hold more than the 500 the schema allows.
const withRecords = (records: ApplicationRecord[], o: Partial<AppState> = {}): AppState => ({ ...defaultAppState(o), applications: records });

const entry = (at: number, o: Partial<FillEntry> = {}): FillEntry => ({ at, filled: 3, attention: 1, skipped: 0, undone: false, ...o });

describe('records', () => {
  it('recordKey drops the fragment; displayName falls back to the host', () => {
    expect(recordKey('https://a.example.com/x?y=1#z')).toBe('https://a.example.com/x?y=1');
    expect(displayName(rec({ id: 'a', company: '示例科技' }))).toBe('示例科技');
    expect(displayName(rec({ id: 'a', company: '' }))).toBe('jobs.example.com');
  });

  it('opening a new link adds a 想投 record on top with a guessed company', () => {
    const next = ids();
    let r = upsertOnOpen(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com' }, 100, next);
    expect(r.id).toBe('id1');
    r = upsertOnOpen(r.state, { url: 'https://jobs.example.com/2', host: 'jobs.example.com', title: '示例科技校园招聘' }, 200, next);
    expect(r.id).toBe('id2');
    const [top, second] = r.state.applications;
    expect(top).toMatchObject({
      id: 'id2',
      status: 'wish',
      company: '示例科技',
      companyGuessed: true,
      title: '示例科技校园招聘',
      createdAt: 200,
      openedAt: 200,
      updatedAt: 200,
      statusAt: 200,
      history: [],
      remind: false,
    });
    expect(second!.id).toBe('id1');
    expect(ApplicationRecordSchema.parse(top)).toEqual(top);
  });

  it('opening a listed link keeps its id, takes the new fragment and moves it to the top', () => {
    const next = ids();
    let s = upsertOnOpen(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com', title: '旧标题' }, 1, next).state;
    s = upsertOnOpen(s, { url: 'https://b.example.com/2', host: 'b.example.com' }, 2, next).state;
    const r = upsertOnOpen(s, { url: 'https://a.example.com/1#step2', host: 'a.example.com' }, 3, next);
    expect(r.id).toBe('id1');
    expect(r.state.applications.map((a) => a.id)).toEqual(['id1', 'id2']);
    expect(r.state.applications[0]).toMatchObject({ url: 'https://a.example.com/1#step2', openedAt: 3, updatedAt: 3, createdAt: 1, title: '旧标题' });
  });

  it('a title fills in only when given', () => {
    const next = ids();
    let s = upsertOnOpen(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com' }, 1, next).state;
    expect(s.applications[0]!.title).toBeUndefined();
    s = upsertOnOpen(s, { url: 'https://a.example.com/1', host: 'a.example.com', title: '示例科技招聘' }, 2, next).state;
    expect(s.applications[0]).toMatchObject({ title: '示例科技招聘', company: '示例科技' });
    s = upsertOnOpen(s, { url: 'https://a.example.com/1', host: 'a.example.com' }, 3, next).state;
    expect(s.applications[0]!.title).toBe('示例科技招聘');
  });

  it('demo and non-http links are not recorded', () => {
    const s = defaultAppState();
    for (const url of [DEMO_URL, 'javascript:alert(1)', 'file:///sdcard/a.html', 'not a url']) {
      const r = upsertOnOpen(s, { url, host: 'x' }, 1);
      expect(r).toEqual({ state: s, id: null });
      expect(r.state).toBe(s);
    }
  });

  it('more than 30 untouched records drop the oldest untouched, never a worked-on one', () => {
    const worked = rec({ id: 'worked', openedAt: 0, notes: '要准备作品集' });
    let s = withRecords([worked]);
    const next = ids();
    for (let i = 1; i <= 32; i += 1) s = upsertOnOpen(s, { url: `https://a.example.com/${i}`, host: 'a.example.com' }, i, next).state;
    expect(s.applications.filter(isUntouched)).toHaveLength(30);
    expect(s.applications.map((r) => r.id)).toContain('worked');
    expect(s.applications.map((r) => r.url)).not.toContain('https://a.example.com/1');
    expect(s.applications.map((r) => r.url)).not.toContain('https://a.example.com/2');
    expect(s.applications.at(-1)!.id).toBe('worked');
  });

  it('isUntouched: any status, fill, deadline, notes, edited company or position counts as worked on', () => {
    expect(isUntouched(rec({ id: 'a' }))).toBe(true);
    expect(isUntouched(rec({ id: 'a', status: 'closed' }))).toBe(false);
    expect(isUntouched(rec({ id: 'a', history: [entry(1)] }))).toBe(false);
    expect(isUntouched(rec({ id: 'a', deadline: { date: '2026-11-20' } }))).toBe(false);
    expect(isUntouched(rec({ id: 'a', notes: 'x' }))).toBe(false);
    expect(isUntouched(rec({ id: 'a', companyGuessed: false }))).toBe(false);
    expect(isUntouched(rec({ id: 'a', position: '产品经理' }))).toBe(false);
  });

  it('past 500 the oldest 结束 record goes first', () => {
    const records: ApplicationRecord[] = [];
    for (let i = 501; i >= 1; i -= 1) records.push(rec({ id: `r${i}`, openedAt: i, notes: 'n', status: i === 300 || i === 200 ? 'closed' : 'wish' }));
    let s = prune(withRecords(records.slice()));
    expect(s.applications).toHaveLength(500);
    expect(s.applications.map((r) => r.id)).not.toContain('r200');
    expect(s.applications.map((r) => r.id)).toContain('r300');
    expect(s.applications.map((r) => r.id)).toContain('r1');
    // no 结束 left: the oldest record goes
    const plain = Array.from({ length: 501 }, (_, i) => rec({ id: `p${501 - i}`, openedAt: 501 - i, notes: 'n' }));
    s = prune(withRecords(plain));
    expect(s.applications.map((r) => r.id)).not.toContain('p1');
    expect(s.applications).toHaveLength(500);
  });

  it('a page title refreshes a guessed company but not an edited one', () => {
    const s = withRecords([rec({ id: 'a', company: '', companyGuessed: true }), rec({ id: 'b', company: '我的公司', companyGuessed: false })]);
    const a = updateRecordTitle(s, 'a', '示例科技校园招聘', 'jobs.example.com');
    expect(a.applications[0]).toMatchObject({ title: '示例科技校园招聘', company: '示例科技', openedAt: 1 });
    const b = updateRecordTitle(s, 'b', '示例科技校园招聘', 'jobs.example.com');
    expect(b.applications[1]).toMatchObject({ title: '示例科技校园招聘', company: '我的公司' });
    expect(b.applications.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('title rules: other site, about:blank, host-only titles are ignored', () => {
    const s = withRecords([rec({ id: 'a', title: '旧标题' })]);
    expect(updateRecordTitle(s, 'a', '别的网站', 'other.example.net')).toBe(s);
    expect(updateRecordTitle(s, 'a', 'about:blank', 'jobs.example.com')).toBe(s);
    expect(updateRecordTitle(s, 'a', 'jobs.example.com', 'jobs.example.com')).toBe(s);
    expect(updateRecordTitle(s, 'a', 'https://jobs.example.com/a', 'jobs.example.com')).toBe(s);
    expect(updateRecordTitle(s, 'a', '   ', 'jobs.example.com')).toBe(s);
    expect(updateRecordTitle(s, 'a', ' 旧标题 ', 'jobs.example.com')).toBe(s);
    expect(updateRecordTitle(s, 'nope', '新', 'jobs.example.com')).toBe(s);
    expect(updateRecordTitle(s, 'a', '新标题', 'login.jobs.example.com:443').applications[0]!.title).toBe('新标题');
  });

  it('editing company marks it not guessed; values are trimmed and cut', () => {
    const s = withRecords([rec({ id: 'a', company: '示例', companyGuessed: true })]);
    const e = editRecord(s, 'a', { company: '  示例科技 ' }, 50);
    expect(e.applications[0]).toMatchObject({ company: '示例科技', companyGuessed: false, updatedAt: 50 });
    const long = editRecord(s, 'a', { position: `${'岗'.repeat(79)}😀`, notes: 'n'.repeat(1200) }, 60);
    expect(long.applications[0]!.position).toBe('岗'.repeat(79));
    expect(long.applications[0]!.notes).toHaveLength(1000);
    expect(long.applications[0]!.companyGuessed).toBe(true);
    expect(editRecord(e, 'a', { company: '示例科技' }, 70)).toBe(e);
    expect(editRecord(s, 'a', { position: '  ' }, 70)).toBe(s);
    const cleared = editRecord(e, 'a', { company: '' }, 80);
    expect(cleared.applications[0]).toMatchObject({ company: '', companyGuessed: false });
  });

  it('status change stamps statusAt; same status is the same object', () => {
    const s = withRecords([rec({ id: 'a' })]);
    const n = setStatus(s, 'a', 'submitted', 9);
    expect(n.applications[0]).toMatchObject({ status: 'submitted', statusAt: 9, updatedAt: 9 });
    expect(setStatus(n, 'a', 'submitted', 10)).toBe(n);
  });

  it('the first deadline takes defaultOn; removing it turns the reminder off', () => {
    const s = withRecords([rec({ id: 'a' })], { reminders: { time: '09:00', dayBefore: true, dayOf: true, defaultOn: true } });
    const d = setDeadline(s, 'a', { date: '2026-11-20' }, 5);
    expect(d.applications[0]).toMatchObject({ deadline: { date: '2026-11-20' }, remind: true, updatedAt: 5 });
    const off = setRemind(d, 'a', false, 6);
    expect(off.applications[0]!.remind).toBe(false);
    const moved = setDeadline(off, 'a', { date: '2026-11-21', time: '18:00' }, 7);
    expect(moved.applications[0]).toMatchObject({ deadline: { date: '2026-11-21', time: '18:00' }, remind: false });
    const on = setRemind(moved, 'a', true, 8);
    const removed = setDeadline(on, 'a', null, 9);
    expect(removed.applications[0]!.deadline).toBeUndefined();
    expect(removed.applications[0]!.remind).toBe(false);
    const noDefault = setDeadline(withRecords([rec({ id: 'a' })]), 'a', { date: '2026-11-20' }, 5);
    expect(noDefault.applications[0]!.remind).toBe(false);
  });

  it('a fill moves 想投 to 填写中, keeps 已提交, keeps 20 entries', () => {
    const s = withRecords([rec({ id: 'a' }), rec({ id: 'b', status: 'submitted', statusAt: 3 })]);
    const f = recordFill(s, 'a', entry(100), 100);
    expect(f.applications[0]).toMatchObject({ status: 'filling', statusAt: 100, history: [entry(100)] });
    const g = recordFill(f, 'b', entry(101), 101);
    expect(g.applications[1]).toMatchObject({ status: 'submitted', statusAt: 3 });
    let many = f;
    for (let i = 0; i < 25; i += 1) many = recordFill(many, 'a', entry(200 + i), 200 + i);
    expect(many.applications[0]!.history).toHaveLength(20);
    expect(many.applications[0]!.history[0]!.at).toBe(224);
    expect(many.applications[0]!.status).toBe('filling');
  });

  it('undo marks the entry', () => {
    const s = recordFill(withRecords([rec({ id: 'a' })]), 'a', entry(100), 100);
    const u = markFillUndone(recordFill(s, 'a', entry(200), 200), 'a', 100);
    expect(u.applications[0]!.history.map((h) => [h.at, h.undone])).toEqual([
      [200, false],
      [100, true],
    ]);
  });

  it('delete and restore put the record back where it was', () => {
    const s = withRecords([rec({ id: 'a', openedAt: 3 }), rec({ id: 'b', openedAt: 2 }), rec({ id: 'c', openedAt: 1 })]);
    const d = deleteRecord(s, 'b');
    expect(d.state.applications.map((r) => r.id)).toEqual(['a', 'c']);
    expect(d.removed).toEqual({ record: s.applications[1], index: 1 });
    expect(restoreRecord(d.state, d.removed!).applications.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(deleteRecord(s, 'zzz')).toEqual({ state: s, removed: null });
  });

  it('restore is skipped when the link was opened again', () => {
    const s = withRecords([rec({ id: 'a', openedAt: 3 })]);
    const d = deleteRecord(s, 'a');
    const reopened = upsertOnOpen(d.state, { url: 'https://jobs.example.com/a#again', host: 'jobs.example.com' }, 10, () => 'new').state;
    expect(restoreRecord(reopened, d.removed!)).toBe(reopened);
  });

  it('addManual returns the existing record for a listed link', () => {
    const next = ids();
    const a = addManual(defaultAppState(), { url: 'https://jobs.example.com/x', host: 'jobs.example.com', company: '', position: '产品经理' }, 5, next);
    expect(a).toMatchObject({ id: 'id1', existed: false });
    expect(a.state.applications[0]).toMatchObject({ company: '', companyGuessed: true, position: '产品经理', status: 'wish', openedAt: 5 });
    const named = addManual(defaultAppState(), { url: 'https://jobs.example.com/y', host: 'jobs.example.com', company: '示例科技', position: '' }, 5, next);
    expect(named.state.applications[0]).toMatchObject({ company: '示例科技', companyGuessed: false });
    const again = addManual(a.state, { url: 'https://jobs.example.com/x#top', host: 'jobs.example.com', company: '别的', position: '' }, 6, next);
    expect(again).toEqual({ state: a.state, id: 'id1', existed: true });
  });

  it('merge import: newer wins, ids kept, histories merged, caps applied', () => {
    const mine = withRecords([
      rec({ id: 'm1', url: 'https://a.example.com/1', openedAt: 5, updatedAt: 5, company: '旧名', history: [entry(10), entry(5)] }),
      rec({ id: 'taken', url: 'https://b.example.com/2', openedAt: 4, updatedAt: 9, notes: '我的' }),
    ]);
    const incoming = [
      rec({ id: 'x1', url: 'https://a.example.com/1#f', openedAt: 8, updatedAt: 8, company: '新名', history: [entry(12), entry(10)] }),
      rec({ id: 'x2', url: 'https://b.example.com/2', openedAt: 3, updatedAt: 1, notes: '旧的' }),
      rec({ id: 'taken', url: 'https://c.example.com/3', openedAt: 6, updatedAt: 6 }),
      rec({ id: 'x4', url: 'https://d.example.com/4', openedAt: 1, updatedAt: 1 }),
    ];
    const r = mergeImported(mine, incoming, 'merge', () => 'fresh');
    expect(r).toMatchObject({ added: 2, updated: 1 });
    const byUrl = new Map(r.state.applications.map((a) => [recordKey(a.url), a]));
    expect(byUrl.get('https://a.example.com/1')).toMatchObject({ id: 'm1', company: '新名', openedAt: 8 });
    expect(byUrl.get('https://a.example.com/1')!.history.map((h) => h.at)).toEqual([12, 10, 5]);
    expect(byUrl.get('https://b.example.com/2')).toMatchObject({ id: 'taken', notes: '我的' });
    expect(byUrl.get('https://c.example.com/3')!.id).toBe('fresh');
    expect(byUrl.get('https://d.example.com/4')!.id).toBe('x4');
    expect(r.state.applications.map((a) => a.openedAt)).toEqual([8, 6, 4, 1]);
    // caps: 40 untouched incoming records keep 30
    const flood = Array.from({ length: 40 }, (_, i) => rec({ id: `f${i}`, url: `https://f.example.com/${i}`, openedAt: 100 + i, updatedAt: 100 + i }));
    expect(mergeImported(defaultAppState(), flood, 'merge').state.applications).toHaveLength(30);
  });

  it('an imported id the phone cannot pass to Android gets a new one, in merge and in replace', () => {
    const incoming = [
      rec({ id: 'a_1', url: 'https://a.example.com/1' }),
      rec({ id: 'x.y', url: 'https://b.example.com/2' }),
      rec({ id: 'ok-1', url: 'https://c.example.com/3' }),
    ];
    let n = 0;
    const fresh = () => `fresh-${(n += 1)}`;
    const merged = mergeImported(defaultAppState(), incoming, 'merge', fresh).state.applications.map((a) => a.id).sort();
    expect(merged).toEqual(['fresh-1', 'fresh-2', 'ok-1']);
    const replaced = mergeImported(defaultAppState(), incoming, 'replace', fresh).state.applications.map((a) => a.id).sort();
    expect(replaced).toEqual(['fresh-3', 'fresh-4', 'ok-1']);
  });

  it('replace import replaces', () => {
    const mine = withRecords([rec({ id: 'm1', notes: 'n' })]);
    const incoming = [rec({ id: 'x1', notes: 'a', openedAt: 2 }), rec({ id: 'x2', notes: 'b', openedAt: 3 })];
    const r = mergeImported(mine, incoming, 'replace');
    expect(r.state.applications.map((a) => a.id)).toEqual(['x2', 'x1']);
    expect(r.added).toBe(2);
  });
});
