// Report list: one ListItem per field, built on a native <details> (Accordion). The summary line is the ListItem
// (status tile, name, the value, a right-hand badge, chevron); the expanded area holds the status badge, the
// confidence bar, a human-readable source, candidate buttons, the manual edit and "Locate".
// Right-hand badge: confidence for filled rows, the outlined status badge (icon + word) for every other outcome.
import { useEffect, useId, useState } from 'react';
import type { FieldReport } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import { Icon } from '../../src/ui/Icon';
import { openProfilePage } from '../../src/ui/pages';
import { OUTCOME_STATUS } from '../../src/ui/status';
import { confidencePercent, displayValue, fieldKey, formatConfidence, hasCandidateChoices, hasConfidence } from './model';
import { ConfidenceBadge, IconButton, StatusBadge, StatusIcon } from './parts';
import { describeSource } from './sourceLabel';
import type { ApplyInput, ApplyResult } from './useFieldActions';

export interface ReportListProps {
  fields: readonly FieldReport[];
  onFocus: (field: FieldReport) => void;
  onApply: (field: FieldReport, input: ApplyInput) => Promise<ApplyResult>;
  /** Called after a field was applied successfully (the app shows a Toast). */
  onApplied?: () => void;
}

function FieldItem({ field, onFocus, onApply, onApplied }: { field: FieldReport } & Omit<ReportListProps, 'fields'>) {
  const t = useT();
  const inputId = useId();
  const [draft, setDraft] = useState(field.value ?? field.observed ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the field when the page reports a new value (e.g. after a refresh), but never while the user types.
  useEffect(() => {
    setDraft(field.value ?? field.observed ?? '');
  }, [field.value, field.observed]);

  const label = field.label || field.fieldKey || field.fieldId;
  const value = displayValue(field);
  // The meta line is the value only; the source is explained in plain words in the expanded area.
  const meta = value || t('panel.noValue');
  const sourceLabel = field.source ? (describeSource(field.source, t) ?? field.source) : null;
  // Plain-words source ("Basics › Family name + Given name"); the raw resume path is only the tooltip.
  const sourceNode =
    field.source && sourceLabel ? (
      <p className="raf-help raf-source" title={field.source}>
        {t('panel.source', { source: sourceLabel })}
      </p>
    ) : null;
  const candidates = hasCandidateChoices(field) ? (field.candidates ?? []).filter((c) => c.label.trim() !== '') : [];
  // Confidence only where it means something (filled / needs_review with a number): badge + bar.
  const percent = hasConfidence(field) ? confidencePercent(field.confidence) : null;
  const statusWord = t(OUTCOME_STATUS[field.outcome].labelKey);

  const run = async (input: ApplyInput) => {
    setBusy(true);
    setError(null);
    const result = await onApply(field, input);
    setBusy(false);
    if (result.ok) {
      onApplied?.();
      return;
    }
    const reason = result.outcome ? t(OUTCOME_STATUS[result.outcome].labelKey) : (result.message ?? t('panel.noResponse'));
    setError(t('panel.applyFailed', { message: reason }));
  };

  return (
    <li>
      <details className="raf-item" data-outcome={field.outcome}>
        {/* Opening or closing a row also points at the field on the page. */}
        <summary className="raf-item-head" onClick={() => onFocus(field)}>
          <span className="raf-tile" title={statusWord}>
            <StatusIcon outcome={field.outcome} labelled />
          </span>
          <span className="raf-item-text">
            <span className="raf-item-name" title={label}>
              {label}
            </span>
            <span className={value ? 'raf-item-meta' : 'raf-item-meta raf-item-meta-empty'} title={meta}>
              {meta}
            </span>
          </span>
          <span className="raf-item-end">
            {field.outcome === 'filled' ? (
              percent !== null ? <ConfidenceBadge confidence={field.confidence} /> : null
            ) : (
              <StatusBadge outcome={field.outcome} />
            )}
            <span className="raf-chevron">
              <Icon name="chevron-down" />
            </span>
          </span>
        </summary>

        <div className="raf-item-body">
          <div className="raf-body-top">
            {/* Filled rows show confidence in the head, so the status word lives here; other rows already carry it in the head. */}
            {field.outcome === 'filled' ? <StatusBadge outcome={field.outcome} /> : sourceNode}
            <IconButton icon="search" label={t('panel.locate')} onClick={() => onFocus(field)} />
          </div>

          {field.note === 'same_file_held' ? <p className="raf-help raf-field-note">{t('panel.note.sameFileHeld')}</p> : null}

          {field.outcome === 'no_data' ? (
            <button type="button" className="raf-btn raf-btn-small raf-add-missing" onClick={openProfilePage}>
              <Icon name="person-vcard" />
              <span className="raf-btn-text">{t('panel.addMissing')}</span>
            </button>
          ) : null}

          {percent !== null ? (
            <div className="raf-confidence">
              <span className="raf-help">{t('panel.confidence')}</span>
              <div
                className="raf-progress"
                role="progressbar"
                aria-label={t('panel.confidence')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span className="raf-progress-bar" style={{ width: `${percent}%` }} />
              </div>
              <span className="raf-progress-value">{formatConfidence(field.confidence)}</span>
            </div>
          ) : null}

          {field.outcome === 'filled' ? sourceNode : null}

          {candidates.length > 0 ? (
            <div className="raf-field" role="group" aria-label={t('panel.candidates')}>
              <span className="raf-field-label">{t('panel.candidates')}</span>
              <div className="raf-chips">
                {candidates.map((c, i) => (
                  <button
                    key={`${i}:${c.label}`}
                    type="button"
                    className="raf-btn raf-btn-small"
                    disabled={busy}
                    title={c.label}
                    onClick={() => void run({ optionLabel: c.label })}
                  >
                    <span className="raf-btn-text">{t('panel.useOption', { option: c.label })}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <form
            className="raf-field"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void run({ text: draft });
            }}
          >
            <label className="raf-field-label" htmlFor={inputId}>
              {t('panel.editLabel')}
            </label>
            <div className="raf-edit">
              <input
                id={inputId}
                type="text"
                className="raf-input"
                aria-label={t('panel.editInput', { label })}
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="raf-btn" disabled={busy}>
                {t('panel.save')}
              </button>
            </div>
            <span className="raf-help">{t('panel.editHelp')}</span>
            {error ? (
              <span className="raf-help raf-help-error" role="alert">
                <Icon name="exclamation-triangle" size={14} />
                {error}
              </span>
            ) : null}
          </form>
        </div>
      </details>
    </li>
  );
}

export function ReportList({ fields, onFocus, onApply, onApplied }: ReportListProps) {
  return (
    <ul className="raf-list" role="list">
      {fields.map((field) => (
        <FieldItem key={fieldKey(field)} field={field} onFocus={onFocus} onApply={onApply} onApplied={onApplied} />
      ))}
    </ul>
  );
}
