// Small presentational pieces of the side panel, written after the design-system components of the same name
// (IconButton, Badge, Notice, Toast, EmptyState, Loading). Styles live in sidepanel.css.
import { useEffect, useState, type ReactNode } from 'react';
import type { Outcome } from '../../src/engine/types';
import { useT, type MessageKey } from '../../src/i18n';
import { Icon, type IconName } from '../../src/ui/Icon';
import { OUTCOME_STATUS, TONE_COLOR_VAR } from '../../src/ui/status';
import { formatConfidence } from './model';

/** Status glyph of an outcome. Its colour is the third signal; the icon shape and the word carry the meaning. */
export function StatusIcon({ outcome, size, labelled = false, word }: { outcome: Outcome; size?: number; labelled?: boolean; word?: MessageKey }) {
  const t = useT();
  const status = OUTCOME_STATUS[outcome];
  return (
    <span className="raf-status-icon" style={{ color: TONE_COLOR_VAR[status.tone] }}>
      <Icon name={status.icon} size={size} label={labelled ? t(word ?? status.labelKey) : undefined} />
    </span>
  );
}

/** Outlined badge: icon + word, 1px outline in the tone colour (never colour alone). */
export function StatusBadge({ outcome, word }: { outcome: Outcome; word?: MessageKey }) {
  const t = useT();
  const status = OUTCOME_STATUS[outcome];
  return (
    <span className="raf-badge" data-tone={status.tone} data-outcome={outcome} style={{ color: TONE_COLOR_VAR[status.tone], borderColor: TONE_COLOR_VAR[status.tone] }}>
      <Icon name={status.icon} size={14} />
      {t(word ?? status.labelKey)}
    </span>
  );
}

/** Neutral badge with the confidence ("85%"); deliberately not coloured. */
export function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  const t = useT();
  return (
    <span className="raf-badge raf-badge-confidence">
      <span className="raf-sr-only">{t('panel.confidence')} </span>
      {formatConfidence(confidence)}
    </span>
  );
}

export interface IconButtonProps {
  icon: IconName;
  /** Accessible name and tooltip (same words, per the design system). */
  label: string;
  onClick: () => void;
  small?: boolean;
}

export function IconButton({ icon, label, onClick, small = false }: IconButtonProps) {
  return (
    <button type="button" className={small ? 'raf-icon-btn raf-icon-btn-small' : 'raf-icon-btn'} aria-label={label} data-tip={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export interface NoticeProps {
  tone?: 'info' | 'danger';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}

/** In-flow message block: tile background, icon + text; `danger` adds a 1px danger outline and `role="alert"`. */
export function Notice({ tone = 'info', title, children, action }: NoticeProps) {
  const danger = tone === 'danger';
  return (
    <div className={danger ? 'raf-notice raf-notice-danger' : 'raf-notice'} {...(danger ? { role: 'alert' } : {})}>
      <Icon name={danger ? 'exclamation-triangle' : 'info-circle'} />
      <div className="raf-notice-text">
        {title ? <span className="raf-notice-title">{title}</span> : null}
        {children}
        {action ? <div className="raf-notice-actions">{action}</div> : null}
      </div>
    </div>
  );
}

const TOAST_MS = 5000;

/** Inverted one-line confirmation. Goes away after 5 s; hovering or focusing it pauses the timer. */
export function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(id);
  }, [paused, onDismiss]);
  return (
    <div
      className="raf-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name="check-lg" size={16} />
      <span>{text}</span>
      <IconButton icon="x-lg" label={t('panel.dismiss')} onClick={onDismiss} small />
    </div>
  );
}

/**
 * Tile icon + (optional title) + caption. The tile has a 1px line so it reads on `paper`. By default it fills the
 * free height of the page and centres its content; `compact` keeps it in flow (e.g. under the filter chips).
 */
export function EmptyState({
  icon,
  title,
  text,
  compact = false,
  action,
}: {
  icon: IconName;
  title?: string;
  text: string;
  compact?: boolean;
  /** One button under the caption, e.g. the way to the profile page. */
  action?: ReactNode;
}) {
  return (
    <div className={compact ? 'raf-empty raf-empty-compact' : 'raf-empty'}>
      <span className="raf-empty-tile">
        <Icon name={icon} size={24} />
      </span>
      <div className="raf-empty-copy">
        {title ? <p className="raf-empty-title">{title}</p> : null}
        <p className="raf-empty-text">{text}</p>
      </div>
      {action}
    </div>
  );
}

/** Placeholder rows while the report is read. One status announcement for the whole block. */
export function LoadingList({ rows = 4 }: { rows?: number }) {
  const t = useT();
  return (
    <div className="raf-list" role="status" aria-busy="true" aria-label={t('panel.loading')}>
      <span className="raf-sr-only">{t('panel.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="raf-item raf-item-skeleton" aria-hidden="true">
          <span className="raf-skeleton raf-skeleton-tile" />
          <span className="raf-skeleton-lines">
            <span className="raf-skeleton" style={{ width: `${55 + ((i * 13) % 30)}%` }} />
            <span className="raf-skeleton" style={{ width: `${35 + ((i * 17) % 30)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
