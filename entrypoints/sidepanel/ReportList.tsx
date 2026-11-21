// Report list: one ListItem per field, built on a native <details> (Accordion). The summary line is the ListItem
// (status tile, name, the value, a right-hand badge, chevron); the expanded area holds the status badge, the
// confidence bar, a human-readable source, candidate buttons, the manual edit and "Locate".
// Right-hand badge: confidence for filled rows, the outlined status badge (icon + word) for every other outcome.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  computeLocalFieldSuggestion,
  generateReviewDraft,
  generateStarInterviewPrep,
  retrieveHybridMatches,
  type AiDraftOutcome,
  type HybridMatch,
  type StarPrepResult,
} from '../../src/ai';
import type { FieldReport } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import type { Resume, Settings } from '../../src/schema';
import { Icon } from '../../src/ui/Icon';
import { targetOfField } from '../../src/editor/fieldTarget';
import { openProfileAt } from '../../src/ui/pages';
import { OUTCOME_STATUS } from '../../src/ui/status';
import { confidencePercent, displayValue, fieldKey, formatConfidence, hasCandidateChoices, hasConfidence } from './model';
import { ConfidenceBadge, IconButton, StatusBadge, StatusIcon } from './parts';
import { describeSource } from './sourceLabel';
import type { ApplyInput, ApplyResult } from './useFieldActions';

export interface ReportListProps {
  fields: readonly FieldReport[];
  resume?: Resume | null;
  settings?: Settings;
  onFocus: (field: FieldReport) => void;
  onApply: (field: FieldReport, input: ApplyInput) => Promise<ApplyResult>;
  onSaveCustomAnswer?: (question: string, answer: string) => Promise<void>;
  onRecordRecipe?: (field: FieldReport, answerText: string) => Promise<void>;
  /** Called after a field was applied successfully (the app shows a Toast). */
  onApplied?: () => void;
}

