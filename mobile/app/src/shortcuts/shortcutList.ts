// Launcher shortcuts for applications. They carry the record id only: the launcher stores shortcut
// intents in plain text, so no URL ever goes there. The labels show the company, as the privacy page says.
import type { ShortcutItem } from '../native/appShortcuts';
import type { AppState, ApplicationRecord } from '../store/appStateStore';
import { displayName, nativeSafeId } from '../tracker/model/records';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const SHORT_MAX = 10;
const LONG_MAX = 25;

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

function clip(text: string, max: number): string {
  const parts = graphemes(text);
  return parts.length <= max ? text : parts.slice(0, max).join('');
}

/** The application the person opened last that is still going (not 结束). */
export function lastApplication(records: readonly ApplicationRecord[]): ApplicationRecord | null {
  let best: ApplicationRecord | null = null;
  for (const r of records) {
    if (r.status === 'closed') continue;
    if (!best || r.openedAt > best.openedAt) best = r;
  }
  return best;
}

export function shortcutItemFor(record: ApplicationRecord, t: Translate, kind: 'dynamic' | 'pinned'): ShortcutItem {
  const name = displayName(record);
  return {
    id: kind === 'dynamic' ? 'last-application' : `app-${record.id}`,
    recordId: record.id,
    shortLabel: clip(name, SHORT_MAX),
    longLabel: clip(t('m.sc.continue', { name }), LONG_MAX),
  };
}

export interface ShortcutSync {
  dynamic: ShortcutItem[];
  liveRecordIds: string[];
  disabledMessage: string;
}

export function buildShortcutSync(state: AppState, t: Translate): ShortcutSync {
  // An id native code would refuse makes it reject the whole sync; such a record simply gets no shortcut.
  const records = state.applications.filter((r) => nativeSafeId(r.id));
  const last = lastApplication(records);
  return {
    dynamic: last ? [shortcutItemFor(last, t, 'dynamic')] : [],
    liveRecordIds: records.map((r) => r.id),
    disabledMessage: t('m.sc.deleted'),
  };
}
