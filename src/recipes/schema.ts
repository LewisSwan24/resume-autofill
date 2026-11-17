// Declarative SiteRecipe security guards: ReDoS-safe bounded glob compiler & prototype-pollution sanitizer.
import { z } from 'zod';
import { SiteRecipeSchema, type SiteRecipe } from '../schema';

export class RecipeParseError extends Error {
  override readonly name = 'RecipeParseError';
  constructor(message: string) {
    super(message);
  }
}

const MAX_PATTERN_LEN = 160;
const MAX_WILDCARDS = 4;
const HOST_PATTERN_CHARS = /^[a-zA-Z0-9._*-]+$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripDangerousKeys(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new RecipeParseError('Recipe JSON exceeds maximum nesting depth');
  if (Array.isArray(value)) return value.map((v) => stripDangerousKeys(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) {
        throw new RecipeParseError(`Forbidden key "${k}" detected in recipe JSON`);
      }
      clean[k] = stripDangerousKeys(v, depth + 1);
    }
    return clean;
  }
  return value;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function validateGlobPattern(pattern: string, mode: 'host' | 'path'): void {
  if (!pattern || pattern.length > MAX_PATTERN_LEN) {
    throw new RecipeParseError(`Invalid ${mode}Pattern length`);
  }
  const starCount = pattern.split('*').length - 1;
  if (starCount > MAX_WILDCARDS) {
    throw new RecipeParseError(`${mode}Pattern exceeds maximum wildcard count (${MAX_WILDCARDS})`);
  }
  if (mode === 'host' && !HOST_PATTERN_CHARS.test(pattern)) {
    throw new RecipeParseError(`Illegal characters in hostPattern: ${pattern}`);
  }
}

/**
 * Compile a bounded glob (`*` only, max 4 wildcards) into a linear-time RegExp.
 * Never evaluates user-supplied regex syntax, preventing ReDoS completely.
 */
export function globToRegExp(glob: string, mode: 'host' | 'path'): RegExp {
  validateGlobPattern(glob, mode);
  const starRe = mode === 'host' ? '[^/?#]+' : '.*';
  const body = glob.split('*').map(escapeRe).join(starRe);
  return new RegExp(`^${body}$`, 'i');
}

export function matchHostAndPath(recipe: Pick<SiteRecipe, 'hostPattern' | 'pathPattern'>, href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  try {
    const hostRe = globToRegExp(recipe.hostPattern, 'host');
    if (!hostRe.test(url.hostname)) return false;
    if (recipe.pathPattern && recipe.pathPattern.trim()) {
      const pathRe = globToRegExp(recipe.pathPattern.trim(), 'path');
      return pathRe.test(url.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

const RecipePackSchema = z.union([
  z.array(SiteRecipeSchema).max(100),
  z.object({ recipes: z.array(SiteRecipeSchema).max(100) }).transform((o) => o.recipes),
]);

/** Safely parse untrusted SiteRecipe JSON string (blocks prototype pollution & validates globs). */
export function parseRecipesJson(jsonText: string): SiteRecipe[] {
  if (jsonText.length > 512 * 1024) {
    throw new RecipeParseError('Recipe JSON exceeds 512 KB limit');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new RecipeParseError('Malformed recipe JSON');
  }
  const clean = stripDangerousKeys(raw);
  const parsed = RecipePackSchema.safeParse(clean);
  if (!parsed.success) {
    throw new RecipeParseError(`Recipe validation failed: ${parsed.error.message}`);
  }
  for (const r of parsed.data) {
    validateGlobPattern(r.hostPattern, 'host');
    if (r.pathPattern) validateGlobPattern(r.pathPattern, 'path');
  }
  return parsed.data;
}

export function exportRecipesJson(recipes: readonly SiteRecipe[]): string {
  return JSON.stringify({ format: 'resume-autofill-recipes', version: 1, recipes }, null, 2);
}
