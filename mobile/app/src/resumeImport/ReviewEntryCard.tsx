// One entry of a list module on the review (an education, a job...): its heading and summary, 不导入这条, and when
// merging whether it is new or goes into an existing entry. Left out, it folds to one row with 恢复. Focus follows:
// to 恢复 when left out, back to the heading when put back.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { PlannedEntry } from './merge';

export interface ReviewEntryCardProps {
  /** `education.1`: the review's entry key. */
  entryKey: string;
  /** "{module} {n}" */
  title: string;
  /** entrySummary of what was read, '' when nothing identifies it. */
  summary: string;
  dropped: boolean;
  /** Merge only. */
  planned: PlannedEntry | null;
  disabled: boolean;
  onDrop: () => void;
  onRestore: () => void;
  children: ReactNode;
}

export function ReviewEntryCard({ title, summary, dropped, planned, disabled, onDrop, onRestore, children }: ReviewEntryCardProps) {
  const t = useMT();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const name = summary || title;

  // Only a change made here moves the focus, not the first render.
  const previous = useRef(dropped);
  useEffect(() => {
    if (previous.current === dropped) return;
    previous.current = dropped;
    if (dropped) restore.current?.focus();
    else heading.current?.focus({ preventScroll: true });
  }, [dropped]);

  if (dropped) {
    return (
      <div className="m-card m-ri-entry m-ri-entry--dropped">
        <span className="m-ri-entry__dropped">{t('m.ri.dropped', { name })}</span>
        <button
          ref={restore}
          type="button"
          className="m-button m-button--text"
          aria-label={t('m.ri.restoreLabel', { name })}
          disabled={disabled}
          onClick={onRestore}
        >
          <Icon name="arrow-counterclockwise" />
          <span>{t('m.ri.restore')}</span>
        </button>
      </div>
    );
  }

  return (
    <section className="m-card m-card--padded m-ri-entry" aria-labelledby={headingId}>
      <div className="m-ri-entry__head">
        <div className="m-ri-entry__titles">
          <h3 ref={heading} id={headingId} className="m-ri-entry__title" tabIndex={-1}>
            {title}
          </h3>
          {summary ? <p className="m-row__caption">{summary}</p> : null}
          {planned ? (
            <p className="m-help">
              <Icon name={planned.matchIndex === null ? 'plus-lg' : 'box-arrow-in-down'} />
              <span>{planned.matchIndex === null ? t('m.ri.newEntry') : t('m.ri.matchedEntry', { name: planned.matchLabel })}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="m-button m-button--text"
          aria-label={t('m.ri.dropEntryLabel', { name })}
          disabled={disabled}
          onClick={onDrop}
        >
          <Icon name="dash-circle" />
          <span>{t('m.ri.dropEntry')}</span>
        </button>
      </div>
      <div className="m-ri-entry__rows">{children}</div>
    </section>
  );
}
