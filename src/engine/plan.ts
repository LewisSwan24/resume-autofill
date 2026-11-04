// Plan: turn contexts + classifications + resume into fill steps, reports for everything that will not
// be filled, and the number of cards each repeated section needs.
import { FIELD_SYNONYMS } from '../dictionary';
import type { FillStep } from '../drivers/execute';
import type { FileData } from '../drivers/types';
import type { Locale, Resume } from '../schema';
import { getFieldKeyDef } from '../schema/fieldKeys';
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

function baseReport(ctx: FieldContext, cls: Classification, locale: Resume['locale']): FieldReport {
  return {
    fieldId: ctx.control.id,
    label: ctx.evidence[0]?.text ?? UNNAMED_REQUIRED[locale],
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
  opts: { now?: Date } = {},
): FillPlan {
  const hasInternshipSection = classifications.some((c) => c.section === 'internship');
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
    const resolved = resolveValue(cls.fieldKey, resume, entryIndex, cls.section, {
      hasInternshipSection,
      ...(opts.now ? { now: opts.now } : {}),
    });
    if (!resolved) {
      reports.push({ ...report, outcome: 'no_data' });
      return;
    }
    const intent = toIntent(def, resolved.raw, ctx.control, resume.locale, {
      files,
      home: resume.contact.address,
      genderAnswer: resume.diversity.genderAnswer,
    });
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
