import { describe, expect, it } from 'vitest';
import { createSampleProfile } from '../../../src/schema';
import {
  analyzeResumeAgainstJd,
  buildVariantMetaFromJd,
  checkRewriteFactPreservation,
  generateTailoredSummaryDraft,
} from '../../../src/tailor';

describe('Offline JD match analyzer & Fact Guard rewriter', () => {
  it('computes offline JD keyword score, missing keywords, and variant recommendations', () => {
    const sample = createSampleProfile();
    const resume = sample.resumes[1]!; // EN sample resume (backend + data analysis)
    const jd = `
      Senior Platform Engineer
      Required: TypeScript, Kubernetes, PostgreSQL, Microservices, GraphQL
      Experience building reliable backend services and CI/CD pipelines.
    `;

    const analysis = analyzeResumeAgainstJd(resume, jd);
    expect(analysis.targetRole).toContain('Senior Platform Engineer');
    expect(analysis.totalKeywords).toBeGreaterThan(3);
    expect(analysis.matchScore).toBeGreaterThanOrEqual(0);
    expect(analysis.matchScore).toBeLessThanOrEqual(100);
    expect(analysis.missingKeywords.map((k) => k.toLowerCase())).toContain('kubernetes');

    const meta = buildVariantMetaFromJd(resume, analysis);
    expect(meta.targetRole).toBe(analysis.targetRole);
    expect(meta.jdKeywords?.length).toBeGreaterThan(0);
  });

  it('flags hallucinated metrics in AI rewrites while allowing authentic resume numbers', () => {
    const cleanCheck = checkRewriteFactPreservation(
      'Reduced latency by 40% across 3 services in 2024.',
      '1. Reduced p99 latency by 40% across 3 microservices (2024).',
    );
    expect(cleanCheck.ok).toBe(true);
    expect(cleanCheck.inventedMetrics).toEqual([]);

    const hallucinated = checkRewriteFactPreservation(
      'Built backend API services for recruitment workflows.',
      'Scaled API traffic by 300% for 50000 users in 2025.',
    );
    expect(hallucinated.ok).toBe(false);
    expect(hallucinated.inventedMetrics).toEqual(expect.arrayContaining(['300%', '50000', '2025']));
  });

  it('falls back cleanly to pure local summary draft without network', async () => {
    const sample = createSampleProfile();
    const resume = sample.resumes[1]!;
    const draft = await generateTailoredSummaryDraft({
      resume,
      targetRole: 'Backend Engineer',
      matchedKeywords: ['backend', 'SQL'],
      settings: { aiLayerMode: 'bm25_only' },
    });
    expect(draft).not.toBeNull();
    expect(draft?.factCheck.ok).toBe(true);
  });
});
