// Result card (design-system Popover geometry): stat Badges, the fields that need attention, and shortcuts.
// Receives only labels + outcomes (see summarize.ts) — never resume values.
// Words and icons for outcomes come from the shared status vocabulary (src/ui/status.ts), so the card says the
// same thing as the side panel.
import { useEffect, useId } from 'react';
import { useT } from '../../src/i18n';
import { Icon } from '../../src/ui/Icon';
import { OUTCOME_STATUS, STATUS_GROUPS, TONE_COLOR_VAR, type StatusGroupId } from '../../src/ui/status';
import { Badge, Button, IconButton } from './parts';
import type { FillSummary, SummaryItem } from './summarize';
import type { AdvanceStop } from '../../src/background/wizardSession';

/** Auto-advance through a multi-step application: offer it, show the run, or say why it stopped. */
export interface AdvanceView {
  /** This step has a Next button and the run has not started. */
  offer: boolean;
  /** Steps moved on so far while a run is going; null when none is. */
  running: number | null;
  stopReason: AdvanceStop | null;
  /** The run moved on to this step and found nothing on it to fill: the last numbers were another step's. */
  emptyStep?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export interface SummaryCardProps {
  /** Present after a fill; `null` when showing an error or preview prompt. */
  summary: FillSummary | null;
  /** Present when the fill request failed. */
  error: string | null;
  /** Present when `previewBeforeFill` produced a side-panel preview. */
  previewReady?: boolean;
  /** The card is playing its exit animation (it can no longer be used). */
  leaving?: boolean;
  /** Called once the exit animation is over (or would have been). */
  onSettled?: () => void;
  onClose: () => void;
  onFocusField: (item: SummaryItem) => void;
  onOpenSidePanel: () => void;
  onOpenOptions: () => void;
  /** "Add them to your profile": the profile page, at the first field with no data. */
  onFillMissing: () => void;
  advance?: AdvanceView;
}

/** Longer than `--raf-motion-settle` (160ms): fallback in case `animationend` never fires. */
const SETTLE_FALLBACK_MS = 260;

/** The three stat badges (tone groups, see STATUS_GROUPS), in this order; "no data" is a sentence, not a fourth badge (max 3 badges per row). */
type StatGroup = Exclude<StatusGroupId, 'nodata'>;

function ItemRow({ item, onFocusField }: { item: SummaryItem; onFocusField: (item: SummaryItem) => void }) {
  const t = useT();
  const nameId = useId();
  const status = OUTCOME_STATUS[item.outcome];
  const unnamed = item.label === '';
  return (
    <li className="raf-list-item" data-testid="raf-item">
      <span id={nameId} className="raf-list-item__name" data-empty={unnamed} title={unnamed ? undefined : item.label}>
        {unnamed ? t('fab.item.unnamed') : item.label}
      </span>
      <Badge icon={status.icon} tone={status.tone} text={t(status.labelKey)} />
      <IconButton icon="search" label={t('fab.item.locate')} aria-describedby={nameId} onClick={() => onFocusField(item)} />
    </li>
  );
}

export function SummaryCard({
  summary,
  error,
  previewReady = false,
  leaving = false,
  onSettled,
  onClose,
  onFocusField,
  onOpenSidePanel,
  onOpenOptions,
  onFillMissing,
  advance,
}: SummaryCardProps) {
  const t = useT();

  useEffect(() => {
    if (!leaving || !onSettled) return;
    const timer = setTimeout(onSettled, SETTLE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving, onSettled]);

  let badges: Array<{ group: StatGroup; n: number }> = [];
  if (summary) {
    badges = (
      [
        { group: 'filled', n: summary.filled },
        { group: 'review', n: summary.review },
        { group: 'failed', n: summary.unrecognized },
      ] satisfies Array<{ group: StatGroup; n: number }>
    ).filter((b) => b.n > 0);
    // Never an empty row: when nothing was filled and nothing needs a look, still say "Filled 0".
    if (badges.length === 0) badges = [{ group: 'filled', n: 0 }];
  }

  return (
    <section
      className="raf-card"
      role="dialog"
      aria-label={t('fab.card.title')}
      data-testid="raf-card"
      data-tone={error ? 'error' : 'result'}
      data-state={leaving ? 'leaving' : 'open'}
      inert={leaving}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onSettled?.();
      }}
    >
      <header className="raf-card__head">
        <h2 className="raf-card__title">{t('fab.card.title')}</h2>
        <IconButton icon="x-lg" label={t('fab.card.close')} onClick={onClose} />
      </header>

      <div className="raf-card__content">
        {advance && advance.running !== null && (
          <div className="raf-notice" role="status" data-testid="raf-advance-running">
            <span className="raf-spinner" role="presentation" />
            <p className="raf-notice__text">{t('common.advance.running', { n: advance.running })}</p>
            <div className="raf-notice__actions">
              <Button onClick={advance.onStop}>{t('common.advance.stop')}</Button>
            </div>
          </div>
        )}
        {advance && advance.running === null && advance.stopReason && (
          <div className="raf-notice" role="status" data-testid="raf-advance-stopped">
            <Icon name="info-circle" />
            <p className="raf-notice__text">{t(`common.advance.stop.${advance.stopReason}`)}</p>
          </div>
        )}
        {summary && (
          <>
            <div className="raf-card__stats" data-testid="raf-stats">
              {badges.map((b) => {
                const status = STATUS_GROUPS[b.group];
                return <Badge key={b.group} icon={status.icon} tone={status.tone} text={`${t(status.labelKey)} ${b.n}`} />;
              })}
            </div>
            {summary.noData > 0 && (
              <div className="raf-card__nodata">
                <p className="raf-card__note" data-testid="raf-nodata">
                  {t(summary.noData === 1 ? 'fab.card.noData.one' : 'fab.card.noData.other', { n: summary.noData })}
                </p>
                <Button onClick={onFillMissing}>{t('fab.card.addMissing')}</Button>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="raf-notice raf-notice--danger" role="alert">
            <Icon name="exclamation-triangle" />
            <p className="raf-notice__text">
              <span className="raf-notice__title">{t('fab.error.title')}</span>
              {error}
            </p>
            <div className="raf-notice__actions">
              <Button onClick={onOpenOptions}>{t('fab.error.openOptions')}</Button>
            </div>
          </div>
        )}

        {previewReady && (
          <div className="raf-notice" role="status" data-testid="raf-preview-ready">
            <Icon name="info-circle" />
            <p className="raf-notice__text">
              <span className="raf-notice__title">{t('fab.preview.title')}</span>
              {t('fab.preview.text')}
            </p>
            <Button variant="primary" block onClick={onOpenSidePanel}>
              {t('fab.preview.open')}
            </Button>
          </div>
        )}

        {!summary && advance?.emptyStep && (
          <div className="raf-notice" role="status" data-testid="raf-advance-empty">
            <Icon name="info-circle" />
            <p className="raf-notice__text">{t('common.advance.emptyStep')}</p>
          </div>
        )}

        {summary && summary.items.length === 0 && summary.noData === 0 && (
          <div className="raf-notice" role="status" data-testid="raf-alldone">
            <span className="raf-notice__icon" style={{ color: TONE_COLOR_VAR.success }}>
              <Icon name="check-circle" />
            </span>
            <p className="raf-notice__text">{t('fab.card.allDone')}</p>
          </div>
        )}

        {summary && summary.items.length > 0 && (
          <>
            <h3 className="raf-card__list-title">{t('fab.card.listTitle')}</h3>
            <ul className="raf-list" data-testid="raf-list">
              {summary.items.map((item) => (
                <ItemRow key={`${item.frameId}:${item.fieldId}`} item={item} onFocusField={onFocusField} />
              ))}
            </ul>
          </>
        )}

        {advance && advance.offer && advance.running === null && (
          <div className="raf-card__advance" data-testid="raf-advance-offer">
            <p className="raf-card__note">{t('common.advance.hint')}</p>
            <Button block data-testid="raf-advance-start" onClick={advance.onStart}>
              {t('common.advance.start')}
            </Button>
          </div>
        )}

        {summary && (
          <Button variant="primary" block onClick={onOpenSidePanel}>
            {t('fab.card.sidepanel')}
          </Button>
        )}
      </div>
    </section>
  );
}
