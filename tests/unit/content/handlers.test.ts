import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createFrameHandlers } from '../../../src/content/handlers';
import { idFor } from '../../../src/content/ids';
import { clearHighlights } from '../../../src/fill/highlight';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;
const files = createSampleFiles();

function mount() {
  document.body.innerHTML = `<form>
    <h2>基本信息</h2>
    <div><label for="nm">姓名</label><input id="nm">
      <label for="vc">验证码</label><input id="vc">
      <label for="zz">加急程度</label><select id="zz">
        <option value="">请选择</option><option value="a">Alpha</option><option value="b">Beta</option><option value="b2">beta </option>
      </select></div>
  </form>`;
}

const outline = (id: string) => (document.getElementById(id) as HTMLElement).style.outline;

let discard: Mock<() => void>;
let idle: Mock<() => void>;
const make = () => createFrameHandlers({ doc: document, idFor, discardOwnWrites: discard, onIdle: idle });

beforeEach(() => {
  mount();
  discard = vi.fn<() => void>();
  idle = vi.fn<() => void>();
});
afterEach(() => {
  clearHighlights();
  document.body.innerHTML = '';
});

describe('ids', () => {
  it('idFor is stable per element and distinct between elements', () => {
    const a = document.getElementById('nm')!;
    const b = document.getElementById('vc')!;
    expect(idFor(a)).toBe(idFor(a));
    expect(idFor(a)).not.toBe(idFor(b));
  });
});

describe('fill', () => {
  it('fills, highlights, keeps controls and reports; ids match a later scan', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    expect((document.getElementById('nm') as HTMLInputElement).value).toBe('林知远');
    expect(outline('nm')).toBe('2px solid #22c55e');
    expect(outline('vc')).toBe('3px solid #ef4444'); // unmatched
    const nm = report.fields.find((f) => f.label === '姓名')!;
    expect(nm.fieldId).toBe(idFor(document.getElementById('nm')!));
    expect(discard).toHaveBeenCalled(); // watcher is told about our own highlight writes
    expect(idle).toHaveBeenCalledTimes(1);
    expect(h.isBusy()).toBe(false);
  });

  it('is busy while running and joins a concurrent request instead of running twice', async () => {
    const runFill = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return {
        report: { url: '', startedAt: 0, finishedAt: 0, fields: [], counts: {} as never },
        controls: new Map(),
        growth: [],
      };
    });
    const h = createFrameHandlers({ doc: document, idFor, runFill, onIdle: idle });
    const first = h.fill({ resume: zh, files });
    expect(h.isBusy()).toBe(true);
    const second = h.fill({ resume: zh, files });
    expect(second).toBe(first);
    await first;
    expect(runFill).toHaveBeenCalledTimes(1);
    expect(h.isBusy()).toBe(false);
  });

  it('clears the outlines of a previous run before the next one', async () => {
    let calls = 0;
    const empty = { report: { url: '', startedAt: 0, finishedAt: 0, fields: [], counts: {} as never }, controls: new Map(), growth: [] };
    const real = make();
    await real.fill({ resume: zh, files });
    expect(outline('nm')).not.toBe('');
    const h = createFrameHandlers({ doc: document, idFor, runFill: async () => (calls++, empty) });
    await h.fill({ resume: zh, files });
    expect(calls).toBe(1);
    expect(outline('nm')).toBe('');
  });

  it('hands the fill a way to say it is still at work', async () => {
    const onProgress = vi.fn();
    const h = createFrameHandlers({ doc: document, idFor, onProgress });
    await h.fill({ resume: zh, files });
    expect(onProgress).toHaveBeenCalled();
  });

  it('releases the busy state when the run fails', async () => {
    const runFill = vi.fn().mockRejectedValue(new Error('boom'));
    const h = createFrameHandlers({ doc: document, idFor, runFill, onIdle: idle });
    await expect(h.fill({ resume: zh, files })).rejects.toThrow('boom');
    expect(h.isBusy()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });
});

describe('focus', () => {
  it('scrolls the control of the last run into view; unknown ids are ignored', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    const scroll = vi.fn();
    (document.getElementById('nm') as HTMLElement).scrollIntoView = scroll;
    expect(h.focus(report.fields.find((f) => f.label === '姓名')!.fieldId)).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(h.focus('c99999')).toBe(false);
  });

  it('does nothing before any fill', () => {
    expect(make().focus('c1')).toBe(false);
  });
});

describe('apply', () => {
  it('text: writes the text, keeps label / fieldKey / section, re-highlights green', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    const row = report.fields.find((f) => f.label === '验证码')!;
    expect(row.outcome).toBe('unmatched');

    const updated = await h.apply({ fieldId: row.fieldId, text: '8841' });

    expect((document.getElementById('vc') as HTMLInputElement).value).toBe('8841');
    expect(updated).toMatchObject({ fieldId: row.fieldId, outcome: 'filled', label: '验证码', value: '8841', observed: '8841' });
    expect(updated.fieldKey).toBe(row.fieldKey);
    expect(updated.section).toBe(row.section);
    expect(updated.confidence).toBe(row.confidence);
    expect(outline('vc')).toBe('2px solid #22c55e');
    expect(idle).toHaveBeenCalledTimes(2); // after fill and after apply
  });

  it('optionLabel: picks the option whose normalized label equals it', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    const row = report.fields.find((f) => f.label === '加急程度')!;

    const updated = await h.apply({ fieldId: row.fieldId, optionLabel: ' alpha' });

    expect((document.getElementById('zz') as HTMLSelectElement).value).toBe('a');
    expect(updated).toMatchObject({ outcome: 'filled', label: '加急程度', value: ' alpha' });
  });

  it('optionLabel: ambiguous labels are never picked (needs_review), unknown ones are no_option', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    const row = report.fields.find((f) => f.label === '加急程度')!;

    const ambiguous = await h.apply({ fieldId: row.fieldId, optionLabel: 'Beta' });
    expect(ambiguous.outcome).toBe('needs_review');
    expect((document.getElementById('zz') as HTMLSelectElement).value).toBe('');
    expect(outline('zz')).toBe('2px dashed #eab308');

    const none = await h.apply({ fieldId: row.fieldId, optionLabel: 'Gamma' });
    expect(none.outcome).toBe('no_option');
  });

  it('answers no_control for unknown or detached controls', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    const row = report.fields.find((f) => f.label === '验证码')!;
    expect((await h.apply({ fieldId: 'c424242', text: 'x' })).outcome).toBe('no_control');
    document.getElementById('vc')!.remove();
    expect(await h.apply({ fieldId: row.fieldId, text: 'x' })).toMatchObject({ outcome: 'no_control', label: '验证码' });
  });

  it('answers action_failed when neither text nor optionLabel is given', async () => {
    const h = make();
    const report = await h.fill({ resume: zh, files });
    const row = report.fields.find((f) => f.label === '验证码')!;
    expect((await h.apply({ fieldId: row.fieldId })).outcome).toBe('action_failed');
  });

  it('waits for a running fill before applying', async () => {
    const h = make();
    const filling = h.fill({ resume: zh, files });
    const applied = h.apply({ fieldId: idFor(document.getElementById('vc')!), text: 'late' });
    await filling;
    expect((await applied).outcome).toBe('filled');
    expect((document.getElementById('vc') as HTMLInputElement).value).toBe('late');
  });
});
