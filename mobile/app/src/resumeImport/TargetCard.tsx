// 导入到: a new resume (its language and name) or a merge into the current one, plus keeping the PDF as the resume
// attachment. Warns when the file's language is not the merge target's.
import { useId, useRef } from 'react';
import { titleFromFileName } from '../../../../src/import/parse/clean';
import type { Locale, Profile } from '../../../../src/schema';
import { Notice } from '../dialogs';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { LanguageTag } from '../ResumeSwitcher';
import type { ReviewAction, ReviewState, ReviewTarget } from './review';

const isZh = (locale: Locale) => locale.startsWith('zh');

/** The resume a merge goes into: the attachment's owner, else the active resume (when it exists). */
export function mergeCandidate(state: ReviewState, profile: Profile | null) {
  if (!profile) return null;
  const find = (id: string | null | undefined) => (id ? profile.resumes.find((r) => r.id === id) ?? null : null);
  if (state.target.kind === 'merge') return find(state.target.resumeId);
  return find(state.file.stored?.resumeId) ?? find(profile.activeResumeId);
}

export interface TargetCardProps {
  state: ReviewState;
  profile: Profile | null;
  dispatch: (action: ReviewAction) => void;
  targetGone: boolean;
  disabled: boolean;
}

export function TargetCard({ state, profile, dispatch, targetGone, disabled }: TargetCardProps) {
  const t = useMT();
  const id = useId();
  const { target } = state;
  const candidate = mergeCandidate(state, profile);
  const defaultTitle = (locale: Locale) => t(isZh(locale) ? 'm.defaultTitle.zh' : 'm.defaultTitle.en');
  // Switching to merge and back keeps what was typed for the new resume.
  const lastNew = useRef<Extract<ReviewTarget, { kind: 'new' }> | null>(null);
  if (target.kind === 'new') lastNew.current = target;
  const newTarget = (): ReviewTarget => {
    if (lastNew.current) return lastNew.current;
    const locale = state.language.locale;
    return { kind: 'new', locale, title: titleFromFileName(state.file.name) || defaultTitle(locale) };
  };
  const setTarget = (next: ReviewTarget) => dispatch({ type: 'target', target: next });
  const languageName = (locale: Locale) => t(isZh(locale) ? 'm.ri.lang.zh' : 'm.ri.lang.en');
  const showAttach = state.file.kind === 'pdf' && state.file.source !== 'attachment';
  const replacesPdf = target.kind === 'merge' && Boolean(candidate?.attachments.resumeFileId);

  return (
    <section className="m-card m-card--padded m-ri-target" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="m-ri-card-title">
        {t('m.ri.target')}
      </h2>
      {targetGone ? <Notice tone="warning">{t('m.ri.targetGone')}</Notice> : null}
      <div role="radiogroup" aria-labelledby={`${id}-title`} className="m-choices">
        <button
          type="button"
          role="radio"
          aria-checked={target.kind === 'new'}
          className={target.kind === 'new' ? 'm-choice m-choice--on' : 'm-choice'}
          disabled={disabled}
          onClick={() => target.kind !== 'new' && setTarget(newTarget())}
        >
          <Icon name="plus-lg" />
          <span className="m-choice__text">{t('m.ri.target.new')}</span>
          {target.kind === 'new' ? <Icon name="check-lg" /> : null}
        </button>
        {candidate ? (
          <button
            type="button"
            role="radio"
            aria-checked={target.kind === 'merge'}
            className={target.kind === 'merge' ? 'm-choice m-choice--on' : 'm-choice'}
            disabled={disabled}
            onClick={() => target.kind !== 'merge' && setTarget({ kind: 'merge', resumeId: candidate.id })}
          >
            <Icon name="box-arrow-in-down" />
            <span className="m-choice__text">{t('m.ri.target.merge', { title: candidate.title })}</span>
            <LanguageTag locale={candidate.locale} />
            {target.kind === 'merge' ? <Icon name="check-lg" /> : null}
          </button>
        ) : null}
      </div>

      {target.kind === 'new' ? (
        <div className="m-fields m-ri-target__new">
          <div className="m-field">
            <span className="m-label" id={`${id}-lang`}>
              {t('m.ri.languageLabel')}
            </span>
            <div className="m-segmented" role="radiogroup" aria-labelledby={`${id}-lang`}>
              {(['zh-CN', 'en-AU'] as const).map((locale) => {
                const on = isZh(target.locale) === isZh(locale);
                return (
                  <button
                    key={locale}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? 'm-segment m-segment--on' : 'm-segment'}
                    disabled={disabled}
                    onClick={() => !on && setTarget({ ...target, locale })}
                  >
                    {t(isZh(locale) ? 'm.lang.zh' : 'm.lang.en')}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="m-field">
            <label className="m-label" htmlFor={`${id}-name`}>
              {t('m.renameLabel')}
            </label>
            <input
              id={`${id}-name`}
              className="m-input"
              type="text"
              autoComplete="off"
              value={target.title}
              disabled={disabled}
              onChange={(e) => setTarget({ ...target, title: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <>
          <p className="m-help">{t('m.ri.target.mergeHint')}</p>
          {candidate && isZh(candidate.locale) !== isZh(state.language.locale) ? (
            <Notice tone="warning">
              {t('m.ri.localeMismatch', { doc: languageName(state.language.locale), title: candidate.title, resume: languageName(candidate.locale) })}
            </Notice>
          ) : null}
        </>
      )}

      {showAttach ? (
        <label className="m-check m-ri-attach">
          <input
            type="checkbox"
            checked={state.attachPdf}
            disabled={disabled}
            onChange={(e) => dispatch({ type: 'attachPdf', on: e.target.checked })}
          />
          <span>{replacesPdf ? t('m.ri.attachPdfReplace') : t('m.ri.attachPdf')}</span>
        </label>
      ) : null}
    </section>
  );
}
