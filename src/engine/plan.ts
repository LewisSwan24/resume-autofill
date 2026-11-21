// Plan: turn contexts + classifications + resume into fill steps, reports for everything that will not
// be filled, and the number of cards each repeated section needs.
import { countryAskedAbout, livesInCountry } from '../dictionary/places';
import { FIELD_SYNONYMS } from '../dictionary';
import type { FillStep } from '../drivers/execute';
import type { FileData } from '../drivers/types';
import { matchRecipesForPage, resolveRecipeForControl } from '../recipes';
import type { Locale, Resume, SiteRecipe } from '../schema';
import { getFieldKeyDef } from '../schema/fieldKeys';
import type { MappingPresetId } from '../templates/presets';
import { FILL_THRESHOLD, REVIEW_THRESHOLD } from './classify';
import type { Classification, FieldContext, FieldKey, FieldReport, SectionKey } from './types';
import { entryCount, resolveValue, toIntent } from './values';

export type { FillStep };

export interface CardDemand {
  section: SectionKey;
  /** Repeated-card signature (FieldGroup.key) or null when the section's fields are not grouped. */
  groupKey: string | null;
  /** Cards on the page now. */
  have: number;
  /** Resume entries for this section. */
  need: number;
}

export interface FillPlan {
  steps: FillStep[];
  /** Reports for fields that get no step: unmatched, needs_review, no_data (steps report after execution). */
  reports: FieldReport[];
  cardDemand: CardDemand[];
}

/** Float slack: confidences are rounded to 3 decimals. */
const EPS = 1e-9;

/** Human label of a field key in the resume's language ("education.school" → 学校 / Institution). */
export function fieldKeyLabel(key: FieldKey, locale: Locale): string {
  const syn = FIELD_SYNONYMS[key];
  if (!syn) return key;
  const list = locale === 'zh-CN' ? syn.zh : syn.en;
  return list[0] ?? syn.zh[0] ?? syn.en[0] ?? key;
}

const UNNAMED_REQUIRED = { 'zh-CN': '未命名的必填项', 'en-AU': 'Required field with no name' };

const MAX_REPORT_LABEL = 80;
/** A row is named by a label. All there may be to name it by is a passage, and a row does not show a passage. */
const shortLabel = (text: string | undefined): string | undefined =>
  text && text.length > MAX_REPORT_LABEL ? `${text.slice(0, MAX_REPORT_LABEL)}…` : text;

export function baseReport(ctx: FieldContext, cls: Classification, locale: Resume['locale']): FieldReport {
  return {
    fieldId: ctx.control.id,
    label: shortLabel(ctx.evidence[0]?.text) ?? UNNAMED_REQUIRED[locale],
    fieldKey: cls.fieldKey,
    section: cls.section,
    outcome: 'unmatched',
    confidence: cls.confidence,
  };
}

