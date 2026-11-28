// The fill report: a non-modal docked sheet, so the page stays usable above it and a tapped row scrolls its field
// into view there. Three tabs (已填 / 待你看 / 跳过), each split by reason; rows say which entry they belong to
// (第 n 条) and why they need a look; 已填 lists the entries of repeated sections. A tapped row folds the sheet into a
// bar with previous / next, so the person can walk the page field by field. Above the tabs: auto-advance (the offer,
// or why it stopped and what each step got). Below: notes, what was handed to the page, and the footer: the app never
// submits, undo this fill (once), done. After undo it shows what came back and what the person must change back.
import { useId, useState } from 'react';
import { retrieveBm25Matches } from '../../../../src/ai/bm25';
import type { Resume } from '../../../../src/schema';
import type { SectionKey } from '../../../../src/schema/fieldKeys';
import { entryStatus, entryWhyText, sectionLabelKey as entrySectionKey } from '../../../../src/ui/entryText';
import { OUTCOME_STATUS } from '../../../../src/ui/status';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';
import { stopAction, type AdvanceStop, type StepSummary } from './model/advance';
import { neighbour, position, type EntrySection, type GroupId, type ReportModel, type ReportRow } from './model/reportModel';

const GROUPS: readonly GroupId[] = ['filled', 'attention', 'skipped'];

/** Section names come from the module names; the two sections without a module of their own borrow the nearest. */
const SECTION_MODULE: Partial<Record<SectionKey, string | null>> = { internship: 'work', selfIntro: 'about', other: null };
export function sectionLabelKey(section: SectionKey | null): string | null {
  if (!section) return null;
  const module = section in SECTION_MODULE ? SECTION_MODULE[section] : section;
  return module ? `options.module.${module}` : null;
}

const STATUS_ICONS: Record<string, IconName> = {
  'check-circle': 'check-circle',
  'exclamation-circle': 'exclamation-circle',
  'question-circle': 'question-circle',
  'x-circle': 'x-circle',
  'info-circle': 'info-circle',
};

const SECTION_ICONS: Partial<Record<SectionKey, IconName>> = {
  education: 'mortarboard',
  work: 'briefcase',
  internship: 'briefcase',
  projects: 'kanban',
  campus: 'people',
  awards: 'trophy',
  languages: 'translate',
};

/** Auto-advance as the report shows it: the offer after a fill, or the stop and the steps it went through. */
export interface ReportAdvance {
  offer: { step: number; title: string | null } | null;
  stop: { reason: AdvanceStop; moved: number } | null;
  steps: readonly StepSummary[];
  /** 0-based step of this page in `steps`, or -1. */
  here: number;
  onStart: () => void;
  /** Go on after a stop that the person has dealt with (needs_you, verification, a page that did not move, 15 steps). */
  onResume: () => void;
}

export interface ReportSheetProps {
  open: boolean;
  model: ReportModel | null;
  /** Undo is offered only while the filled document is still the top one. */
  canUndo: boolean;
  /** 「没有{language}简历，这次用「{name}」填写。」 when the fill language fell back; null otherwise. */
  fallbackNote: string | null;
  /** Frames that got the fill but sent no report: the page may have changed without rows to show. */
  unanswered?: number;
  resume?: Resume | null;
  advance?: ReportAdvance | null;
  onLocate: (row: ReportRow) => void;
  onUndo: () => void;
  onClose: () => void;
  /** 「这次填上」 on a sensitive field the settings held back. */
  onFillOne?: (row: ReportRow) => void;
  /** 「改设置」 on that row: the sensitive-field setting. */
  onChangeSensitive?: () => void;
  /** 「去简历里补上」 under the skipped rows. */
  onGoToResume?: () => void;
}

