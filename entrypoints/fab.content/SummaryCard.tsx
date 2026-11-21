// Result card (design-system Popover geometry): stat Badges, the entries of repeated sections, every field not
// filled in groups by reason, and shortcuts. Receives what summarize.ts gives it: labels, outcomes, where each field
// sits, entry names, and option text the page already shows.
// Words and icons for outcomes come from the shared status vocabulary (src/ui/status.ts), so the card says the
// same thing as the side panel.
import { useEffect, useId, useState, type CSSProperties } from 'react';
import { useT } from '../../src/i18n';
import { entryStatus, entryWhyText, sectionLabelKey } from '../../src/ui/entryText';
import { Icon, type IconName } from '../../src/ui/Icon';
import { OUTCOME_STATUS, STATUS_GROUPS, TONE_COLOR_VAR, type StatusGroupId, type StatusTone } from '../../src/ui/status';
import { Badge, Button, IconButton } from './parts';
import type { EntrySummary, FillSummary, SummaryGroup, SummaryGroupId, SummaryItem } from './summarize';
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

/** The three stat badges (tone groups, see STATUS_GROUPS), in this order; "no data" is a group of rows, not a fourth badge (max 3 badges per row). */
type StatGroup = Exclude<StatusGroupId, 'nodata'>;

/** Each group of rows by its reason: the outcome's own word and icon (src/ui/status.ts). */
const GROUP_LOOK: Record<SummaryGroupId, { tone: StatusTone; icon: IconName; labelKey: (typeof OUTCOME_STATUS)['filled']['labelKey'] }> = {
  review: OUTCOME_STATUS.needs_review,
  no_option: OUTCOME_STATUS.no_option,
  failed: OUTCOME_STATUS.unmatched,
  nodata: OUTCOME_STATUS.no_data,
};

/** Names a closed group shows under its title. */
const NAMES_SHOWN = 3;

const itemKey = (item: SummaryItem) => `${item.frameId}:${item.fieldId}`;

function ItemRow({
  item,
  current,
  onFocusField,
}: {
  item: SummaryItem;
  current: boolean;
  onFocusField: (item: SummaryItem) => void;
}) {
  const t = useT();
  const nameId = useId();
  const unnamed = item.label === '';
  const crumb = [
    item.section ? t(sectionLabelKey(item.section)) : '',
    item.entry !== undefined ? t('common.entry.number', { n: item.entry + 1 }) : '',
    item.outcome === 'action_failed' ? t('status.action_failed') : '',
    item.note === 'same_file_held' ? t('fab.item.sameFile') : '',
    item.note === 'sensitive_held' ? t('fab.item.sensitiveHeld') : '',
  ].filter(Boolean);
  return (
    <li
      className="raf-list-item"
      data-testid="raf-item"
      aria-current={current ? 'true' : undefined}
      // The whole row points at its field; the button is the same action for the keyboard.
      onClick={(e) => {
        if (!(e.target as Element).closest('button')) onFocusField(item);
      }}
    >
      <span className="raf-list-item__text">
        <span id={nameId} className="raf-list-item__name" data-empty={unnamed} title={unnamed ? undefined : item.label}>
          {unnamed ? t('fab.item.unnamed') : item.label}
        </span>
        {crumb.length > 0 && <span className="raf-list-item__crumb">{crumb.join(' · ')}</span>}
        {item.picked && (
          <span className="raf-list-item__pick">
            <Icon name="arrow-left-right" size={14} />
            {t('fab.item.picked', { option: item.picked })}
          </span>
        )}
      </span>
      <IconButton icon="search" label={t('fab.item.locate')} aria-describedby={nameId} onClick={() => onFocusField(item)} />
    </li>
  );
}

