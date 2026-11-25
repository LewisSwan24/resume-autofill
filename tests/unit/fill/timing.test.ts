// Where a fill's time goes: each row says how long its box took, and the report how long each phase took (adding
// cards, scanning and planning, waiting for an upload to be read, the boxes, entry editors). Frames add up.
import { afterEach, describe, expect, it } from 'vitest';
import { mergeFrameReports } from '../../../src/background/merge';
import { idFor } from '../../../src/content/ids';
import type { FillReport } from '../../../src/engine/types';
import { clearHighlights } from '../../../src/fill/highlight';
import { addTimings, countOutcomes, emptyTiming } from '../../../src/fill/report';
import { runFill } from '../../../src/fill/runFill';
import { createSampleFiles, createSampleProfile, type Resume } from '../../../src/schema';

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')! as Resume;

afterEach(() => {
  clearHighlights();
  document.body.innerHTML = '';
});

describe('fill timing', () => {
  it('a run says how long each phase and each box took', async () => {
    document.body.innerHTML = `<form><h2>基本信息</h2>
      <div><label for="nm">姓名</label><input id="nm"></div>
      <div><label for="em">邮箱</label><input id="em"></div></form>`;
    const { report } = await runFill(document, { resume: zh, files: createSampleFiles() }, { idFor });
    expect(Object.keys(report.timing ?? {}).sort()).toEqual(['cards', 'editors', 'scan', 'steps', 'uploadWait']);
    for (const ms of Object.values(report.timing!)) expect(ms).toBeGreaterThanOrEqual(0);
    const filled = report.fields.filter((f) => f.outcome === 'filled');
    expect(filled).toHaveLength(2);
    for (const f of filled) expect(f.ms).toBeGreaterThanOrEqual(0);
  });

  it('frames add up, and a frame from an older build without timing counts as nothing', () => {
    const report = (timing?: FillReport['timing']): FillReport => ({
      url: 'u', startedAt: 1, finishedAt: 2, fields: [], counts: countOutcomes([]), ...(timing ? { timing } : {}),
    });
    const a = { ...emptyTiming(), cards: 100, steps: 50 };
    const b = { ...emptyTiming(), steps: 25, uploadWait: 7 };
    expect(addTimings(a, b)).toEqual({ cards: 100, scan: 0, uploadWait: 7, steps: 75, editors: 0 });
    const merged = mergeFrameReports([{ frameId: 0, report: report(a) }, { frameId: 3, report: report(b) }, { frameId: 4, report: report() }]);
    expect(merged.timing).toEqual({ cards: 100, scan: 0, uploadWait: 7, steps: 75, editors: 0 });
  });
});
