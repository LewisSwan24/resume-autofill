// @vitest-environment node
// A phone capture of a page has to fill at least 90% of what the desktop capture of the same page fills.
import { describe, expect, it } from 'vitest';
import type { FillReport } from '../../../src/engine/types';
import {
  blocksAcceptance,
  phoneShortfalls,
  renderAccuracyTable,
  scoreSample,
  type CapturedExpected,
  type Inspection,
  type SampleScore,
} from '../../../tests/shared/capturedExpectations';

const report: FillReport = {
  url: 'https://x.example',
  startedAt: 0,
  finishedAt: 0,
  fields: [],
  counts: { filled: 0, needs_review: 0, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
};

const page: Inspection = { snapshot: {}, readings: {}, coverage: {} };
const expected: CapturedExpected = { __resume: 'en-AU', __knownGapsMax: 0, fields: {} };

/** A row of `correct` out of `total`, as the scorer would write it. */
function row(name: string, device: 'desktop' | 'mobile', correct: number, total: number, over: Partial<SampleScore> = {}): SampleScore {
  const base = scoreSample({ ats: 'ats', name, expected, device, url: 'https://jobs.example/apply/1' }, 'harness', page, page, report);
  return { ...base, fields: total, correct, ...over };
}

const tableRows = (table: string): string[] => table.split('\n').filter((l) => l.startsWith('| ats/'));

describe('scoreSample', () => {
  it('carries the device and page of the sample', () => {
    const score = scoreSample({ ats: 'ats', name: 'p', expected, device: 'mobile', url: 'https://jobs.example/apply/1' }, 'harness', page, page, report);
    expect(score.device).toBe('mobile');
    expect(score.url).toBe('https://jobs.example/apply/1');
  });

  it('takes a sample without a device as desktop', () => {
    expect(scoreSample({ ats: 'ats', name: 'p', expected }, 'harness', page, page, report).device).toBe('desktop');
  });
});

describe('phoneShortfalls', () => {
  it('flags a phone page at 80% of desktop', () => {
    const out = phoneShortfalls([row('desk', 'desktop', 10, 10), row('phone', 'mobile', 8, 10)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ desktop: 'ats/desk', phone: 'ats/phone', mode: 'harness', ratio: 0.8, why: 'below' });
  });

  it('passes a phone page at exactly 90% of desktop', () => {
    expect(phoneShortfalls([row('desk', 'desktop', 10, 10), row('phone', 'mobile', 9, 10)])).toEqual([]);
  });

  it('counts known gaps against the phone, as the fill rate does', () => {
    const phone = row('phone', 'mobile', 8, 8, { gaps: ['a', 'b'] });
    expect(phoneShortfalls([row('desk', 'desktop', 10, 10), phone])).toHaveLength(1);
  });

  it('pairs a phone capture whose url differs from the desktop one only in query or fragment', () => {
    const phone = row('phone', 'mobile', 2, 10, { url: 'https://Jobs.example/apply/1/?src=m#form' });
    expect(phoneShortfalls([row('desk', 'desktop', 10, 10), phone])).toMatchObject([{ phone: 'ats/phone', why: 'below' }]);
  });

  it('pairs a phone capture Moka moved under /m/ with the desktop capture of the same page', () => {
    const desk = row('desk', 'desktop', 10, 10, { url: 'https://app.mokahr.com/careers/acme/1#/job/a/apply' });
    const phone = row('phone', 'mobile', 2, 10, { url: 'https://app.mokahr.com/m/careers/acme/1#/micro-resume/a' });
    expect(phoneShortfalls([desk, phone])).toMatchObject([{ phone: 'ats/phone', desktop: 'ats/desk', why: 'below' }]);
    // Only a whole first segment: /mobile/ or /m-site/ is some other page.
    const other = row('phone', 'mobile', 2, 10, { url: 'https://app.mokahr.com/mobile/careers/acme/1' });
    expect(phoneShortfalls([desk, other])).toMatchObject([{ why: 'no_desktop' }]);
  });

  it('pairs a phone capture Feishu moved to /m/ after its portal segment with the desktop capture of the same page', () => {
    const desk = row('desk', 'desktop', 10, 10, { url: 'https://acme.jobs.feishu.cn/campus/resume/77/apply' });
    const phone = row('phone', 'mobile', 2, 10, { url: 'https://acme.jobs.feishu.cn/campus/m/resume/77/apply?jobId=77' });
    expect(phoneShortfalls([desk, phone])).toMatchObject([{ phone: 'ats/phone', desktop: 'ats/desk', why: 'below' }]);
    // Another company's site on Feishu is another page.
    const elsewhere = row('phone', 'mobile', 2, 10, { url: 'https://other.jobs.feishu.cn/campus/m/resume/77/apply' });
    expect(phoneShortfalls([desk, elsewhere])).toMatchObject([{ why: 'no_desktop' }]);
  });

  it('keeps /m/ in the page of a site Moka does not run, where it can be another page', () => {
    const desk = row('desk', 'desktop', 10, 10, { url: 'https://jobs.example/careers/acme/1' });
    const phone = row('phone', 'mobile', 2, 10, { url: 'https://jobs.example/m/careers/acme/1' });
    expect(phoneShortfalls([desk, phone])).toMatchObject([{ phone: 'ats/phone', desktop: null, why: 'no_desktop' }]);
    // Nor a host that only ends in the same letters.
    const lookalike = row('phone', 'mobile', 2, 10, { url: 'https://notmokahr.com/m/careers/acme/1' });
    const itsDesk = row('desk', 'desktop', 10, 10, { url: 'https://notmokahr.com/careers/acme/1' });
    expect(phoneShortfalls([itsDesk, lookalike])).toMatchObject([{ why: 'no_desktop' }]);
  });

  it('flags a phone capture with no desktop capture of its page, since the rule cannot be checked', () => {
    const elsewhere = row('desk', 'desktop', 10, 10, { url: 'https://jobs.example/apply/2' });
    expect(phoneShortfalls([elsewhere, row('phone', 'mobile', 10, 10)])).toMatchObject([{ phone: 'ats/phone', desktop: null, why: 'no_desktop' }]);
    // A desktop run in the other mode is not a partner either.
    const other = row('desk', 'desktop', 10, 10, { mode: 'extension' });
    expect(phoneShortfalls([other, row('phone', 'mobile', 10, 10)])).toMatchObject([{ why: 'no_desktop' }]);
  });

  it('flags a phone capture whose page has several desktop captures, rather than pick one', () => {
    const rows = [row('step-1', 'desktop', 10, 10), row('step-2', 'desktop', 5, 10), row('phone', 'mobile', 10, 10)];
    expect(phoneShortfalls(rows)).toMatchObject([{ phone: 'ats/phone', why: 'several_desktops' }]);
  });

  it('lets a phone capture with no desktop capture of its page pass, listed, while a low or ambiguous one fails', () => {
    const lone = phoneShortfalls([row('phone', 'mobile', 10, 10)]);
    expect(lone).toMatchObject([{ why: 'no_desktop' }]);
    expect(lone.filter(blocksAcceptance)).toEqual([]);
    const low = phoneShortfalls([row('desk', 'desktop', 10, 10), row('phone', 'mobile', 5, 10)]);
    expect(low.filter(blocksAcceptance)).toHaveLength(1);
    const several = phoneShortfalls([row('step-1', 'desktop', 10, 10), row('step-2', 'desktop', 5, 10), row('phone', 'mobile', 10, 10)]);
    expect(several.filter(blocksAcceptance)).toHaveLength(1);
  });

  it('has nothing to say about desktop captures alone', () => {
    expect(phoneShortfalls([row('desk', 'desktop', 1, 10)])).toEqual([]);
  });

  it('reads rows written before the device was recorded as desktop', () => {
    const old = row('desk', 'desktop', 10, 10) as Partial<SampleScore>;
    delete old.device;
    expect(phoneShortfalls([old as SampleScore, row('phone', 'mobile', 5, 10)])).toHaveLength(1);
  });
});

describe('renderAccuracyTable', () => {
  it('keeps every capture as its own row, the phone one right under the desktop one of its page', () => {
    const touched = { missing: ['a', 'b'], touched: ['Cover letter', 'Salary'], falselyFilled: ['Notes'] } as Partial<SampleScore>;
    const table = renderAccuracyTable([row('phone', 'mobile', 8, 10, touched), row('desk', 'desktop', 10, 10), row('zz', 'desktop', 7, 10, { url: 'https://jobs.example/apply/9' })]);
    expect(table).toContain('| 样本 | 设备 | 运行方式 |');
    expect(table).toContain('| 手机填对率 | 手机/电脑 |');
    const lines = tableRows(table);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\| ats\/desk \| 电脑 \| harness \| 10 \| 10 \| 100% \|.* \| 80% \| 80% \|$/);
    // The phone row shows its own details: 1 false report, 2 touched fields.
    expect(lines[1]).toMatch(/^\| ats\/phone \| 手机 \| harness \| 10 \| 8 \| 80% \| 0 \| 0 \| 2 \| 0 \| 1 \| 0 \| 2 \|.* \| 80% \| 80% \|$/);
    expect(lines[2]).toMatch(/^\| ats\/zz \| 电脑 \|.* \| — \| — \|$/);
  });

  it('never folds away a second desktop capture of the same page', () => {
    const lines = tableRows(renderAccuracyTable([row('step-1', 'desktop', 10, 10), row('step-2', 'desktop', 6, 10, { wrong: [{ label: 'x' }] as SampleScore['wrong'] })]));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^\| ats\/step-2 \| 电脑 \| harness \| 10 \| 6 \| 60% \| 0 \| 1 \|/);
  });

  it('shows the worst phone on the desktop row when a page has several', () => {
    const lines = tableRows(renderAccuracyTable([row('desk', 'desktop', 10, 10), row('phone-a', 'mobile', 10, 10), row('phone-b', 'mobile', 3, 10)]));
    expect(lines[0]).toMatch(/^\| ats\/desk \|.* \| 30% \| 30% \|$/);
    expect(lines[1]).toMatch(/^\| ats\/phone-a \|.* \| 100% \| 100% \|$/);
    expect(lines[2]).toMatch(/^\| ats\/phone-b \|.* \| 30% \| 30% \|$/);
  });

  it('says why a phone row has no ratio', () => {
    const lines = tableRows(renderAccuracyTable([row('phone', 'mobile', 9, 10)]));
    expect(lines[0]).toMatch(/^\| ats\/phone \| 手机 \| harness \| 10 \| 9 \| 90% \|.* \| 90% \| 无电脑版 \|$/);
  });
});