export function ReportSheet(props: ReportSheetProps) {
  const t = useMT();
  const { open, model, advance = null, onClose } = props;
  const [located, setLocated] = useState<{ key: string; group: GroupId } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [group, setGroup] = useState<GroupId | null>(null);
  // A new report (another fill, an undo) starts from its own first tab; a row filled by 「这次填上」 leaves the tab
  // as it is. A rescan of the page rebuilds the model with the same rows and changes nothing here.
  const all = model ? Object.values(model.rows).flat() : [];
  const rowsSig = all.map((r) => r.key).sort().join(',') + (model?.undo ? '|undone' : '');
  const outcomeSig = all.map((r) => `${r.key}=${r.outcome}`).sort().join(',');
  const [seen, setSeen] = useState({ rowsSig, outcomeSig });
  if (seen.rowsSig !== rowsSig || seen.outcomeSig !== outcomeSig) {
    setSeen({ rowsSig, outcomeSig });
    setLocated(null);
    if (seen.rowsSig !== rowsSig) setGroup(null);
  }
  // A new stop starts compact again; the same stop rebuilt by a render keeps what the person opened.
  const stopKey = advance?.stop ? `${advance.stop.reason}:${advance.stop.moved}` : '';
  const [seenStop, setSeenStop] = useState(stopKey);
  if (stopKey !== seenStop) {
    setSeenStop(stopKey);
    setExpanded(false);
  }

  const close = () => {
    setLocated(null);
    onClose();
  };
  const row = located && model ? all.find((r) => r.key === located.key) : undefined;
  const compactStop = !!advance?.stop && !expanded && !located && (stopAction(advance.stop.reason) === 'resume' || stopAction(advance.stop.reason) === 'continue');
  const title = row ? (row.label ?? t('fab.item.unnamed')) : compactStop ? t('m.br.adv.stopped') : t('m.br.report.title');
  const className = ['m-br-sheet--report', row ? 'm-br-sheet--bar' : ''].filter(Boolean).join(' ');

  return (
    <DockedSheet open={open && model !== null} title={title} onClose={close} className={className}>
      {model && row && located ? (
        <LocateBar
          model={model}
          row={row}
          group={located.group}
          onGo={(next) => {
            setLocated({ key: next.key, group: located.group });
            props.onLocate(next);
          }}
          onList={() => setLocated(null)}
        />
      ) : model && compactStop && advance ? (
        <StopCompact advance={advance} onResume={advance.onResume} onSee={() => setExpanded(true)} />
      ) : model ? (
        <ReportBody
          {...props}
          model={model}
          advance={advance}
          group={group ?? model.initialGroup}
          onGroup={setGroup}
          onLocate={(r, g) => {
            setLocated({ key: r.key, group: g });
            props.onLocate(r);
          }}
          onClose={close}
        />
      ) : null}
    </DockedSheet>
  );
}

type BodyProps = Omit<ReportSheetProps, 'open' | 'model' | 'onLocate'> & {
  model: ReportModel;
  group: GroupId;
  onGroup: (g: GroupId) => void;
  onLocate: (row: ReportRow, group: GroupId) => void;
};

