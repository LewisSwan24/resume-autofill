// Pure offline Application Tracker funnel analytics, Variant A/B conversion comparison, and SLA aging reminders.
import type { ApplicationRecord } from './schema';

export const STALE_APPLICATION_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export type FunnelStageKey = 'wish' | 'filling' | 'submitted' | 'interview' | 'offer';

export interface FunnelStageMetric {
  stage: FunnelStageKey;
  count: number;
  /** Ratio against total applications (0..100 rounded). */
  percentOfTotal: number;
}

export interface VariantConversionStat {
  variantKey: string;
  label: string;
  applications: number;
  submittedOrBeyond: number;
  interviews: number;
  offers: number;
  interviewRate: number;
  offerRate: number;
}

export interface StaleApplicationItem {
  id: string;
  company: string;
  position: string;
  status: ApplicationRecord['status'];
  daysSinceStatusChange: number;
}

export interface TrackerAnalytics {
  total: number;
  funnel: FunnelStageMetric[];
  byVariant: VariantConversionStat[];
  staleRecords: StaleApplicationItem[];
  offerRate: number;
  interviewRate: number;
}

/**
 * Compute cumulative pipeline reach + per-variant A/B attribution + 14-day stale follow-ups.
 * Notice cumulative reach: an `'interview'` or `'offer'` record has already passed `'submitted'` and `'filling'`.
 */
export function computeTrackerAnalytics(
  records: readonly ApplicationRecord[],
  now: number = Date.now(),
  staleDays = STALE_APPLICATION_DAYS,
): TrackerAnalytics {
  const total = records.length;

  let reachedWish = 0;
  let reachedFilling = 0;
  let reachedSubmitted = 0;
  let reachedInterview = 0;
  let reachedOffer = 0;

  const variantBuckets = new Map<
    string,
    { label: string; applications: number; submittedOrBeyond: number; interviews: number; offers: number }
  >();
  const staleRecords: StaleApplicationItem[] = [];

  for (const rec of records) {
    reachedWish++;
    const isOffer = rec.outcome === 'offer';
    const isInterview = rec.status === 'interview' || isOffer;
    const isSubmitted = rec.status === 'submitted' || isInterview || (rec.status === 'closed' && rec.outcome === 'rejected');
    const isFilling = rec.status === 'filling' || isSubmitted;

    if (isFilling) reachedFilling++;
    if (isSubmitted) reachedSubmitted++;
    if (isInterview) reachedInterview++;
    if (isOffer) reachedOffer++;

    // Determine variant attribution (prefer record-level, fall back to latest history entry).
    const latestHist = rec.history[0];
    const vId = rec.variantId ?? latestHist?.variantId ?? latestHist?.resumeId ?? 'unattributed';
    const vLabel = rec.variantTitle ?? latestHist?.variantTitle ?? (vId === 'unattributed' ? 'Default / Manual' : vId);
    let bucket = variantBuckets.get(vId);
    if (!bucket) {
      bucket = { label: vLabel, applications: 0, submittedOrBeyond: 0, interviews: 0, offers: 0 };
      variantBuckets.set(vId, bucket);
    }
    bucket.applications++;
    if (isSubmitted) bucket.submittedOrBeyond++;
    if (isInterview) bucket.interviews++;
    if (isOffer) bucket.offers++;

    if (rec.status === 'filling' || rec.status === 'submitted' || rec.status === 'interview') {
      const days = Math.floor(Math.max(0, now - rec.statusAt) / MS_PER_DAY);
      if (days >= staleDays) {
        staleRecords.push({
          id: rec.id,
          company: rec.company || rec.host,
          position: rec.position,
          status: rec.status,
          daysSinceStatusChange: days,
        });
      }
    }
  }

  staleRecords.sort((a, b) => b.daysSinceStatusChange - a.daysSinceStatusChange);

  const pct = (n: number, denom: number) => (denom === 0 ? 0 : Math.round((n / denom) * 100));

  const funnel: FunnelStageMetric[] = [
    { stage: 'wish', count: reachedWish, percentOfTotal: pct(reachedWish, total) },
    { stage: 'filling', count: reachedFilling, percentOfTotal: pct(reachedFilling, total) },
    { stage: 'submitted', count: reachedSubmitted, percentOfTotal: pct(reachedSubmitted, total) },
    { stage: 'interview', count: reachedInterview, percentOfTotal: pct(reachedInterview, total) },
    { stage: 'offer', count: reachedOffer, percentOfTotal: pct(reachedOffer, total) },
  ];

  const byVariant: VariantConversionStat[] = Array.from(variantBuckets.entries())
    .map(([variantKey, b]) => ({
      variantKey,
      label: b.label,
      applications: b.applications,
      submittedOrBeyond: b.submittedOrBeyond,
      interviews: b.interviews,
      offers: b.offers,
      interviewRate: pct(b.interviews, b.submittedOrBeyond || b.applications),
      offerRate: pct(b.offers, b.submittedOrBeyond || b.applications),
    }))
    .sort((a, b) => b.applications - a.applications);

  return {
    total,
    funnel,
    byVariant,
    staleRecords,
    interviewRate: pct(reachedInterview, reachedSubmitted || total),
    offerRate: pct(reachedOffer, reachedSubmitted || total),
  };
}
