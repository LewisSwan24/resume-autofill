import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  ResumeSchema,
  SiteRecipeSchema,
  computeVariantDiff,
  createSampleProfile,
  materializeResume,
  migrateProfile,
  wouldCreateVariantCycle,
} from '../../../src/schema';

describe('Schema v2 & non-destructive variants', () => {
  it('migrates v1 profiles cleanly to v2 without losing fields', () => {
    const legacyV1 = {
      schemaVersion: 1,
      activeResumeId: 'r1',
      resumes: [
        {
          id: 'r1',
          title: '主简历',
          locale: 'zh-CN',
          basics: { familyName: '张', givenName: '三' },
        },
      ],
      settings: { uiLanguage: 'zh', previewBeforeFill: true, aiLayerMode: 'auto_local' },
    };
    const migrated = migrateProfile(legacyV1);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.resumes[0]?.basics.familyName).toBe('张');
    expect(migrated.settings.previewBeforeFill).toBe(true);
    expect(migrated.settings.aiLayerMode).toBe('auto_local');
  });

  it('validates declarative SiteRecipeSchema with transform presets', () => {
    const parsed = SiteRecipeSchema.parse({
      id: 'rec-1',
      name: 'Ashby Test',
      hostPattern: '*.ashbyhq.com',
      updatedAt: 1000,
      rules: [
        {
          id: 'rule-1',
          fingerprint: { tag: 'input', inputType: 'tel', labelTokens: ['phone', 'mobile'] },
          fieldKey: 'contact.phone',
          transformPreset: 'phone_local',
        },
      ],
    });
    expect(parsed.rules[0]?.transformPreset).toBe('phone_local');
    expect(parsed.enabled).toBe(true);
  });

  it('materializes non-destructive variant overlays and promotes highlighted skills', () => {
    const sample = createSampleProfile();
    const base = sample.resumes[0]!;
    const variant = ResumeSchema.parse({
      id: 'variant-backend',
      title: '后端校招定制版',
      locale: base.locale,
      variantOf: base.id,
      variantMeta: {
        targetRole: 'Rust 后端工程师',
        customSummary: '专注于高并发分布式系统与异步网络架构。',
        hiddenSections: ['awards'],
        hiddenIndices: { work: [1] },
        highlightedSkills: base.skills[1] ? [base.skills[1].name] : [],
      },
    });

    const materialized = materializeResume(variant, [base, variant]);
    expect(materialized.basics).toEqual(base.basics);
    expect(materialized.jobIntention.positions[0]).toBe('Rust 后端工程师');
    expect(materialized.selfIntroduction).toBe('专注于高并发分布式系统与异步网络架构。');
    expect(materialized.awards).toEqual([]);
    expect(materialized.work).toHaveLength(Math.max(0, base.work.length - (base.work.length > 1 ? 1 : 0)));
    if (base.skills[1]) {
      expect(materialized.skills[0]?.name).toBe(base.skills[1].name);
    }

    const diff = computeVariantDiff(variant, [base, variant]);
    expect(diff).toMatchObject({
      baseResumeId: base.id,
      targetRole: 'Rust 后端工程师',
      summaryChanged: true,
      hiddenSections: ['awards'],
      hiddenCounts: { work: 1 },
    });
  });

  it('detects and safely breaks circular variant chains without infinite recursion', () => {
    const rA = ResumeSchema.parse({ id: 'a', title: 'A', locale: 'zh-CN', variantOf: 'b' });
    const rB = ResumeSchema.parse({ id: 'b', title: 'B', locale: 'zh-CN', variantOf: 'a' });
    expect(wouldCreateVariantCycle('a', 'b', [rA, rB])).toBe(true);
    expect(wouldCreateVariantCycle('a', 'a', [rA, rB])).toBe(true);
    expect(materializeResume(rA, [rA, rB]).id).toBe('a');
  });
});
