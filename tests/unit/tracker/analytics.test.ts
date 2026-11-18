import { describe, expect, it } from 'vitest';
import { ApplicationRecordSchema, computeTrackerAnalytics } from '../../../src/tracker';

describe('Tracker Funnel Analytics & Variant A/B Attribution', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 10, 20);

  it('computes cumulative conversion funnel, variant A/B rates, and 14-day stale follow-ups', () => {
    const records = [
      ApplicationRecordSchema.parse({
        id: 'a1',
        url: 'https://jobs.acme.test/1',
        host: 'jobs.acme.test',
        company: 'Acme',
        position: 'Backend',
        status: 'closed',
        outcome: 'offer',
        variantId: 'var-rust',
        variantTitle: 'Rust Variant',
        statusAt: NOW - 3 * DAY,
        createdAt: NOW - 20 * DAY,
        openedAt: NOW - 20 * DAY,
        updatedAt: NOW - 3 * DAY,
      }),
      ApplicationRecordSchema.parse({
        id: 'a2',
        url: 'https://jobs.beta.test/2',
        host: 'jobs.beta.test',
        company: 'Beta',
        position: 'Platform',
        status: 'interview',
        outcome: 'pending',
        variantId: 'var-rust',
        variantTitle: 'Rust Variant',
        statusAt: NOW - 16 * DAY, // Stale (> 14 days)
        createdAt: NOW - 22 * DAY,
        openedAt: NOW - 22 * DAY,
        updatedAt: NOW - 16 * DAY,
      }),
      ApplicationRecordSchema.parse({
        id: 'a3',
        url: 'https://jobs.gamma.test/3',
        host: 'jobs.gamma.test',
        company: 'Gamma',
        position: 'Frontend',
        status: 'submitted',
        variantId: 'base-cv',
        variantTitle: 'Base CV',
        statusAt: NOW - 15 * DAY, // Stale (> 14 days)
        createdAt: NOW - 18 * DAY,
        openedAt: NOW - 18 * DAY,
        updatedAt: NOW - 15 * DAY,
      }),
      ApplicationRecordSchema.parse({
        id: 'a4',
        url: 'https://jobs.delta.test/4',
        host: 'jobs.delta.test',
        company: 'Delta',
        position: 'SRE',
        status: 'wish',
        statusAt: NOW - 1 * DAY,
        createdAt: NOW - 1 * DAY,
        openedAt: NOW - 1 * DAY,
        updatedAt: NOW - 1 * DAY,
      }),
    ];

    const analytics = computeTrackerAnalytics(records, NOW);
    expect(analytics.total).toBe(4);
    expect(analytics.funnel).toEqual([
      { stage: 'wish', count: 4, percentOfTotal: 100 },
      { stage: 'filling', count: 3, percentOfTotal: 75 },
      { stage: 'submitted', count: 3, percentOfTotal: 75 },
      { stage: 'interview', count: 2, percentOfTotal: 50 },
      { stage: 'offer', count: 1, percentOfTotal: 25 },
    ]);

    const rustStat = analytics.byVariant.find((v) => v.variantKey === 'var-rust');
    expect(rustStat).toMatchObject({
      applications: 2,
      interviews: 2,
      offers: 1,
      interviewRate: 100,
      offerRate: 50,
    });

    expect(analytics.staleRecords.map((s) => s.id)).toEqual(['a2', 'a3']);
  });
});
