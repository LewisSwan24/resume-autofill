// Words for the entries of repeated sections in a fill report, shared by the FAB card and the side panel so both
// say the same thing: the section's name, the state of each entry, its fields by outcome, and why one was skipped.
import type { EntryProgress, FieldReport, SectionKey } from '../engine/types';
import type { MessageKey } from '../i18n';
import type { IconName } from './Icon';
import { groupOf, type StatusTone } from './status';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const sectionLabelKey = (section: SectionKey): MessageKey => `common.section.${section}` as MessageKey;

export interface EntryCounts {
  filled: number;
  review: number;
  failed: number;
  noData: number;
}

/** Each entry with its fields counted by outcome. A card the page already held counts nothing as missing. */
export function countEntries(entries: readonly EntryProgress[], fields: readonly FieldReport[]): Array<EntryProgress & EntryCounts> {
  return entries.map((e) => {
    const out = { ...e, filled: 0, review: 0, failed: 0, noData: 0 };
    for (const f of fields) {
      if (f.section !== e.section || f.entry !== e.index || f.note === 'entry_held') continue;
      const group = groupOf(f.outcome);
      if (group === 'filled') out.filled++;
      else if (group === 'review') out.review++;
      else if (group === 'failed') out.failed++;
      else if (f.outcome === 'no_data') out.noData++;
    }
    return out;
  });
}

/** "已填 6 格，待确认 1 格，简历里没有 1 格": only the outcomes it has. */
export function entryCountsText(t: Translate, c: EntryCounts): string {
  const parts: string[] = [];
  if (c.filled > 0) parts.push(t('common.entry.count.filled', { n: c.filled }));
  if (c.review > 0) parts.push(t('common.entry.count.review', { n: c.review }));
  if (c.failed > 0) parts.push(t('common.entry.count.failed', { n: c.failed }));
  if (c.noData > 0) parts.push(t('common.entry.count.noData', { n: c.noData }));
  return parts.length > 0 ? parts.join(t('common.entry.sep')) : t('common.entry.count.none');
}

/** Why an entry was skipped, in words. */
export function entryReasonText(t: Translate, e: Pick<EntryProgress, 'reason' | 'button'>): string {
  if (e.reason === 'add_failed') return e.button ? t('common.entry.reason.add_failed', { button: e.button }) : t('common.entry.reason.add_failed.plain');
  return t(`common.entry.reason.${e.reason ?? 'add_failed'}` as MessageKey, { button: e.button ?? '' });
}

/** What the entry's line says after its name: what it holds, why it was skipped, or that the page had it. */
export function entryWhyText(t: Translate, e: EntryProgress & EntryCounts): string {
  if (e.state === 'skipped') return entryReasonText(t, e);
  if (e.state === 'held') return t('common.entry.heldWhy');
  return entryCountsText(t, e);
}

export interface EntryStatus {
  tone: StatusTone;
  icon: IconName;
  labelKey: MessageKey;
}

/** The status word of an entry (src/ui/status.ts vocabulary): filled = success, to review = warning, skipped = danger, page's own = muted. */
export function entryStatus(e: EntryProgress & EntryCounts): EntryStatus {
  if (e.state === 'skipped') return { tone: 'danger', icon: 'x-circle', labelKey: 'common.entry.state.skipped' };
  if (e.state === 'held') return { tone: 'muted', icon: 'info-circle', labelKey: 'common.entry.state.held' };
  if (e.review + e.failed > 0) return { tone: 'warning', icon: 'exclamation-circle', labelKey: 'common.entry.pill.review' };
  // None of its fields was found: nothing to call filled.
  if (e.filled + e.noData === 0) return { tone: 'muted', icon: 'info-circle', labelKey: `common.entry.state.${e.state}` as MessageKey };
  return { tone: 'success', icon: 'check-circle', labelKey: 'common.entry.pill.done' };
}