function ReportBody(p: BodyProps) {
  const t = useMT();
  const id = useId();
  const { model, group, unanswered = 0, fallbackNote, canUndo, resume = null } = p;
  const [handedOpen, setHandedOpen] = useState(false);
  const join = t('m.br.file.typesJoin');

  const notes: { icon: IconName; text: string; warn?: boolean }[] = [];
  if (unanswered > 0 && !model.undo) notes.push({ icon: 'exclamation-circle', text: t('m.br.report.unanswered'), warn: true });
  if (fallbackNote) notes.push({ icon: 'info-circle', text: fallbackNote });
  if (model.unreachable > 0) notes.push({ icon: 'exclamation-circle', text: t('m.br.report.unreachable', { n: model.unreachable }), warn: true });
  if (model.isolated === false) notes.push({ icon: 'exclamation-circle', text: t('m.br.isolation.off'), warn: true });

  return (
    <div className="m-sheet-stack">
      {p.advance && !model.undo ? <AdvanceBlock advance={p.advance} onClose={p.onClose} /> : null}
      {model.undo ? (
        <UndoneView model={model} onLocate={(r) => p.onLocate(r, 'attention')} />
      ) : (
        <>
          <div className="m-br-tabs" role="tablist" aria-label={t('m.br.report.groups')}>
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                id={`${id}-tab-${g}`}
                aria-selected={g === group}
                aria-controls={`${id}-panel`}
                className="m-br-tab"
                onClick={() => p.onGroup(g)}
              >
                {t(`m.br.report.${g}`, { n: model.counts[g] })}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${group}`} className="m-br-panel">
            {group === 'filled' && model.entries.length > 0 ? <Entries sections={model.entries} /> : null}
            {model.rows[group].length === 0 ? (
              <p className="m-empty">{t(`m.br.report.empty.${group}`)}</p>
            ) : (
              model.reasons[group].map((reason) => {
                const status = OUTCOME_STATUS[reason.outcome];
                return (
                  <section key={reason.outcome} className={`m-br-reason m-br-reason--${status.tone}`}>
                    <h3 className="m-br-reason__head">
                      <Icon name={STATUS_ICONS[status.icon] ?? 'info-circle'} />
                      <span>{t(status.labelKey)}</span>
                      <span className="m-br-reason__count">{reason.rows.length}</span>
                    </h3>
                    <Rows
                      rows={reason.rows}
                      resume={resume}
                      onLocate={(r) => p.onLocate(r, group)}
                      onFillOne={p.onFillOne}
                      onChangeSensitive={p.onChangeSensitive}
                    />
                  </section>
                );
              })
            )}
            {group === 'skipped' && model.rows.skipped.some((r) => r.outcome === 'no_data') && p.onGoToResume ? (
              <div className="m-br-cta">
                <button type="button" className="m-button m-button--wide" onClick={p.onGoToResume}>
                  <Icon name="pencil" />
                  <span>{t('m.br.report.goFill')}</span>
                </button>
                <p className="m-help">{t('m.br.report.goFillHint')}</p>
              </div>
            ) : null}
          </div>
        </>
      )}

      {notes.map((n) => (
        <p key={n.text} className={n.warn ? 'm-notice m-notice--warning' : 'm-notice'}>
          <Icon name={n.icon} />
          <span>{n.text}</span>
        </p>
      ))}

      {model.handedOver.total > 0 || model.handedOver.files.length > 0 ? (
        <div>
          <button
            type="button"
            className="m-br-disclose"
            aria-expanded={handedOpen}
            aria-controls={`${id}-handed`}
            onClick={() => setHandedOpen((o) => !o)}
          >
            <span>{t('m.br.report.handedOver', { n: model.handedOver.total })}</span>
            <Icon name={handedOpen ? 'chevron-up' : 'chevron-down'} />
          </button>
          {handedOpen ? (
            <ul className="m-br-handed" id={`${id}-handed`}>
              {model.handedOver.fields.map((f) => (
                <li key={f.moduleLabelKey}>
                  {t('m.br.report.handedLine', { module: t(f.moduleLabelKey), labels: f.labels.map((l) => t(l)).join(join) })}
                </li>
              ))}
              {model.handedOver.wholeSections.map((s) => (
                <li key={s.section}>{t('m.br.report.wholeSection', { section: t(sectionLabelKey(s.section) ?? s.section), n: s.entries })}</li>
              ))}
              {model.handedOver.files.length > 0 ? <li>{t('m.br.report.files', { names: model.handedOver.files.join(join) })}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      {model.handedOver.otherSites.length > 0 ? (
        <p className="m-sheet-text">{t('m.br.report.otherSites', { hosts: model.handedOver.otherSites.join(join) })}</p>
      ) : null}

      <div className="m-br-report__foot">
        <p className="m-notice">
          <Icon name="send-slash" />
          <span>{t('m.br.report.noSubmit')}</span>
        </p>
        {!model.undo && canUndo ? (
          <button type="button" className="m-button m-button--wide" onClick={p.onUndo}>
            <Icon name="arrow-counterclockwise" />
            <span>{t('m.br.report.undo')}</span>
          </button>
        ) : null}
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={p.onClose}>
          {t('m.br.report.done')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- auto-advance

function stepName(t: ReturnType<typeof useMT>, n: number, title: string | null): string {
  return title ? t('m.br.adv.stepTitled', { n, title }) : t('m.br.adv.step', { n });
}

function AdvanceBlock({ advance, onClose }: { advance: ReportAdvance; onClose: () => void }) {
  const t = useMT();
  const { stop, offer } = advance;
  if (stop) {
    const action = stopAction(stop.reason);
    const done = stop.reason === 'final_step';
    return (
      <div className="m-br-advance" data-testid="m-advance-stop">
        <p className={done ? 'm-notice' : 'm-notice m-notice--warning'} role="status">
          <Icon name={done ? 'check-circle' : 'exclamation-circle'} />
          <span>{t(`common.advance.stop.${stop.reason}`)}</span>
        </p>
        {advance.steps.length > 1 ? <StepList advance={advance} /> : null}
        {action === 'resume' || action === 'continue' ? (
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={advance.onResume}>
            <Icon name="play-circle" />
            <span>{t(action === 'resume' ? 'm.br.adv.resume' : 'm.br.adv.continue')}</span>
          </button>
        ) : action === 'manual' ? (
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.br.adv.manual')}
          </button>
        ) : null}
      </div>
    );
  }
  if (!offer) return null;
  return (
    <div className="m-br-advance" data-testid="m-advance-offer">
      <p className="m-notice">
        <Icon name="list-ul" />
        <span>
          {offer.title ? t('m.br.adv.offerTitled', { n: offer.step, title: offer.title }) : t('m.br.adv.offer', { n: offer.step })}{' '}
          {t('common.advance.hint')}
        </span>
      </p>
      <button type="button" className="m-button m-button--wide" onClick={advance.onStart}>
        <Icon name="arrow-right" />
        <span>{t('common.advance.start')}</span>
      </button>
    </div>
  );
}

function StepList({ advance }: { advance: ReportAdvance }) {
  const t = useMT();
  return (
    <ol className="m-br-steps" aria-label={t('m.br.adv.steps')}>
      {advance.steps.map((s, i) => {
        const name = stepName(t, i + 1, s.title);
        const parts = [
          s.filled > 0 ? t('m.br.adv.count.filled', { n: s.filled }) : null,
          s.attention > 0 ? t('m.br.adv.count.attention', { n: s.attention }) : null,
          s.skipped > 0 ? t('m.br.adv.count.skipped', { n: s.skipped }) : null,
        ].filter((x): x is string => x !== null);
        const tone = s.attention > 0 ? 'warning' : s.skipped > 0 ? 'muted' : 'success';
        return (
          <li key={s.fingerprint} className={`m-br-step m-br-step--${tone}`}>
            <Icon name={tone === 'warning' ? 'exclamation-circle' : tone === 'muted' ? 'info-circle' : 'check-circle'} />
            <span className="m-br-row__text">
              <span className="m-row__name">{i === advance.here ? t('m.br.adv.thisPage', { step: name }) : name}</span>
              <span className="m-br-row__status">{parts.join(t('m.br.adv.count.sep'))}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StopCompact({ advance, onResume, onSee }: { advance: ReportAdvance; onResume: () => void; onSee: () => void }) {
  const t = useMT();
  const stop = advance.stop!;
  const here = advance.here >= 0 ? advance.here + 1 : advance.steps.length;
  return (
    <div className="m-sheet-stack" data-testid="m-advance-stopped">
      <p className="m-notice m-notice--warning" role="status">
        <Icon name="exclamation-circle" />
        <span>
          {t(`common.advance.stop.${stop.reason}`)}
          <span className="m-br-row__status m-br-block">{t('m.br.adv.stoppedAt', { n: Math.max(1, here), moved: stop.moved })}</span>
        </span>
      </p>
      <button type="button" className="m-button m-button--primary m-button--wide" onClick={onResume}>
        <Icon name="play-circle" />
        <span>{t(stopAction(stop.reason) === 'continue' ? 'm.br.adv.continue' : 'm.br.adv.resume')}</span>
      </button>
      <button type="button" className="m-button m-button--wide" onClick={onSee}>
        {t('m.br.adv.seeResult')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- rows

function Entries({ sections }: { sections: readonly EntrySection[] }) {
  const t = useMT();
  const tr = t as Parameters<typeof entryWhyText>[0];
  return (
    <div className="m-br-entries">
      {sections.map((s) => (
        <section key={s.section} className="m-br-reason">
          <h3 className="m-br-reason__head">
            <Icon name={SECTION_ICONS[s.section] ?? 'list-ul'} />
            <span>{t('m.br.report.entries', { section: t(entrySectionKey(s.section)), done: s.done, n: s.entries.length })}</span>
          </h3>
          <ul className="m-br-rows">
            {s.entries.map((e) => {
              const status = entryStatus(e);
              return (
                <li key={e.index} className={`m-br-row m-br-row--${status.tone}`}>
                  <span className="m-br-entry__n" aria-hidden="true">
                    {e.index + 1}
                  </span>
                  <span className="m-br-row__text">
                    <span className="m-row__name">
                      <span className="m-visually-hidden">{t('common.entry.number', { n: e.index + 1 })} </span>
                      {e.label || t('common.entry.number', { n: e.index + 1 })}
                    </span>
                    <span className="m-br-row__status">
                      {e.state === 'held' || e.state === 'skipped' ? entryWhyText(tr, e) : `${t(`common.entry.state.${e.state}`)} · ${entryWhyText(tr, e)}`}
                    </span>
                  </span>
                  <span className={`m-br-pill m-br-pill--${status.tone}`}>
                    <Icon name={STATUS_ICONS[status.icon] ?? 'info-circle'} />
                    <span>{t(status.labelKey)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UndoneView({ model, onLocate }: { model: ReportModel; onLocate: (row: ReportRow) => void }) {
  const t = useMT();
  const undo = model.undo!;
  return (
    <>
      <p className="m-notice" role="status">
        <Icon name="arrow-counterclockwise" />
        <span>{t('m.br.report.undone', { n: undo.restored })}</span>
      </p>
      {undo.manual.length > 0 ? (
        <>
          <p className="m-sheet-text">{t('m.br.report.manual', { n: undo.manual.length })}</p>
          <Rows rows={undo.manual} onLocate={onLocate} />
        </>
      ) : null}
      {undo.addedCards > 0 ? (
        <p className="m-notice m-notice--warning">
          <Icon name="exclamation-circle" />
          <span>{t('m.br.report.addedCards', { n: undo.addedCards })}</span>
        </p>
      ) : null}
    </>
  );
}

interface RowActions {
  onFillOne?: ((row: ReportRow) => void) | undefined;
  onChangeSensitive?: (() => void) | undefined;
}

function Rows({ rows, resume = null, onLocate, ...actions }: { rows: readonly ReportRow[]; resume?: Resume | null; onLocate: (row: ReportRow) => void } & RowActions) {
  return (
    <ul className="m-br-rows">
      {rows.map((row) => (
        <li key={row.key}>
          <Row row={row} resume={resume} onLocate={onLocate} {...actions} />
        </li>
      ))}
    </ul>
  );
}

/** Where the row sits and why it needs a look: 「教育经历 · 第 1 条」, then the note. */
function rowMeta(t: ReturnType<typeof useMT>, row: ReportRow): { place: string; note: string | null } {
  const section = sectionLabelKey(row.sectionKey);
  const place = [section ? t(section) : null, row.entry !== null ? t('common.entry.number', { n: row.entry }) : null].filter(Boolean).join(' · ');
  const note =
    row.note === 'sensitive_held'
      ? t('fab.item.sensitiveHeld')
      : row.note === 'sensitive_filled'
        ? t('panel.note.sensitiveFilled')
        : row.note === 'day_missing'
          ? t('fab.item.dayMissing')
        : row.picked
          ? t('m.br.report.picked', { name: row.picked })
          : row.value !== null
            ? t('m.br.report.value', { value: row.value })
            : null;
  return { place, note };
}

function Row({ row, resume = null, onLocate, onFillOne, onChangeSensitive }: { row: ReportRow; resume?: Resume | null; onLocate: (row: ReportRow) => void } & RowActions) {
  const t = useMT();
  const status = OUTCOME_STATUS[row.outcome];
  const label = row.label ?? t('fab.item.unnamed');
  const { place, note } = rowMeta(t, row);
  const held = row.note === 'sensitive_held';
  const bm25Hint =
    resume && row.label && !held && (row.outcome === 'unmatched' || row.outcome === 'needs_review' || row.outcome === 'no_data')
      ? (retrieveBm25Matches(row.label, resume, 1)[0]?.text ?? null)
      : null;
  const content = (
    <>
      <span className="m-br-row__icon">
        <Icon name={held ? 'shield-lock' : (STATUS_ICONS[status.icon] ?? 'info-circle')} />
      </span>
      <span className="m-br-row__text">
        <span className="m-row__name">{label}</span>
        {place ? <span className="m-br-row__status">{place}</span> : null}
        {note ? <span className="m-br-row__value">{note}</span> : null}
        {bm25Hint ? <span className="m-row__caption">{t('m.ai.hint', { text: bm25Hint })}</span> : null}
      </span>
      {row.focusable ? <Icon name="chevron-right" /> : null}
    </>
  );
  const className = `m-br-row m-br-row--${status.tone}${held ? ' m-br-row--held' : ''}`;
  const main = row.focusable ? (
    <button type="button" className={className} aria-label={t('m.br.report.locate', { label })} onClick={() => onLocate(row)}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
  if (!held || (!onFillOne && !onChangeSensitive)) return main;
  return (
    <div className="m-br-row-wrap">
      {main}
      <div className="m-br-row__actions">
        {onFillOne && row.focusable ? (
          <button type="button" className="m-button m-button--small" onClick={() => onFillOne(row)}>
            <Icon name="magic" />
            <span>{t('m.br.report.fillOnce')}</span>
          </button>
        ) : null}
        {onChangeSensitive ? (
          <button type="button" className="m-button m-button--small" onClick={onChangeSensitive}>
            <Icon name="gear" />
            <span>{t('m.br.report.changeSetting')}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- locate bar

function LocateBar({
  model,
  row,
  group,
  onGo,
  onList,
}: {
  model: ReportModel;
  row: ReportRow;
  group: GroupId;
  onGo: (row: ReportRow) => void;
  onList: () => void;
}) {
  const t = useMT();
  const status = OUTCOME_STATUS[row.outcome];
  const { place } = rowMeta(t, row);
  const at = position(model, group, row.key);
  const all = Object.values(model.rows).flat();
  const go = (dir: -1 | 1) => {
    const next = neighbour(model, group, row.key, dir);
    const target = next ? all.find((r) => r.key === next.key) : undefined;
    if (target) onGo(target);
  };
  const prev = neighbour(model, group, row.key, -1);
  const next = neighbour(model, group, row.key, 1);
  return (
    <div className="m-br-locate" data-testid="m-locate-bar">
      <p className={`m-br-locate__meta m-br-row--${status.tone}`}>
        <span className="m-br-row__icon">
          <Icon name={row.note === 'sensitive_held' ? 'shield-lock' : (STATUS_ICONS[status.icon] ?? 'info-circle')} />
        </span>
        <span>{[place, t(status.labelKey)].filter(Boolean).join(' · ')}</span>
      </p>
      <div className="m-br-locate__nav">
        <button type="button" className="m-button" disabled={!prev} onClick={() => go(-1)}>
          <Icon name="chevron-left" />
          <span>{t('m.br.locate.prev')}</span>
        </button>
        <button type="button" className="m-button" disabled={!next} onClick={() => go(1)}>
          <span>{t('m.br.locate.next')}</span>
          <Icon name="chevron-right" />
        </button>
        <button type="button" className="m-button" onClick={onList}>
          <Icon name="list-ul" />
          <span>{t('m.br.locate.list')}</span>
        </button>
      </div>
      {at ? (
        <p className="m-help" role="status">
          {t(`m.br.locate.pos.${group}`, { n: at.position, total: at.total })}
        </p>
      ) : null}
    </div>
  );
}
