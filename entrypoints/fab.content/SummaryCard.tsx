// Result card: counts, the list of fields that need attention, and shortcuts.
// Receives only labels + outcomes (see summarize.ts) — never resume values.
import { Fragment } from 'react';
import { useT, type MessageKey } from '../../src/i18n';
import type { FillSummary, SummaryItem, SummaryOutcome } from './summarize';

export interface SummaryCardProps {
  /** Present after a fill; `null` when showing an error. */
  summary: FillSummary | null;
  /** Present when the fill request failed. */
  error: string | null;
  onClose: () => void;
  onFocusField: (item: SummaryItem) => void;
  onOpenSidePanel: () => void;
  onOpenOptions: () => void;
}

const OUTCOME_TONE: Record<SummaryOutcome, 'warning' | 'danger' | 'muted'> = {
  needs_review: 'warning',
  no_option: 'warning',
  unmatched: 'danger',
  action_failed: 'danger',
  no_data: 'muted',
};

function CloseGlyph() {
  return (
    <svg className="raf-fab__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SummaryCard({ summary, error, onClose, onFocusField, onOpenSidePanel, onOpenOptions }: SummaryCardProps) {
  const t = useT();

  type Stat = { key: MessageKey; n: number; tone: string; always: boolean };
  const stats: Stat[] = summary
    ? (
        [
          { key: 'fab.count.filled', n: summary.filled, tone: 'success', always: true },
          { key: 'fab.count.review', n: summary.review, tone: 'warning', always: true },
          { key: 'fab.count.unrecognized', n: summary.unrecognized, tone: 'danger', always: true },
          // "No data" is a muted fourth count; only shown when it applies.
          { key: 'fab.count.noData', n: summary.noData, tone: 'muted', always: false },
        ] satisfies Stat[]
      ).filter((s) => s.always || s.n > 0)
    : [];

  return (
    <section
      className="raf-card"
      role="dialog"
      aria-label={t(error ? 'fab.error.title' : 'fab.card.title')}
      data-testid="raf-card"
      data-tone={error ? 'error' : 'result'}
    >
      <header className="raf-card__header">
        <h2 className="raf-card__title">{t(error ? 'fab.error.title' : 'fab.card.title')}</h2>
        <button type="button" className="raf-icon-button" aria-label={t('fab.card.close')} onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>

      {summary && (
        <div className="raf-card__stats" data-testid="raf-stats">
          {stats.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 && (
                <span className="raf-stat__sep" aria-hidden="true">
                  ·
                </span>
              )}
              <span className="raf-stat" data-tone={s.tone}>
                {t(s.key, { n: s.n })}
              </span>
            </Fragment>
          ))}
        </div>
      )}

      <div className="raf-card__body">
        {error && (
          <p className="raf-card__message" data-tone="danger" role="alert">
            {error}
          </p>
        )}
        {summary && summary.items.length === 0 && <p className="raf-card__message">{t('fab.card.allDone')}</p>}
        {summary && summary.items.length > 0 && (
          <>
            <h3 className="raf-card__list-title">{t('fab.card.listTitle')}</h3>
            <ul className="raf-list">
              {summary.items.map((item) => (
                <li key={`${item.frameId}:${item.fieldId}`}>
                  <button
                    type="button"
                    className="raf-item"
                    title={t('fab.item.locate')}
                    onClick={() => onFocusField(item)}
                  >
                    <span className="raf-item__label" data-empty={item.label === ''}>
                      {item.label || t('fab.item.unnamed')}
                    </span>
                    <span className="raf-tag" data-tone={OUTCOME_TONE[item.outcome]}>
                      {t(`fab.outcome.${item.outcome}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <footer className="raf-card__footer">
        {error ? (
          <button type="button" className="raf-button" data-variant="primary" onClick={onOpenOptions}>
            {t('fab.error.openOptions')}
          </button>
        ) : (
          <button type="button" className="raf-button" onClick={onOpenSidePanel}>
            {t('fab.card.sidepanel')}
          </button>
        )}
      </footer>
    </section>
  );
}