function GroupBox({
  group,
  current,
  onFocusField,
  onFillMissing,
}: {
  group: SummaryGroup;
  current: string | null;
  onFocusField: (item: SummaryItem) => void;
  onFillMissing: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const look = GROUP_LOOK[group.id];
  const names = group.items.slice(0, NAMES_SHOWN).map((i) => i.label || t('fab.item.unnamed'));
  const more = group.items.length > NAMES_SHOWN;
  return (
    <details className="raf-group" data-testid="raf-group" data-group={group.id} open={open}>
      <summary
        className="raf-group__head"
        data-testid={`raf-group-head-${group.id}`}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <span className="raf-group__icon" style={{ color: TONE_COLOR_VAR[look.tone] }}>
          <Icon name={look.icon} />
        </span>
        <span className="raf-group__text">
          <span className="raf-group__title">{t(look.labelKey)}</span>
          {!open && (
            <span className="raf-group__names">
              {more ? t('fab.group.more', { names: names.join(t('fab.group.sep')) }) : names.join(t('fab.group.sep'))}
            </span>
          )}
        </span>
        <span className="raf-group__count" style={{ '--raf-badge-tone': TONE_COLOR_VAR[look.tone] } as CSSProperties}>
          {group.items.length}
        </span>
        <span className="raf-group__chevron">
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
      </summary>
      {open && (
        <>
          <ul className="raf-list" data-testid="raf-list">
            {group.items.map((item) => (
              <ItemRow key={itemKey(item)} item={item} current={current === itemKey(item)} onFocusField={onFocusField} />
            ))}
          </ul>
          {group.id === 'nodata' && (
            <div className="raf-group__foot">
              <Button onClick={onFillMissing}>{t('fab.card.addMissing')}</Button>
            </div>
          )}
        </>
      )}
    </details>
  );
}

/** A section is worth a line when it has more than one entry, or an entry added, skipped or held: not one card that was there. */
function sectionsWorthShowing(entries: readonly EntrySummary[]): EntrySummary[][] {
  const sections = [...new Set(entries.map((e) => e.section))].map((section) => entries.filter((e) => e.section === section));
  return sections.filter((list) => list.length > 1 || list.some((e) => e.state !== 'existing'));
}

/** The section's own status: its worst entry (skipped, then to review), else filled. */
const SECTION_RANK: Record<StatusTone, number> = { danger: 0, warning: 1, success: 2, muted: 3 };

function EntrySection({ list }: { list: readonly EntrySummary[] }) {
  const t = useT();
  const statuses = list.map(entryStatus);
  const worst = [...statuses].sort((a, b) => SECTION_RANK[a.tone] - SECTION_RANK[b.tone])[0]!;
  // Open by itself when something in it wants a look.
  const [open, setOpen] = useState(worst.tone === 'danger' || worst.tone === 'warning');
  const placed = list.filter((e) => e.state !== 'skipped').length;
  const section = list[0]!.section;
  return (
    <details className="raf-entries__sec" open={open}>
      <summary
        className="raf-entries__head"
        data-testid={`raf-entries-head-${section}`}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <span className="raf-entries__name">{t(sectionLabelKey(section))}</span>
        <span className="raf-card__note">{t('fab.entries.count', { n: placed, total: list.length })}</span>
        <Badge icon={worst.icon} tone={worst.tone} text={t(worst.labelKey)} />
        <span className="raf-group__chevron">
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
      </summary>
      {open &&
        list.map((e, i) => {
          const status = statuses[i]!;
          const why = entryWhyText(t, e);
          return (
            <div key={e.index} className="raf-entry" data-testid="raf-entry" data-state={e.state}>
              <span className="raf-entry__no">{e.index + 1}</span>
              <span className="raf-entry__main">
                <span className="raf-entry__title">
                  {`${t('common.entry.number', { n: e.index + 1 })} · ${t(`common.entry.state.${e.state}`)}`}
                </span>
                <span className="raf-entry__why">{e.label ? `${e.label} · ${why}` : why}</span>
              </span>
              <Badge icon={status.icon} tone={status.tone} text={t(status.labelKey)} />
            </div>
          );
        })}
    </details>
  );
}

function EntriesBlock({ sections }: { sections: readonly EntrySummary[][] }) {
  const t = useT();
  return (
    <div className="raf-entries" data-testid="raf-entries" role="group" aria-label={t('fab.entries.title')}>
      {sections.map((list) => (
        <EntrySection key={list[0]!.section} list={list} />
      ))}
    </div>
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
  /** The row last pointed at: it stays picked out while the card is open. */
  const [current, setCurrent] = useState<string | null>(null);
  const focusField = (item: SummaryItem) => {
    setCurrent(itemKey(item));
    onFocusField(item);
  };

  useEffect(() => {
    if (!leaving || !onSettled) return;
    const timer = setTimeout(onSettled, SETTLE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving, onSettled]);

  const entrySections = summary ? sectionsWorthShowing(summary.entries) : [];
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
            {entrySections.length > 0 && <EntriesBlock sections={entrySections} />}
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

        {summary && summary.groups.length === 0 && (
          <div className="raf-notice" role="status" data-testid="raf-alldone">
            <span className="raf-notice__icon" style={{ color: TONE_COLOR_VAR.success }}>
              <Icon name="check-circle" />
            </span>
            <p className="raf-notice__text">{t('fab.card.allDone')}</p>
          </div>
        )}

        {summary && summary.groups.length > 0 && (
          <div className="raf-groups" data-testid="raf-groups">
            {summary.groups.map((group) => (
              <GroupBox key={group.id} group={group} current={current} onFocusField={focusField} onFillMissing={onFillMissing} />
            ))}
          </div>
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
