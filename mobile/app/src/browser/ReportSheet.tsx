// The fill report: a non-modal docked sheet, so the page stays usable above it and a tapped row
// scrolls its field into view there. Three tabs (已填 / 待你看 / 跳过), notes that apply, what was handed to the page,
// and the footer: the app never submits, undo this fill (once), done. After undo it shows what came back and what the
// person must change back by hand.
import { useId, useState } from 'react';
import { retrieveBm25Matches } from '../../../../src/ai/bm25';
import type { Resume } from '../../../../src/schema';
import type { SectionKey } from '../../../../src/schema/fieldKeys';
import { OUTCOME_STATUS } from '../../../../src/ui/status';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';
import type { GroupId, ReportModel, ReportRow } from './model/reportModel';

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
  onLocate: (row: ReportRow) => void;
  onUndo: () => void;
  onClose: () => void;
}

export function ReportSheet({ open, model, canUndo, fallbackNote, unanswered = 0, resume = null, onLocate, onUndo, onClose }: ReportSheetProps) {
  const t = useMT();
  return (
    <DockedSheet open={open && model !== null} title={t('m.br.report.title')} onClose={onClose} className="m-br-sheet--report">
      {model ? (
        <ReportBody
          model={model}
          canUndo={canUndo}
          fallbackNote={fallbackNote}
          unanswered={unanswered}
          resume={resume}
          onLocate={onLocate}
          onUndo={onUndo}
          onClose={onClose}
        />
      ) : null}
    </DockedSheet>
  );
}

function ReportBody({ model, canUndo, fallbackNote, unanswered = 0, resume = null, onLocate, onUndo, onClose }: Omit<ReportSheetProps, 'open' | 'model'> & { model: ReportModel }) {
  const t = useMT();
  const id = useId();
  const [group, setGroup] = useState<GroupId>(model.initialGroup);
  const [handedOpen, setHandedOpen] = useState(false);
  const rows = model.rows[group];
  const join = t('m.br.file.typesJoin');

  const notes: { icon: IconName; text: string; warn?: boolean }[] = [];
  if (unanswered > 0 && !model.undo) notes.push({ icon: 'exclamation-circle', text: t('m.br.report.unanswered'), warn: true });
  if (fallbackNote) notes.push({ icon: 'info-circle', text: fallbackNote });
  if (model.unreachable > 0) notes.push({ icon: 'exclamation-circle', text: t('m.br.report.unreachable', { n: model.unreachable }), warn: true });
  if (model.isolated === false) notes.push({ icon: 'exclamation-circle', text: t('m.br.isolation.off'), warn: true });

  return (
    <div className="m-sheet-stack">
      {model.undo ? (
        <UndoneView model={model} onLocate={onLocate} />
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
                onClick={() => setGroup(g)}
              >
                {t(`m.br.report.${g}`, { n: model.counts[g] })}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${group}`}>
            {rows.length === 0 ? <p className="m-empty">{t(`m.br.report.empty.${group}`)}</p> : <Rows rows={rows} resume={resume} onLocate={onLocate} />}
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
          <button type="button" className="m-button m-button--wide" onClick={onUndo}>
            <Icon name="arrow-counterclockwise" />
            <span>{t('m.br.report.undo')}</span>
          </button>
        ) : null}
        <button type="button" className="m-button m-button--primary m-button--wide" onClick={onClose}>
          {t('m.br.report.done')}
        </button>
      </div>
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

function Rows({ rows, resume = null, onLocate }: { rows: readonly ReportRow[]; resume?: Resume | null; onLocate: (row: ReportRow) => void }) {
  return (
    <ul className="m-br-rows">
      {rows.map((row) => (
        <li key={row.key}>
          <Row row={row} resume={resume} onLocate={onLocate} />
        </li>
      ))}
    </ul>
  );
}

function Row({ row, resume = null, onLocate }: { row: ReportRow; resume?: Resume | null; onLocate: (row: ReportRow) => void }) {
  const t = useMT();
  const status = OUTCOME_STATUS[row.outcome];
  const label = row.label ?? t('fab.item.unnamed');
  const section = sectionLabelKey(row.sectionKey);
  const bm25Hint =
    resume && row.label && (row.outcome === 'unmatched' || row.outcome === 'needs_review' || row.outcome === 'no_data')
      ? (retrieveBm25Matches(row.label, resume, 1)[0]?.text ?? null)
      : null;
  const content = (
    <>
      <span className="m-br-row__icon">
        <Icon name={STATUS_ICONS[status.icon] ?? 'info-circle'} />
      </span>
      <span className="m-br-row__text">
        <span className="m-br-row__status">
          {t(status.labelKey)}
          {section ? ` · ${t(section)}` : ''}
        </span>
        <span className="m-row__name">{label}</span>
        {row.value !== null ? <span className="m-br-row__value">{t('m.br.report.value', { value: row.value })}</span> : null}
        {bm25Hint ? <span className="m-row__caption">{t('m.ai.hint', { text: bm25Hint })}</span> : null}
      </span>
      {row.focusable ? <Icon name="chevron-right" /> : null}
    </>
  );
  const className = `m-br-row m-br-row--${status.tone}`;
  return row.focusable ? (
    <button type="button" className={className} aria-label={t('m.br.report.locate', { label })} onClick={() => onLocate(row)}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
