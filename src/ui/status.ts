// Shared status vocabulary (DESIGN-SYSTEM §6.3): ONE tone + ONE icon + ONE word per fill outcome, used identically by
// the FAB summary card, the side panel and the options page ("one icon means one thing everywhere").
// A status is always icon + word; colour (the tone) is only the third signal and never carries meaning alone.
import type { Outcome } from '../engine/types';
import type { MessageKey } from '../i18n';
import type { IconName } from './Icon';

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';

export interface OutcomeStatus {
  /** Semantic colour family: `success` / `warning` / `danger` map to `--raf-color-<tone>`, `muted` to `--raf-color-text-muted`. */
  tone: StatusTone;
  icon: IconName;
  /** i18n key of the neutral wording (`status.*`, zh + en). */
  labelKey: MessageKey;
}

export const OUTCOME_STATUS: Record<Outcome, OutcomeStatus> = {
  filled: { tone: 'success', icon: 'check-circle', labelKey: 'status.filled' },
  needs_review: { tone: 'warning', icon: 'exclamation-circle', labelKey: 'status.needs_review' },
  no_option: { tone: 'warning', icon: 'exclamation-circle', labelKey: 'status.no_option' },
  unmatched: { tone: 'danger', icon: 'question-circle', labelKey: 'status.unmatched' },
  action_failed: { tone: 'danger', icon: 'x-circle', labelKey: 'status.action_failed' },
  no_data: { tone: 'muted', icon: 'info-circle', labelKey: 'status.no_data' },
  no_control: { tone: 'muted', icon: 'info-circle', labelKey: 'status.no_control' },
};

/** CSS custom property (colour) of a tone, for inline `color` / `border-color`. */
export const TONE_COLOR_VAR: Record<StatusTone, string> = {
  success: 'var(--raf-color-success)',
  warning: 'var(--raf-color-warning)',
  danger: 'var(--raf-color-danger)',
  muted: 'var(--raf-color-text-muted)',
};

/**
 * Tone groups: the coarser vocabulary of the FAB card stats and the side-panel chips, so the same count means the same
 * thing on both surfaces. Rows keep their precise outcome word (`OUTCOME_STATUS`); only the counts are grouped.
 * `review` = needs_review + no_option, `failed` = unmatched + action_failed, `nodata` = no_data (+ no_control:
 * nothing to act on). `nodata` is shown as one muted sentence in the card, never as a Badge.
 */
export type StatusGroupId = 'filled' | 'review' | 'failed' | 'nodata';

export interface StatusGroup {
  tone: StatusTone;
  icon: IconName;
  /** i18n key of the group word (`status.group.*`, zh + en). */
  labelKey: MessageKey;
}

/** In display order: filled first, then the attention states, then the neutral one. */
export const STATUS_GROUPS: Record<StatusGroupId, StatusGroup> = {
  filled: { tone: 'success', icon: 'check-circle', labelKey: 'status.group.filled' },
  review: { tone: 'warning', icon: 'exclamation-circle', labelKey: 'status.group.review' },
  failed: { tone: 'danger', icon: 'x-circle', labelKey: 'status.group.failed' },
  nodata: { tone: 'muted', icon: 'info-circle', labelKey: 'status.group.nodata' },
};

const OUTCOME_GROUP: Record<Outcome, StatusGroupId> = {
  filled: 'filled',
  needs_review: 'review',
  no_option: 'review',
  unmatched: 'failed',
  action_failed: 'failed',
  no_data: 'nodata',
  no_control: 'nodata',
};

export function groupOf(outcome: Outcome): StatusGroupId {
  return OUTCOME_GROUP[outcome];
}
