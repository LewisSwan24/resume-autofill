// @vitest-environment node
// A step form in a replay is filled step by step, through the page's own Next, as auto-advance does.
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import type { FillReport } from '../../../src/engine/types';
import { fillThroughSteps, mergeReports } from '../../shared/stepFill';

const counts = (filled: number, needs_review = 0): FillReport['counts'] => ({ filled, needs_review, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 });
const report = (label: string, startedAt: number, finishedAt: number, filled = 1): FillReport => ({
  url: 'https://x.example',
  startedAt,
  finishedAt,
  fields: [{ label, outcome: 'filled' } as FillReport['fields'][number]],
  counts: counts(filled),
});

describe('mergeReports', () => {
  it('keeps every row, counts them and spans the whole run', () => {
    const merged = mergeReports([report('a', 10, 20, 1), report('b', 25, 40, 2)]);
    expect(merged.fields.map((f) => f.label)).toEqual(['a', 'b']);
    expect(merged.counts.filled).toBe(2);
    expect([merged.startedAt, merged.finishedAt]).toEqual([10, 40]);
  });

  it('counts a field a later pass reported again once, as that pass left it', () => {
    const row = (label: string, fieldKey: string, outcome: string) => ({ label, fieldKey, outcome }) as FillReport['fields'][number];
    const first: FillReport = { ...report('x', 0, 1), fields: [row('学历', 'education.degree', 'filled'), row('学历', 'education.degree', 'filled'), row('语言技能', 'skills.name', 'needs_review')], counts: counts(2, 1) };
    const again: FillReport = { ...report('x', 2, 3), fields: [row('语言技能', 'skills.name', 'needs_review'), row('邮箱', 'contact.email', 'filled')], counts: counts(1, 1) };
    const merged = mergeReports([first, again]);
    // Two entries of one pass are two rows; the same question asked again on a later pass is not a second one.
    expect(merged.fields.map((f) => f.label)).toEqual(['学历', '学历', '语言技能', '邮箱']);
    expect(merged.counts).toMatchObject({ filled: 3, needs_review: 1 });
  });
});

/** A page of `steps` steps whose Next moves on, unless `stuckAt` says the page refuses there. */
function stepPage(steps: number, opts: { stuckAt?: number; blockAt?: number; stepped?: boolean } = {}) {
  let at = 1;
  const pressed: number[] = [];
  const page = {
    waitForTimeout: async () => {},
    evaluate: async (fn: () => unknown) => {
      const src = String(fn);
      if (src.includes('readStep')) {
        return {
          stepped: opts.stepped ?? true,
          fingerprint: `step:${at}`,
          action: at < steps ? 'next' : 'final',
          blocker: at === opts.blockAt ? 'verification' : null,
        };
      }
      if (src.includes('pressNext')) {
        pressed.push(at);
        if (at !== opts.stuckAt) at++;
        return true;
      }
      throw new Error(`unexpected evaluate ${src}`);
    },
  } as unknown as Page;
  return { page, pressed, at: () => at };
}

const fast = { pollMs: 0, waitMs: 5, settleMs: 0, maxSteps: 15 };

describe('fillThroughSteps', () => {
  it('fills every step and stops at the last one without pressing it', async () => {
    const { page, pressed, at } = stepPage(3);
    const filled: number[] = [];
    const run = await fillThroughSteps(page, async () => (filled.push(at()), report(`step ${at()}`, at(), at())), fast);
    expect(filled).toEqual([1, 2, 3]);
    expect(pressed).toEqual([1, 2]);
    expect(run).toMatchObject({ steps: 2, stop: 'final' });
    expect(run.report.fields).toHaveLength(3);
  });

  it('fills a page with no steps once', async () => {
    const { page, pressed } = stepPage(3, { stepped: false });
    const run = await fillThroughSteps(page, async () => report('only', 0, 0), fast);
    expect(pressed).toEqual([]);
    expect(run).toMatchObject({ steps: 0, stop: 'single' });
  });

  it('stops where the page will not move on, as the applicant would have to act there', async () => {
    const { page } = stepPage(3, { stuckAt: 2 });
    const run = await fillThroughSteps(page, async () => report('x', 0, 0), fast);
    expect(run).toMatchObject({ steps: 1, stop: 'not_advanced' });
  });

  it('stops before pressing on a step that asks for a code', async () => {
    const { page, pressed } = stepPage(3, { blockAt: 2 });
    const run = await fillThroughSteps(page, async () => report('x', 0, 0), fast);
    expect(pressed).toEqual([1]);
    expect(run.stop).toBe('verification');
  });
});
