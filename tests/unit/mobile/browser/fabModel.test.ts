import { describe, expect, it } from 'vitest';
import { countOutcomes } from '../../../../src/fill/report';
import type { FieldReport } from '../../../../src/engine/types';
import { fabModel, joinA11y, type FabInput } from '../../../../mobile/app/src/browser/model/fabModel';
import type { FrameEntry } from '../../../../mobile/app/src/browser/model/frames';
import type { RunState } from '../../../../mobile/app/src/browser/model/fillRun';

const frame = (over: Partial<FrameEntry> = {}): FrameEntry => ({
  frame: 0, origin: 'https://jobs.example.com', main: true, count: 0, iframes: 0, incompatible: false, scanned: true, ...over,
});
const input = (over: Partial<FabInput> = {}): FabInput => ({ engine: 'ready', frames: [frame()], run: { phase: 'idle' }, settling: false, ...over });
const fields: FieldReport[] = [
  { fieldId: 'c1', label: '姓名', fieldKey: null, section: null, outcome: 'filled', confidence: 1 },
  { fieldId: 'c2', label: '邮箱', fieldKey: null, section: null, outcome: 'filled', confidence: 1 },
  { fieldId: 'c3', label: '学历', fieldKey: null, section: null, outcome: 'needs_review', confidence: 0.6 },
  { fieldId: 'c4', label: '身高', fieldKey: null, section: null, outcome: 'no_data', confidence: 1 },
];
const done = (over: Partial<Extract<RunState, { phase: 'done' }>> = {}): RunState => ({
  phase: 'done',
  runId: 'r',
  report: { url: '', startedAt: 0, finishedAt: 0, fields, counts: countOutcomes(fields) },
  frames: [0],
  handedOver: { fields: [], wholeSections: [], files: [], total: 0, otherSites: [] },
  countAtFill: 12,
  framesAtFill: 1,
  undo: null,
  unanswered: 0,
  fallback: false,
  sample: false,
  ...over,
});

describe('fabModel', () => {
  it('hidden until the main frame checks in', () => {
    expect(fabModel(input({ frames: [] }))).toBeNull();
    expect(fabModel(input({ frames: [frame({ main: false })] }))).toBeNull();
  });

  it('scanning: main frame in, no scan yet', () => {
    const v = fabModel(input({ frames: [frame({ scanned: false })] }))!;
    expect(v).toMatchObject({ state: 'scanning', icon: 'magic', text: { key: 'fab.autofill' }, subtext: { key: 'm.br.fab.scanning' }, tap: 'fill' });
    expect(v.a11y).toEqual([{ key: 'fab.autofill' }, { key: 'm.br.fab.scanning' }]);
  });

  it('scanning: nothing found yet within 8 s after load', () => {
    expect(fabModel(input({ settling: true }))!.state).toBe('scanning');
  });

  it('ready: the sum of the frames scan counts', () => {
    const v = fabModel(input({ frames: [frame({ count: 9 }), frame({ frame: 2, main: false, count: 3 })] }))!;
    expect(v).toMatchObject({ state: 'ready', icon: 'magic', text: { key: 'fab.autofill' }, subtext: { key: 'm.br.fab.count', params: { n: 12 } }, tap: 'fill' });
    expect(v.a11y).toEqual([{ key: 'm.br.fab.a11y', params: { n: 12 } }]);
  });

  it('none: every checked-in frame reports 0 after the settling time', () => {
    expect(fabModel(input())).toMatchObject({ state: 'none', subtext: { key: 'm.br.fab.none' }, tap: 'fill' });
  });

  it('filling: spinner, part i of total when more than one frame', () => {
    expect(fabModel(input({ run: { phase: 'asking', runId: 'r' } }))).toMatchObject({ state: 'filling', icon: 'busy', text: { key: 'fab.filling' }, subtext: null });
    expect(fabModel(input({ run: { phase: 'filling', runId: 'r', index: 2, total: 3 } }))).toMatchObject({
      state: 'filling',
      subtext: { key: 'm.br.fab.part', params: { i: 2, total: 3 } },
    });
    expect(fabModel(input({ run: { phase: 'filling', runId: 'r', index: 1, total: 1 } }))!.subtext).toBeNull();
  });

  it('done: report icon, filled and review counts, tap opens the report', () => {
    const v = fabModel(input({ frames: [frame({ count: 12 })], run: done() }))!;
    expect(v).toMatchObject({ state: 'done', icon: 'report', text: { key: 'm.br.fab.report' }, subtext: { key: 'm.br.fab.reportSub', params: { filled: 2, review: 1 } }, tap: 'report' });
  });

  it('after undo the FAB offers the fill again (the report stays on the toolbar), not a report of values now gone', () => {
    const v = fabModel(input({ frames: [frame({ count: 12 })], run: done({ undo: { restored: ['0:a'], manual: [], addedCards: 0 } }) }))!;
    expect(v).toMatchObject({ state: 'ready', icon: 'magic', subtext: { key: 'm.br.fab.count', params: { n: 12 } }, tap: 'fill' });
  });

  it('more: a scan count rises after done', () => {
    const v = fabModel(input({ frames: [frame({ count: 15 })], run: done() }))!;
    expect(v).toMatchObject({ state: 'more', icon: 'magic', text: { key: 'm.br.fab.more' }, subtext: { key: 'm.br.fab.moreSub', params: { n: 3 } }, tap: 'fill' });
  });

  it('more: a new frame checks in after done', () => {
    const v = fabModel(input({ frames: [frame({ count: 12 }), frame({ frame: 4, main: false, count: 0 })], run: done() }))!;
    expect(v.state).toBe('more');
  });

  it('unavailable and missing', () => {
    expect(fabModel(input({ engine: 'unsupported', frames: [] }))).toMatchObject({ state: 'unavailable', icon: 'warning', text: { key: 'm.br.fab.unavailable' }, subtext: null, tap: 'explainUnsupported' });
    expect(fabModel(input({ engine: 'missing', frames: [] }))).toMatchObject({ state: 'missing', icon: 'warning', text: { key: 'm.br.fab.missing' }, tap: 'explainMissing' });
  });

  it('a failed run falls back to the scan states', () => {
    expect(fabModel(input({ frames: [frame({ count: 4 })], run: { phase: 'failed', code: 'no_frames' } }))!.state).toBe('ready');
  });
});

describe('joinA11y', () => {
  it('joins Chinese with a full-width comma and English with ", "', () => {
    expect(joinA11y(['一键填写', '正在识别表单'])).toBe('一键填写，正在识别表单');
    expect(joinA11y(['Fill in one tap', 'Looking for the form'])).toBe('Fill in one tap, Looking for the form');
    expect(joinA11y(['Only one'])).toBe('Only one');
  });
});