export function planFill(
  contexts: FieldContext[],
  classifications: Classification[],
  resume: Resume,
  files: Record<string, FileData> = {},
  opts: { now?: Date; presetId?: MappingPresetId; pageTitle?: string; pageUrl?: string; recipes?: readonly SiteRecipe[] } = {},
): FillPlan {
  const hasInternshipSection = classifications.some((c) => c.section === 'internship');
  const matchingRecipes =
    opts.recipes && opts.recipes.length > 0 && opts.pageUrl
      ? matchRecipesForPage(opts.recipes, opts.pageUrl)
      : [];
  const steps: FillStep[] = [];
  const reports: FieldReport[] = [];

  contexts.forEach((ctx, i) => {
    const cls = classifications[i];
    if (!cls) return;
    const report = baseReport(ctx, cls, resume.locale);

    // Nothing to call it by and nothing to fill it from. If it is required the user still has to hear about it.
    if (ctx.evidence.length === 0 && !ctx.required) return;
    if (cls.reason === 'never_fill') {
      reports.push({ ...report, fieldKey: null, confidence: 1 });
      return;
    }

    // Check explicit SiteRecipe matches before falling back to heuristic classification.
    if (matchingRecipes.length > 0) {
      const recipeRes = resolveRecipeForControl(ctx, matchingRecipes, resume, {
        section: cls.section,
        hasInternshipSection,
        files,
        askedAs: report.label,
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.presetId ? { presetId: opts.presetId } : {}),
        ...(opts.pageTitle ? { pageTitle: opts.pageTitle } : {}),
        ...(opts.pageUrl ? { pageUrl: opts.pageUrl } : {}),
      });
      if (recipeRes.hit) {
        steps.push({
          fieldId: ctx.control.id,
          fieldKey: (recipeRes.hit.fieldKey ?? ('customAnswers.answer' as FieldKey)),
          intent: recipeRes.hit.intent,
          confidence: 1,
          source: recipeRes.hit.source,
          label: report.label,
          section: recipeRes.hit.section ?? cls.section,
        });
        return;
      }
      if (recipeRes.noDataFieldKey) {
        reports.push({
          ...report,
          fieldKey: recipeRes.noDataFieldKey,
          outcome: 'no_data',
          confidence: 1,
          ...(recipeRes.ruleSource ? { source: recipeRes.ruleSource } : {}),
        });
        return;
      }
    }
    const def = cls.fieldKey ? getFieldKeyDef(cls.fieldKey) : undefined;
    if (!cls.fieldKey || !def || cls.confidence < REVIEW_THRESHOLD - EPS) {
      reports.push({ ...report, fieldKey: null });
      return;
    }
    if (cls.confidence < FILL_THRESHOLD - EPS) {
      const keys = cls.candidates.length > 0 ? cls.candidates : [{ fieldKey: cls.fieldKey, confidence: cls.confidence }];
      reports.push({
        ...report,
        outcome: 'needs_review',
        candidates: keys.map((c) => ({ label: fieldKeyLabel(c.fieldKey, resume.locale), fieldKey: c.fieldKey })),
      });
      return;
    }

    const entryIndex = ctx.group?.index ?? 0;
    const resolved =
      cls.fieldKey === 'contact.inNamedCountry'
        ? inNamedCountry(ctx, resume)
        : resolveValue(cls.fieldKey, resume, entryIndex, cls.section, {
            hasInternshipSection,
            askedAs: report.label,
            ...(ctx.sectionNote ? { sectionNote: ctx.sectionNote } : {}),
            ...(opts.now ? { now: opts.now } : {}),
          });
    if (!resolved) {
      reports.push({ ...report, outcome: 'no_data' });
      return;
    }
    const intent = toIntent(def, resolved.raw, ctx.control, resume.locale, {
      files,
      home: resume.contact.address,
      dialCode: resume.contact.phoneCountryCode.trim(),
      genderAnswer: resume.diversity.genderAnswer,
      askedAs: report.label,
      ...(opts.presetId ? { presetId: opts.presetId } : {}),
      presetCtx: { resume, ...(opts.pageTitle ? { pageTitle: opts.pageTitle } : {}), ...(opts.pageUrl ? { pageUrl: opts.pageUrl } : {}) },
    });
    if (intent?.kind === 'multi' && cls.fieldKey === 'languages.certificate') {
      // A list of tests that takes several wants every one passed, and which of them to tick, or whether one
      // stands for those below it, is not settled. The resume's own answer is shown for the applicant to pick.
      reports.push({ ...report, outcome: 'needs_review', value: intent.display, source: resolved.source });
      return;
    }
    if (!intent && def.type === 'period' && ctx.control.kind === 'date') {
      // A job still going, or a picker that holds one date: what to put is for the applicant to say.
      reports.push({ ...report, outcome: 'needs_review', source: resolved.source });
      return;
    }
    if (!intent) {
      // The data exists but this control cannot take it (e.g. a bool for a text box).
      reports.push({ ...report, outcome: 'no_data', source: resolved.source });
      return;
    }
    steps.push({
      fieldId: ctx.control.id,
      fieldKey: cls.fieldKey,
      intent,
      confidence: cls.confidence,
      source: resolved.source,
      label: report.label,
      section: cls.section,
    });
  });

  return { steps, reports, cardDemand: cardDemand(contexts, classifications, resume, hasInternshipSection) };
}

/** The answer depends on the country in the question, so it is worked out here where the question is known. */
function inNamedCountry(ctx: FieldContext, resume: Resume): { raw: boolean; source: string } | null {
  const asked = countryAskedAbout(ctx.evidence[0]?.text ?? '');
  const raw = asked ? livesInCountry(resume.contact.address.country, asked) : null;
  return raw === null ? null : { raw, source: 'contact.address.country' };
}

/** Per repeated section: cards on the page vs resume entries. Sections without controls are invisible here. */
function cardDemand(
  contexts: FieldContext[],
  classifications: Classification[],
  resume: Resume,
  hasInternshipSection: boolean,
): CardDemand[] {
  interface Bucket {
    section: SectionKey;
    groupKey: string | null;
    cards: Set<number>;
  }
  const buckets = new Map<string, Bucket>();
  contexts.forEach((ctx, i) => {
    const section = classifications[i]?.section;
    if (!section || !isArraySection(section)) return;
    const groupKey = ctx.group?.key ?? null;
    const id = `${section}|${groupKey ?? ''}`;
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = { section, groupKey, cards: new Set() }));
    if (ctx.group) b.cards.add(ctx.group.index);
  });
  const all = [...buckets.values()];
  // Stray ungrouped controls next to real cards are not an extra card.
  const kept = all.filter(
    (b) => b.groupKey !== null || !all.some((o) => o.section === b.section && o.groupKey !== null),
  );
  return kept.map((b) => ({
    section: b.section,
    groupKey: b.groupKey,
    // A grouped section has as many cards as distinct indexes; ungrouped controls form one implicit card.
    have: b.groupKey === null ? 1 : b.cards.size,
    need: entryCount(resume, b.section, hasInternshipSection),
  }));
}

const ARRAY_SECTIONS: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'education', 'work', 'internship', 'projects', 'campus', 'awards', 'languages', 'certificates', 'skills',
  'family', 'referees',
]);
const isArraySection = (s: SectionKey) => ARRAY_SECTIONS.has(s);
