// Signed SHA-256 recipe pack export, integrity verification, and diff preview against local recipes.
import type { SiteRecipe } from '../schema';
import { RecipeParseError, parseRecipesJson } from './schema';

export interface SignedRecipePackEnvelope {
  format: 'resume-autofill-recipes-signed';
  version: 2;
  sha256: string;
  exportedAt: number;
  recipes: SiteRecipe[];
}

export interface RecipePackDiff {
  added: SiteRecipe[];
  updated: SiteRecipe[];
  unchangedCount: number;
  verifiedDigest: boolean;
}

async function digestTextSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function exportSignedRecipePack(recipes: readonly SiteRecipe[], now = Date.now()): Promise<string> {
  const canonical = JSON.stringify(recipes);
  const sha256 = await digestTextSha256(canonical);
  const env: SignedRecipePackEnvelope = {
    format: 'resume-autofill-recipes-signed',
    version: 2,
    sha256,
    exportedAt: now,
    recipes: [...recipes],
  };
  return JSON.stringify(env, null, 2);
}

/**
 * Parse and integrity-verify a SiteRecipe JSON pack (supports signed v2 envelopes and unsigned v1 packs).
 * Rejects tampered signed packs where `sha256` fails verification.
 */
export async function parseAndVerifyRecipePack(jsonText: string): Promise<{
  recipes: SiteRecipe[];
  verifiedDigest: boolean;
}> {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new RecipeParseError('Malformed recipe pack JSON');
  }

  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).format === 'resume-autofill-recipes-signed'
  ) {
    const obj = raw as Record<string, unknown>;
    if (obj.version !== 2 || typeof obj.sha256 !== 'string' || !Array.isArray(obj.recipes)) {
      throw new RecipeParseError('Malformed signed recipe envelope');
    }
    const cleanRecipes = parseRecipesJson(JSON.stringify(obj.recipes));
    const expectedDigest = await digestTextSha256(JSON.stringify(obj.recipes));
    if (expectedDigest !== obj.sha256) {
      throw new RecipeParseError('Recipe pack SHA-256 integrity mismatch (file may be tampered)');
    }
    return { recipes: cleanRecipes, verifiedDigest: true };
  }

  return { recipes: parseRecipesJson(jsonText), verifiedDigest: false };
}

export function diffRecipePacks(
  existing: readonly SiteRecipe[],
  incoming: readonly SiteRecipe[],
  verifiedDigest: boolean,
): RecipePackDiff {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const added: SiteRecipe[] = [];
  const updated: SiteRecipe[] = [];
  let unchangedCount = 0;

  for (const rec of incoming) {
    const prev = byId.get(rec.id);
    if (!prev) {
      added.push(rec);
    } else if (JSON.stringify(prev.rules) !== JSON.stringify(rec.rules) || prev.hostPattern !== rec.hostPattern) {
      updated.push(rec);
    } else {
      unchangedCount++;
    }
  }
  return { added, updated, unchangedCount, verifiedDigest };
}