function FieldItem({
  field,
  resume,
  settings,
  onFocus,
  onApply,
  onSaveCustomAnswer,
  onRecordRecipe,
  onApplied,
}: { field: FieldReport } & Omit<ReportListProps, 'fields'>) {
  const t = useT();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(field.value ?? field.observed ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiDraftOutcome | null>(null);
  const [aiEmpty, setAiEmpty] = useState(false);
  const [hybridHit, setHybridHit] = useState<HybridMatch | null>(null);
  const [starBusy, setStarBusy] = useState(false);
  const [starPrep, setStarPrep] = useState<StarPrepResult | null>(null);
  const [saveCustom, setSaveCustom] = useState(false);

  // Follow the field when the page reports a new value (e.g. after a refresh), but never while the user types.
  useEffect(() => {
    setDraft(field.value ?? field.observed ?? '');
  }, [field.value, field.observed]);

  const supportsAiDraft =
    Boolean(resume) &&
    Boolean(field.label.trim()) &&
    (field.outcome === 'unmatched' || field.outcome === 'needs_review' || field.outcome === 'no_data');

  const localSuggestion = useMemo(() => {
    if (!supportsAiDraft || !resume) return null;
    return computeLocalFieldSuggestion(field.label, resume).matches[0] ?? null;
  }, [supportsAiDraft, resume, field.label]);

  useEffect(() => {
    setHybridHit(null);
    if (!supportsAiDraft || !resume) return;
    let active = true;
    void retrieveHybridMatches(field.label, resume, {
      limit: 1,
      useOllamaEmbeddings: false,
    }).then((hits) => {
      if (active && hits[0]) setHybridHit(hits[0]);
    });
    return () => {
      active = false;
    };
  }, [supportsAiDraft, resume, field.label]);

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
  // A card the page already held keeps its outcome for the counts, and says what happened in its own word.
  const held = field.note === 'entry_held';
  const word = held ? ('status.entry_held' as const) : undefined;
  const statusWord = t(word ?? OUTCOME_STATUS[field.outcome].labelKey);

  const run = async (input: ApplyInput) => {
    setBusy(true);
    setError(null);
    const result = await onApply(field, input);
    setBusy(false);
    if (result.ok) {
      if (saveCustom && onSaveCustomAnswer && 'text' in input && input.text.trim() && field.label.trim()) {
        await onSaveCustomAnswer(field.label.trim(), input.text.trim());
      }
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
            <StatusIcon outcome={field.outcome} labelled word={word} />
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
              <StatusBadge outcome={field.outcome} word={word} />
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
          {held ? <p className="raf-help raf-field-note">{t('panel.note.entryHeld')}</p> : null}

          {field.outcome === 'no_data' && !held ? (
            <button
              type="button"
              className="raf-btn raf-btn-small raf-add-missing"
              onClick={() => openProfileAt(field.fieldKey ? targetOfField(field.fieldKey, field.source) : null)}
            >
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

          {supportsAiDraft ? (
            <div className="raf-ai-box">
              {hybridHit || localSuggestion ? (
                <div className="raf-ai-preview">
                  <span className="raf-help">
                    {hybridHit
                      ? t('panel.ai.hybridHint', {
                          source: hybridHit.sourceLabel,
                          bm25: hybridHit.bm25Rank ?? '—',
                          vec: hybridHit.vectorRank ?? '—',
                        })
                      : t('panel.ai.suggestion', { source: localSuggestion!.sourceLabel })}
                  </span>
                  <p className="raf-ai-text">{hybridHit?.text ?? localSuggestion!.text}</p>
                  <button
                    type="button"
                    className="raf-btn raf-btn-small"
                    onClick={() => setDraft(hybridHit?.text ?? localSuggestion!.text)}
                  >
                    {t('panel.ai.useDraft')}
                  </button>
                </div>
              ) : null}

              <div className="raf-ai-actions">
                <button
                  type="button"
                  className="raf-btn raf-btn-small"
                  disabled={aiBusy}
                  onClick={async () => {
                    if (!resume) return;
                    setAiBusy(true);
                    setAiEmpty(false);
                    try {
                      const outcome = await generateReviewDraft({
                        questionLabel: field.label,
                        sectionHint: field.section,
                        resume,
                        settings,
                      });
                      setAiDraft(outcome);
                      setAiEmpty(outcome === null);
                    } finally {
                      setAiBusy(false);
                    }
                  }}
                >
                  <Icon name="info-circle" size={14} />
                  <span>{aiBusy ? t('panel.ai.generating') : t('panel.ai.generate')}</span>
                </button>
                {resume && (resume.work.length > 0 || resume.projects.length > 0) ? (
                  <button
                    type="button"
                    className="raf-btn raf-btn-small"
                    disabled={starBusy}
                    onClick={async () => {
                      setStarBusy(true);
                      try {
                        // The role comes from the resume, never from the page label: a form question is not a role.
                        const res = await generateStarInterviewPrep({
                          resume,
                          targetRole: resume.variantMeta?.targetRole || resume.jobIntention.positions[0] || '',
                          settings,
                        });
                        setStarPrep(res);
                      } finally {
                        setStarBusy(false);
                      }
                    }}
                  >
                    <span>{t('panel.star.button')}</span>
                  </button>
                ) : null}
              </div>

              {starPrep ? (
                <div className="raf-star-box">
                  <span className="raf-help">{t('panel.star.title', { title: starPrep.entryTitle })}</span>
                  <span className="raf-help">
                    {starPrep.source === 'bm25'
                      ? t('panel.star.source.template')
                      : t('panel.star.source.ai', { source: t(`panel.ai.source.${starPrep.source}`) })}
                  </span>
                  {starPrep.fallbackUsed && starPrep.factCheck.ok ? (
                    <span className="raf-help">
                      {starPrep.source === 'bm25'
                        ? t('panel.star.fallbackNotice')
                        : t(`panel.ai.fallbackNotice.${starPrep.source}`)}
                    </span>
                  ) : null}
                  {!starPrep.factCheck.ok ? (
                    <span className="raf-help">
                      {t('panel.star.factWarn', { metrics: starPrep.factCheck.inventedMetrics.join(', ') })}
                    </span>
                  ) : null}
                  <pre className="raf-star-pre">{starPrep.formattedText}</pre>
                  <button
                    type="button"
                    className="raf-btn raf-btn-small"
                    onClick={() => setDraft(starPrep.formattedText)}
                  >
                    {t('panel.ai.useDraft')}
                  </button>
                </div>
              ) : null}

              {aiDraft ? (
                <div className="raf-ai-preview">
                  <span className="raf-help">
                    {t('panel.ai.suggestion', {
                      source: t(`panel.ai.source.${aiDraft.source}`),
                    })}
                  </span>
                  {aiDraft.fallbackUsed ? (
                    <span className="raf-help">{t(`panel.ai.fallbackNotice.${aiDraft.source}`)}</span>
                  ) : null}
                  {aiDraft.injectionDetected ? (
                    <span className="raf-help raf-help-error" role="alert">
                      {t('panel.ai.injectionWarn')}
                    </span>
                  ) : null}
                  <p className="raf-ai-text">{aiDraft.text}</p>
                  <button
                    type="button"
                    className="raf-btn raf-btn-small"
                    onClick={() => setDraft(aiDraft.text)}
                  >
                    {t('panel.ai.useDraft')}
                  </button>
                </div>
              ) : aiEmpty ? (
                <p className="raf-help">{t('panel.ai.noDraft')}</p>
              ) : null}
            </div>
          ) : null}

          <form
            className="raf-field"
            onSubmit={(event) => {
              event.preventDefault();
              const submitted = inputRef.current?.value ?? draft;
              if (!busy) void run({ text: submitted });
            }}
          >
            <label className="raf-field-label" htmlFor={inputId}>
              {t('panel.editLabel')}
            </label>
            <div className="raf-edit">
              <input
                ref={inputRef}
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
              {onRecordRecipe && field.frameId !== undefined ? (
                <button
                  type="button"
                  className="raf-btn raf-btn-small"
                  disabled={busy}
                  onClick={() => void onRecordRecipe(field, draft)}
                >
                  {t('panel.recipe.record')}
                </button>
              ) : null}
            </div>
            {supportsAiDraft && onSaveCustomAnswer ? (
              <label className="raf-save-custom">
                <input type="checkbox" checked={saveCustom} onChange={(e) => setSaveCustom(e.target.checked)} />
                <span className="raf-help">{t('panel.ai.saveCustom')}</span>
              </label>
            ) : null}
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

export function ReportList({ fields, resume, settings, onFocus, onApply, onSaveCustomAnswer, onRecordRecipe, onApplied }: ReportListProps) {
  return (
    <ul className="raf-list" role="list">
      {fields.map((field) => (
        <FieldItem
          key={fieldKey(field)}
          field={field}
          resume={resume}
          settings={settings}
          onFocus={onFocus}
          onApply={onApply}
          onSaveCustomAnswer={onSaveCustomAnswer}
          onRecordRecipe={onRecordRecipe}
          onApplied={onApplied}
        />
      ))}
    </ul>
  );
}
