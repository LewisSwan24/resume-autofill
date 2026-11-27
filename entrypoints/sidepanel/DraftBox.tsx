// A drafted long-text answer (note 'draft'): the applicant reads and edits it here, and it reaches the page only on
// "Fill in". A written draft can be taken back. A rewrite by the local AI is offered only when the setting is on.
import { useId, useState } from 'react';
import { generateReviewDraft, type AiDraftOutcome } from '../../src/ai';
import type { FieldReport } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import type { Resume, Settings } from '../../src/schema';
import { Icon } from '../../src/ui/Icon';
import type { ApplyInput } from './useFieldActions';

export interface DraftBoxProps {
  field: FieldReport;
  label: string;
  resume?: Resume | null;
  settings?: Settings;
  busy: boolean;
  run: (input: ApplyInput) => Promise<void>;
}

export function DraftBox({ field, label, resume, settings, busy, run }: DraftBoxProps) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState(field.value ?? '');
  const [aiBusy, setAiBusy] = useState(false);
  const [rewrite, setRewrite] = useState<AiDraftOutcome | null>(null);
  const [rewriteEmpty, setRewriteEmpty] = useState(false);

  // Follow the field when the page reports a new value, checked while rendering rather than in an effect: an effect
  // also runs once after the box first appears, and an edit typed before it ran was overwritten with the draft.
  const [shownValue, setShownValue] = useState(field.value);
  if (field.value !== shownValue) {
    setShownValue(field.value);
    setText(field.value ?? '');
  }

  const written = field.outcome === 'filled';
  const canRewrite = Boolean(settings?.longTextAiRewrite && resume);

  const askRewrite = async () => {
    if (!resume) return;
    setAiBusy(true);
    setRewriteEmpty(false);
    try {
      const outcome = await generateReviewDraft({
        questionLabel: field.label,
        sectionHint: field.section,
        task: t('panel.draft.task', { draft: text }),
        resume,
        settings,
      });
      setRewrite(outcome);
      setRewriteEmpty(outcome === null);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <form
      className="raf-field raf-draft"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && text.trim()) void run({ text });
      }}
    >
      <p className="raf-help raf-field-note">{t('panel.note.draft')}</p>
      <label className="raf-field-label" htmlFor={id}>
        {t('panel.draft.label')}
      </label>
      <textarea
        id={id}
        className="raf-input raf-textarea"
        aria-label={t('panel.editInput', { label })}
        rows={6}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="raf-help">{t('panel.draft.length', { n: [...text].length })}</span>
      <div className="raf-edit">
        <button type="submit" className="raf-btn" disabled={busy || !text.trim()}>
          {t('panel.draft.fill')}
        </button>
        {written ? (
          <button type="button" className="raf-btn raf-btn-small" disabled={busy} onClick={() => void run({ undo: true })}>
            <Icon name="arrow-counterclockwise" size={14} />
            <span className="raf-btn-text">{t('panel.draft.undo')}</span>
          </button>
        ) : null}
        {canRewrite ? (
          <button type="button" className="raf-btn raf-btn-small" disabled={aiBusy || !text.trim()} onClick={() => void askRewrite()}>
            <span className="raf-btn-text">{aiBusy ? t('panel.draft.rewriting') : t('panel.draft.rewrite')}</span>
          </button>
        ) : null}
      </div>
      {rewrite ? (
        <div className="raf-ai-preview">
          <span className="raf-help">{t('panel.ai.suggestion', { source: t(`panel.ai.source.${rewrite.source}`) })}</span>
          {rewrite.injectionDetected ? (
            <span className="raf-help raf-help-error" role="alert">
              {t('panel.ai.injectionWarn')}
            </span>
          ) : null}
          <p className="raf-ai-text">{rewrite.text}</p>
          <button type="button" className="raf-btn raf-btn-small" onClick={() => setText(rewrite.text)}>
            {t('panel.ai.useDraft')}
          </button>
        </div>
      ) : rewriteEmpty ? (
        <p className="raf-help">{t('panel.ai.noDraft')}</p>
      ) : null}
    </form>
  );
}
