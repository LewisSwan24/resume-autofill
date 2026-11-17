import { describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { createSampleProfile } from '../../../src/schema';
import {
  BUILTIN_SITE_RECIPES,
  RecipeParseError,
  applyTransformPreset,
  captureFieldFingerprint,
  exportRecipesJson,
  matchHostAndPath,
  matchRecipesForPage,
  parseRecipesJson,
  scoreFingerprintMatch,
} from '../../../src/recipes';
import type { Control, FieldContext } from '../../../src/engine/types';

describe('Declarative SiteRecipe security, fingerprinting & planning', () => {
  it('blocks prototype pollution keys and ReDoS-prone wildcard globs on parse', () => {
    const poisoned = '[{"id":"r1","name":"Bad","hostPattern":"*.example.com","updatedAt":1,"__proto__":{"polluted":true},"rules":[]}]';
    expect(() => parseRecipesJson(poisoned)).toThrow(RecipeParseError);

    const tooManyStars = JSON.stringify([
      {
        id: 'r2',
        name: 'Wild',
        hostPattern: '*.*.*.*.*.example.com',
        updatedAt: 1,
        rules: [],
      },
    ]);
    expect(() => parseRecipesJson(tooManyStars)).toThrow(RecipeParseError);

    const illegalHostChars = JSON.stringify([
      {
        id: 'r3',
        name: 'RegexInjection',
        hostPattern: 'a(b+)+.example.com',
        updatedAt: 1,
        rules: [],
      },
    ]);
    expect(() => parseRecipesJson(illegalHostChars)).toThrow(RecipeParseError);
  });

  it('round-trips valid recipes and matches host/path safely', () => {
    const json = exportRecipesJson(BUILTIN_SITE_RECIPES);
    const parsed = parseRecipesJson(json);
    expect(parsed.length).toBeGreaterThanOrEqual(4);
    expect(matchHostAndPath({ hostPattern: '*.ashbyhq.com' }, 'https://jobs.ashbyhq.com/acme/123')).toBe(true);
    expect(matchHostAndPath({ hostPattern: '*.ashbyhq.com' }, 'https://evil.com/jobs.ashbyhq.com')).toBe(false);
    expect(
      matchHostAndPath(
        { hostPattern: '*.nowcoder.com', pathPattern: '/jobs/*' },
        'https://www.nowcoder.com/jobs/detail/42',
      ),
    ).toBe(true);
    expect(
      matchHostAndPath(
        { hostPattern: '*.nowcoder.com', pathPattern: '/jobs/*' },
        'https://www.nowcoder.com/discuss/1',
      ),
    ).toBe(false);
  });

  it('applies whitelist transform presets purely without eval', () => {
    expect(applyTransformPreset('  hello  ', 'trim')).toBe('hello');
    expect(applyTransformPreset('+86 13800001111', 'phone_local')).toBe('13800001111');
    expect(applyTransformPreset('2026-06-15', 'date_ym')).toBe('2026-06');
    expect(applyTransformPreset('2026-06', 'date_ymd')).toBe('2026-06-01');
    expect(applyTransformPreset('abC', 'uppercase')).toBe('ABC');
  });

  it('matches resilient fingerprints into FillSteps during planFill', () => {
    document.body.innerHTML = `
      <form class="hashed-form-v9">
        <div class="wrapper-abc123">
          <label for="f-custom">Campus Referral Source</label>
          <input id="f-custom" type="text" placeholder="Where did you hear?" />
        </div>
      </form>
    `;
    const el = document.getElementById('f-custom') as HTMLInputElement;
    const ctrl: Control = { id: 'c1', el, kind: 'text', lib: 'native', inputType: 'text' };
    const ctx: FieldContext = {
      control: ctrl,
      evidence: [{ source: 'label-for', text: 'Campus Referral Source', weight: 1 }],
      sectionTitle: null,
      sectionRoot: null,
      group: null,
      required: false,
    };

    const recordedFp = captureFieldFingerprint(ctrl, ctx.evidence);
    // Simulate a DOM redeploy with a new element id and slightly altered ancestor path while tokens & tag hold.
    el.id = 'f-custom-v2';
    const redeployedFp = captureFieldFingerprint(ctrl, ctx.evidence);
    expect(scoreFingerprintMatch(redeployedFp, recordedFp)).toBeGreaterThanOrEqual(0.65);

    const sample = createSampleProfile();
    const resume = sample.resumes[0]!;
    const recipe = {
      id: 'user-rec-1',
      name: 'Acme Portal',
      hostPattern: '*.acme-jobs.test',
      enabled: true,
      updatedAt: 100,
      rules: [
        {
          id: 'rule-ref',
          fingerprint: recordedFp,
          constantValue: '  GitHub Open Source Program  ',
          transformPreset: 'trim' as const,
        },
      ],
    };

    const pageRecipes = matchRecipesForPage([recipe], 'https://apply.acme-jobs.test/role/1');
    expect(pageRecipes).toHaveLength(1);

    const plan = planFill(
      [ctx],
      [{ fieldKey: null, confidence: 0, section: null, candidates: [] }],
      resume,
      {},
      { pageUrl: 'https://apply.acme-jobs.test/role/1', recipes: [recipe] },
    );
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.intent).toEqual({ kind: 'text', text: 'GitHub Open Source Program' });
    expect(plan.steps[0]?.source).toBe('recipe:user-rec-1');
  });
});
