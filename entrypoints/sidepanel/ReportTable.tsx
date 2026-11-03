// Report table: one data row per field, plus an action row (candidates / inline edit) when needed.
import { Fragment, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { FieldReport } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import { displayValue, fieldKey, formatConfidence, hasCandidateChoices, outcomeTone } from './model';
import type { ApplyInput, ApplyResult } from './useFieldActions';

export interface ReportTableProps {
  fields: readonly FieldReport[];
  onFocus: (field: FieldReport) => void;
  onApply: (field: FieldReport, input: ApplyInput) => Promise<ApplyResult>;
}

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

const INTERACTIVE = 'button, input, select, textarea, a';

export function StatusChip({ outcome }: { outcome: FieldReport['outcome'] }) {
  const t = useT();
  return (
    <span className={`raf-chip raf-chip-${outcomeTone(outcome)}`} data-outcome={outcome}>
      {t(`panel.outcome.${outcome}`)}
    </span>
  );
}

function FieldRows({ field, onFocus, onApply }: { field: FieldReport } & Omit<ReportTableProps, 'fields'>) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const label = field.label || field.fieldKey || field.fieldId;
  const value = displayValue(field);
  const candidates = hasCandidateChoices(field) ? (field.candidates ?? []).filter((c) => c.label.trim() !== '') : [];
  const showActions = editing || candidates.length > 0 || feedback !== null;

  const run = async (input: ApplyInput) => {
    setBusy(true);
    setFeedback(null);
    const result = await onApply(field, input);
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      setFeedback({ kind: 'ok', text: t('panel.applied') });
      return;
    }
    const reason = result.outcome ? t(`panel.outcome.${result.outcome}`) : (result.message ?? t('panel.noResponse'));
    setFeedback({ kind: 'error', text: t('panel.applyFailed', { message: reason }) });
  };

  const startEdit = () => {
    setDraft(field.value ?? field.observed ?? '');
    setFeedback(null);
    setEditing(true);
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!(event.target as Element).closest(INTERACTIVE)) onFocus(field);
  };
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onFocus(field);
    }
  };

  return (
    <Fragment>
      <tr className="raf-row-data" data-outcome={field.outcome} tabIndex={0} onClick={onRowClick} onKeyDown={onRowKey}>
        <td className="raf-cell-label">{label}</td>
        <td className="raf-cell-value">
          <span className={value ? '' : 'raf-muted'}>{value || t('panel.noValue')}</span>{' '}
          <button type="button" className="raf-icon-button" aria-label={t('panel.editField', { label })} title={t('panel.edit')} onClick={startEdit}>
            ✎
          </button>
          {field.source ? (
            <div className="raf-source raf-muted" title={field.source}>
              {field.source}
            </div>
          ) : null}
        </td>
        <td className="raf-cell-confidence">{formatConfidence(field.confidence)}</td>
        <td className="raf-cell-status">
          <StatusChip outcome={field.outcome} />
        </td>
      </tr>
      {showActions ? (
        <tr className="raf-row-actions" data-for={fieldKey(field)}>
          <td colSpan={4}>
            {candidates.length > 0 ? (
              <div className="raf-candidates" role="group" aria-label={t('panel.candidates')}>
                <span className="raf-muted">{t('panel.candidates')}</span>
                {candidates.map((c, i) => (
                  <button
                    key={`${i}:${c.label}`}
                    type="button"
                    disabled={busy}
                    aria-label={t('panel.useOption', { option: c.label })}
                    onClick={() => void run({ optionLabel: c.label })}
                  >
                    {t('panel.use')} · {c.label}
                  </button>
                ))}
              </div>
            ) : null}
            {editing ? (
              <form
                className="raf-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy) void run({ text: draft });
                }}
              >
                <input type="text" aria-label={t('panel.editInput', { label })} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
                <button type="submit" className="raf-primary" disabled={busy}>
                  {t('panel.apply')}
                </button>
                <button type="button" disabled={busy} onClick={() => setEditing(false)}>
                  {t('panel.cancel')}
                </button>
              </form>
            ) : null}
            {feedback ? (
              <span className={feedback.kind === 'ok' ? 'raf-ok' : 'raf-error'} role="status">
                {feedback.text}
              </span>
            ) : null}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function ReportTable({ fields, onFocus, onApply }: ReportTableProps) {
  const t = useT();
  return (
    <table className="raf-table">
      <thead>
        <tr>
          <th scope="col">{t('panel.col.field')}</th>
          <th scope="col">{t('panel.col.value')}</th>
          <th scope="col">{t('panel.col.confidence')}</th>
          <th scope="col">{t('panel.col.status')}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <FieldRows key={fieldKey(field)} field={field} onFocus={onFocus} onApply={onApply} />
        ))}
      </tbody>
    </table>
  );
}
