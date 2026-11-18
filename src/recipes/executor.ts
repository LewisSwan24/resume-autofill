// SiteRecipe rule matching and strictly-whitelisted value transform presets.
import type { FileData, FillIntent } from '../drivers/types';
import type { FieldContext, FieldKey, SectionKey } from '../engine/types';
import { resolveValue, toIntent } from '../engine/values';
import type { Locale, Resume, SiteRecipe, SiteRecipeRule, TransformPreset } from '../schema';
import { getFieldKeyDef } from '../schema/fieldKeys';
import type { MappingPresetId } from '../templates/presets';
import { captureFieldFingerprint, RECIPE_MATCH_THRESHOLD, scoreFingerprintMatch } from './fingerprint';
import { matchHostAndPath } from './schema';

export interface MatchedRecipeStep {
  recipeId: string;
  recipeName: string;
  rule: SiteRecipeRule;
  score: number;
  fieldKey: FieldKey | null;
  section: SectionKey | null;
  intent: FillIntent;
  source: string;
}

export interface RecipeResolveOptions {
  section?: SectionKey | null;
  hasInternshipSection?: boolean;
  now?: Date;
  files?: Record<string, FileData>;
  presetId?: MappingPresetId;
  pageTitle?: string;
  pageUrl?: string;
  askedAs?: string;
}

/** Pure whitelisted value transformation — zero dynamic code execution. */
export function applyTransformPreset(value: string, preset: TransformPreset): string {
  switch (preset) {
    case 'none':
      return value;
    case 'trim':
      return value.trim();
    case 'uppercase':
      return value.toUpperCase();
    case 'lowercase':
      return value.toLowerCase();
    case 'phone_local':
      return value.replace(/^\+\d{1,3}[-\s]+/, '').trim();
    case 'date_ym': {
      const m = value.match(/^(\d{4})[-/](\d{1,2})/);
      return m ? `${m[1]}-${m[2]!.padStart(2, '0')}` : value;
    }
    case 'date_ymd': {
      const full = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (full) return `${full[1]}-${full[2]!.padStart(2, '0')}-${full[3]!.padStart(2, '0')}`;
      const ym = value.match(/^(\d{4})[-/](\d{1,2})$/);
      return ym ? `${ym[1]}-${ym[2]!.padStart(2, '0')}-01` : value;
    }
  }
}

export function matchRecipesForPage(recipes: readonly SiteRecipe[], href: string): SiteRecipe[] {
  return recipes.filter((r) => r.enabled && matchHostAndPath(r, href));
}

function sectionOfKey(key: FieldKey): SectionKey | null {
  const def = getFieldKeyDef(key);
  return def?.sections?.[0] ?? null;
}

export function resolveRecipeForControl(
  ctx: FieldContext,
  matchingRecipes: readonly SiteRecipe[],
  resume: Resume,
  opts: RecipeResolveOptions = {},
): { hit: MatchedRecipeStep | null; noDataFieldKey?: FieldKey; ruleSource?: string } {
  if (matchingRecipes.length === 0) return { hit: null };
  const candidate = captureFieldFingerprint(ctx.control, ctx.evidence);

  let best: { recipe: SiteRecipe; rule: SiteRecipeRule; score: number } | null = null;
  for (const recipe of matchingRecipes) {
    for (const rule of recipe.rules) {
      const score = scoreFingerprintMatch(candidate, rule.fingerprint);
      if (score >= RECIPE_MATCH_THRESHOLD && (!best || score > best.score)) {
        best = { recipe, rule, score };
      }
    }
  }
  if (!best) return { hit: null };

  const { recipe, rule, score } = best;

  // Case 1: Fixed answer recorded for custom site question.
  if (rule.constantValue !== undefined && rule.constantValue.trim() !== '') {
    const transformed = applyTransformPreset(rule.constantValue, rule.transformPreset);
    const fk = (rule.fieldKey as FieldKey) || null;
    return {
      hit: {
        recipeId: recipe.id,
        recipeName: recipe.name,
        rule,
        score,
        fieldKey: fk,
        section: fk ? sectionOfKey(fk) : (opts.section ?? null),
        intent: { kind: 'text', text: transformed },
        source: `recipe:${recipe.id}`,
      },
    };
  }

  // Case 2: Mapped to a Resume FieldKey.
  if (rule.fieldKey) {
    const fk = rule.fieldKey as FieldKey;
    const def = getFieldKeyDef(fk);
    if (!def) return { hit: null };
    const section = opts.section ?? sectionOfKey(fk);
    const entryIndex = ctx.group?.index ?? 0;
    const resolved = resolveValue(fk, resume, entryIndex, section, {
      hasInternshipSection: opts.hasInternshipSection ?? false,
      ...(opts.now ? { now: opts.now } : {}),
    });
    if (!resolved) {
      return { hit: null, noDataFieldKey: fk, ruleSource: `recipe:${recipe.id}` };
    }
    const intent = toIntent(def, resolved.raw, ctx.control, resume.locale as Locale, {
      files: opts.files ?? {},
      home: resume.contact.address,
      dialCode: resume.contact.phoneCountryCode.trim(),
      genderAnswer: resume.diversity.genderAnswer,
      ...(opts.askedAs ? { askedAs: opts.askedAs } : {}),
      ...(opts.presetId ? { presetId: opts.presetId } : {}),
      presetCtx: {
        resume,
        ...(opts.pageTitle ? { pageTitle: opts.pageTitle } : {}),
        ...(opts.pageUrl ? { pageUrl: opts.pageUrl } : {}),
      },
    });
    if (!intent) {
      return { hit: null, noDataFieldKey: fk, ruleSource: `recipe:${recipe.id}` };
    }

    if (intent.kind === 'text' && rule.transformPreset !== 'none') {
      const transformed = applyTransformPreset(intent.text, rule.transformPreset);
      return {
        hit: {
          recipeId: recipe.id,
          recipeName: recipe.name,
          rule,
          score,
          fieldKey: fk,
          section,
          intent: { kind: 'text', text: transformed },
          source: `recipe:${recipe.id}:${resolved.source}`,
        },
      };
    }

    return {
      hit: {
        recipeId: recipe.id,
        recipeName: recipe.name,
        rule,
        score,
        fieldKey: fk,
        section,
        intent,
        source: `recipe:${recipe.id}:${resolved.source}`,
      },
    };
  }

  return { hit: null };
}
