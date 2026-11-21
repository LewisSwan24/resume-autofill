// Entries a page already holds, in sections filled in place. A card that already names its entry (the school, the
// company, the project, the award) is someone's: nothing in it is touched. When it names one of the resume's
// entries, that entry is in place already; the others go to the empty cards, in the resume's order.
import { matchOption } from '../dictionary/options';
import { getDriver } from '../drivers/registry';
import type { Classification, FieldContext, SectionKey } from '../engine/types';
import { entryFieldText, sectionEntries } from '../engine/values';
import type { Resume } from '../schema';

/** Per resume module, the fields that name an entry. The first is the one a page asks for. */
const NAME_FIELDS: Readonly<Record<string, readonly string[]>> = {
  education: ['school', 'schoolEn'],
  work: ['company'],
  projects: ['name'],
  awards: ['name'],
  campus: ['organization'],
  certificates: ['name'],
};

const moduleOf = (section: SectionKey): string => (section === 'internship' ? 'work' : section);
const normal = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The card shows this entry: by the same words, or by an option our fill would have picked for it ("星河理工大学" put
 * in as "星河理工大学（XHU）" or "星河理工"). Else a second run would take its own pick for someone's entry.
 */
const showsEntry = (shown: string, names: readonly string[]): boolean =>
  names.some((n) => matchOption(null, n, [{ label: shown, value: shown }]).status === 'matched');

export interface HeldEntries {
  /** Per repeated card group (its key): card index → the resume entry it takes, or null when it is left alone. */
  cards: Map<string, Map<number, number | null>>;
  /** Per section: cards holding an entry the resume does not have. They take none of the resume's. */
  foreign: Map<SectionKey, number>;
}

interface Bucket {
  section: SectionKey;
  cards: Set<number>;
  named: Map<number, string>;
}

/** What the name box of a card shows, read the way its driver reads it (a plain box by its value, with none). */
function shownName(ctx: FieldContext): string {
  const { el } = ctx.control;
  try {
    const driver = getDriver(ctx.control);
    if (driver) return (driver.read(ctx.control) ?? '').trim();
  } catch {
    return '';
  }
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.trim() : '';
}

export function heldEntries(contexts: readonly FieldContext[], classifications: readonly Classification[], resume: Resume): HeldEntries {
  const hasInternshipSection = classifications.some((c) => c.section === 'internship');
  const buckets = new Map<string, Bucket>();
  contexts.forEach((ctx, i) => {
    const section = classifications[i]?.section;
    if (ctx.group && section && NAME_FIELDS[moduleOf(section)] && !buckets.has(ctx.group.key)) {
      buckets.set(ctx.group.key, { section, cards: new Set(), named: new Map() });
    }
  });
  contexts.forEach((ctx, i) => {
    const cls = classifications[i];
    const b = ctx.group ? buckets.get(ctx.group.key) : undefined;
    if (!b || !ctx.group) return;
    b.cards.add(ctx.group.index);
    const names = NAME_FIELDS[moduleOf(b.section)]!;
    if (cls?.fieldKey !== `${moduleOf(b.section)}.${names[0]}`) return;
    const shown = shownName(ctx);
    if (shown) b.named.set(ctx.group.index, shown);
  });

  const held: HeldEntries = { cards: new Map(), foreign: new Map() };
  for (const [key, b] of buckets) {
    if (b.named.size === 0) continue;
    const module = moduleOf(b.section);
    const rows = sectionEntries(resume, module as Parameters<typeof sectionEntries>[1], b.section, hasInternshipSection);
    const namesOf = (entry: unknown) => NAME_FIELDS[module]!.map((f) => entryFieldText(module, f, entry, resume.locale).trim()).filter(Boolean);
    const taken = new Set<number>();
    const map = new Map<number, number | null>();
    const order = [...b.cards].sort((x, y) => x - y);
    for (const card of order) {
      const name = b.named.get(card);
      if (name === undefined) continue;
      const free = (p: number) => !taken.has(p);
      const exact = rows.findIndex((r, p) => free(p) && namesOf(r.entry).some((n) => normal(n) === normal(name)));
      const at = exact >= 0 ? exact : rows.findIndex((r, p) => free(p) && showsEntry(name, namesOf(r.entry)));
      if (at >= 0) taken.add(at);
      else held.foreign.set(b.section, (held.foreign.get(b.section) ?? 0) + 1);
      // Matched or not, the card is someone's own: it is left alone.
      map.set(card, null);
    }
    let next = 0;
    for (const card of order) {
      if (map.has(card)) continue;
      while (taken.has(next)) next++;
      map.set(card, next++);
    }
    held.cards.set(key, map);
  }
  return held;
}

/**
 * The context as the plan should see it: its card's resume entry in place of its place on the page, or null for a
 * card the page already holds.
 */
export function placeInCard(held: HeldEntries, ctx: FieldContext): FieldContext | null {
  const map = ctx.group ? held.cards.get(ctx.group.key) : undefined;
  if (!map || !ctx.group) return ctx;
  const entry = map.get(ctx.group.index);
  if (entry === null || entry === undefined) return entry === null ? null : ctx;
  return entry === ctx.group.index ? ctx : { ...ctx, group: { ...ctx.group, index: entry } };
}
