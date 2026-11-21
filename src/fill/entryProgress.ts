// What became of each entry of a repeated section filled in place: a card the page had took it, this fill added its
// card, the page already showed it, or no card took it and why. Sections an entry editor fills report their own.
import type { EntryProgress, FieldReport, SectionKey } from '../engine/types';
import type { SectionGrowth } from './ensureCards';

function skipOf(g: SectionGrowth): Pick<EntryProgress, 'reason' | 'button'> {
  if (g.status === 'no_button') return { reason: 'no_button' };
  if (g.capped) return { reason: 'max_adds' };
  return g.label ? { reason: 'add_failed', button: g.label } : { reason: 'add_failed' };
}

/**
 * `growth`: what ensureCards did, for the sections that were short of cards. `shown`: the entries cards on the page
 * already show. `name`: the resume's name for an entry ('' for none). Sections come in page order.
 */
export function entriesInPlace(
  growth: readonly SectionGrowth[],
  fields: readonly FieldReport[],
  shown: ReadonlyMap<SectionKey, ReadonlySet<number>>,
  name: (section: SectionKey, index: number) => string,
): EntryProgress[] {
  const seen = new Map<SectionKey, Set<number>>();
  for (const f of fields) {
    if (f.section === null || f.entry === undefined) continue;
    if (!seen.has(f.section)) seen.set(f.section, new Set());
    seen.get(f.section)!.add(f.entry);
  }
  const sections = [...new Set<SectionKey>([...seen.keys(), ...growth.map((g) => g.section), ...shown.keys()])];

  const out: EntryProgress[] = [];
  for (const section of sections) {
    const held = shown.get(section) ?? new Set<number>();
    const g = growth.find((x) => x.section === section);
    const positions = g
      ? Array.from({ length: Math.max(g.need, ...[...held].map((p) => p + 1)) }, (_, i) => i)
      : [...new Set([...(seen.get(section) ?? []), ...held])].sort((a, b) => a - b);
    // Cards that take one of the resume's entries; the last `added` of them are this fill's.
    const taking = g ? Math.max(0, g.have - held.size) : Number.POSITIVE_INFINITY;
    const existing = g ? Math.max(0, taking - g.added) : Number.POSITIVE_INFINITY;
    let k = 0;
    for (const index of positions) {
      let entry: EntryProgress;
      if (held.has(index)) entry = { section, index, state: 'held' };
      else {
        const state = k < existing ? 'existing' : k < taking ? 'added' : 'skipped';
        k++;
        entry = state === 'skipped' && g ? { section, index, state, ...skipOf(g) } : { section, index, state };
      }
      const label = name(section, index);
      if (label) entry.label = label;
      out.push(entry);
    }
  }
  return out;
}
