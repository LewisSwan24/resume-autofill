import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SITE_RECIPES,
  RecipeParseError,
  diffRecipePacks,
  exportSignedRecipePack,
  parseAndVerifyRecipePack,
} from '../../../src/recipes';

describe('Signed SiteRecipe Pack & Diff Preview', () => {
  it('exports signed SHA-256 pack, verifies integrity, rejects tampering, and computes diffs', async () => {
    const signed = await exportSignedRecipePack(BUILTIN_SITE_RECIPES.slice(0, 2), 1_700_000_000_000);
    const verified = await parseAndVerifyRecipePack(signed);
    expect(verified.verifiedDigest).toBe(true);
    expect(verified.recipes).toHaveLength(2);

    // Tamper with a rule's hostPattern -> SHA-256 verification must reject immediately.
    const tampered = signed.replace('*.bytedance.com', '*.evil-tamper.com');
    await expect(parseAndVerifyRecipePack(tampered)).rejects.toBeInstanceOf(RecipeParseError);

    // Compute diff against existing partial list with one modified rule
    const existing = [
      {
        ...BUILTIN_SITE_RECIPES[0]!,
        rules: [],
      },
    ];
    const diff = diffRecipePacks(existing, verified.recipes, true);
    expect(diff.updated.map((r) => r.id)).toEqual([BUILTIN_SITE_RECIPES[0]!.id]);
    expect(diff.added.map((r) => r.id)).toEqual([BUILTIN_SITE_RECIPES[1]!.id]);
    expect(diff.unchangedCount).toBe(0);
    expect(diff.verifiedDigest).toBe(true);
  });
});
