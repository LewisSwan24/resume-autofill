// One field on the review: its label, a 需核对 tag when it was inferred, the edit box, a keep switch (导入 / 不导入),
// what the target already holds when merging, 看原文, and an inline error for a value the schema refuses.
import { useId, useState } from 'react';
import { enumLabel, enumOptions } from '../../../../src/editor';
import type { TextLine } from '../../../../src/import/extract/types';
import { useLanguage, type Language } from '../../../../src/i18n';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { PlannedChange } from './merge';
import { describePath } from './paths';
import type { ReviewAction, ReviewItem } from './review';
import { SourceLines } from './SourceLines';

const AREA_KEYS = new Set(['description', 'selfIntroduction', 'hobbies']);
const URL_KEYS = new Set(['linkedin', 'github', 'portfolio', 'website', 'link']);

/** The words that name a draft path: its field (and region part), joined with ' · '. */
export function labelOf(path: string, t: (key: string) => string): string {
  const info = describePath(path);
  return info ? info.labelKeys.map((key) => t(key)).join(' · ') : path;
}

/** A value as the person reads it: a choice by its label in the UI language, anything else as it is. */
export function shownValue(path: string, value: string, language: Language): string {
  const info = describePath(path);
  const field = info?.field;
  if (!value || field?.input !== 'select' || !field.enumDomain || info?.part !== null) return value;
  return enumLabel(field.enumDomain, value, language);
}

export interface ReviewFieldRowProps {
  item: ReviewItem;
  lines: readonly TextLine[];
  dispatch: (action: ReviewAction) => void;
  /** Merge only: what the plan does with this value. */
  change: PlannedChange | null;
  overwrite: boolean;
  refused: boolean;
  disabled: boolean;
  /** So the screen can move the cursor to the first refused value. */
  controlRef: (el: HTMLElement | null) => void;
}

export function ReviewFieldRow({ item, lines, dispatch, change, overwrite, refused, disabled, controlRef }: ReviewFieldRowProps) {
  const t = useMT();
  const language = useLanguage();
  const id = useId();
  const [sourceOpen, setSourceOpen] = useState(false);
  const info = describePath(item.path);
  const field = info?.field ?? null;
  const label = labelOf(item.path, t);
  const key = field?.key.split('.').pop() ?? item.path.split('.').pop() ?? '';
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const sourceId = `${id}-source`;
  const check = item.certainty === 'check';
  const describedBy = [check ? hintId : null, refused && item.keep ? errorId : null].filter(Boolean).join(' ') || undefined;
  const onValue = (value: string) => dispatch({ type: 'edit', path: item.path, value });

  const common = {
    id,
    ref: controlRef,
    value: item.value,
    disabled,
    'aria-describedby': describedBy,
    'aria-invalid': refused && item.keep ? true : undefined,
  } as const;

  let control;
  if (field?.input === 'select' && field.enumDomain && info?.part === null) {
    const options = enumOptions(field.enumDomain, language);
    const known = item.value === '' || options.some((o) => o.value === item.value);
    control = (
      <select {...common} className="m-select" onChange={(e) => onValue(e.target.value)}>
        <option value="">{t('common.unset')}</option>
        {known ? null : <option value={item.value}>{item.value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field?.input === 'textarea' || AREA_KEYS.has(key) || item.read.includes('\n')) {
    control = <textarea {...common} className="m-textarea" rows={4} onChange={(e) => onValue(e.target.value)} />;
  } else {
    const type = key === 'email' ? 'email' : key === 'phone' ? 'tel' : URL_KEYS.has(key) ? 'url' : 'text';
    control = (
      <input
        {...common}
        className="m-input"
        type={type}
        inputMode={type === 'text' ? undefined : type}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onValue(e.target.value)}
      />
    );
  }

  const className = item.keep ? 'm-ri-row' : 'm-ri-row m-ri-row--skipped';
  return (
    <div className={className} data-ri-path={item.path}>
      <div className="m-ri-row__head">
        <label className="m-label m-ri-row__label" htmlFor={id}>
          {label}
        </label>
        {check ? (
          <span className="m-tag m-tag--check">
            <Icon name="exclamation-circle" />
            <span>{t('m.ri.check')}</span>
          </span>
        ) : null}
        <label className="m-ri-switch">
          <input
            type="checkbox"
            role="switch"
            checked={item.keep}
            disabled={disabled}
            aria-label={t(item.keep ? 'm.ri.keepLabel' : 'm.ri.skippedLabel', { field: label })}
            onChange={(e) => dispatch({ type: 'keep', path: item.path, keep: e.target.checked })}
          />
          <span className="m-ri-switch__track" aria-hidden="true" />
          <span className="m-ri-switch__text">{item.keep ? t('m.ri.keep') : t('m.ri.skipped')}</span>
        </label>
      </div>
      {check ? (
        <p className="m-help" id={hintId}>
          {t('m.ri.checkHint')}
        </p>
      ) : null}
      <div className="m-ri-row__control">{control}</div>
      {change && change.existing ? <p className="m-help m-ri-row__existing">{t('m.ri.existing', { value: shownValue(item.path, change.existing, language) })}</p> : null}
      {change?.kind === 'same' ? (
        <p className="m-help">
          <Icon name="check-circle" />
          <span>{t('m.ri.same')}</span>
        </p>
      ) : null}
      {refused && item.keep ? (
        <p className="m-help m-help--error" id={errorId} role="alert">
          {t('m.ri.notValid')}
        </p>
      ) : null}
      <div className="m-ri-row__tools">
        <button
          type="button"
          className="m-button m-button--text m-ri-row__source"
          aria-expanded={sourceOpen}
          aria-controls={sourceId}
          aria-label={t(sourceOpen ? 'm.ri.hideSourceLabel' : 'm.ri.showSourceLabel', { field: label })}
          onClick={() => setSourceOpen((open) => !open)}
        >
          <Icon name="card-text" />
          <span>{sourceOpen ? t('m.ri.hideSource') : t('m.ri.showSource')}</span>
        </button>
        {change?.kind === 'conflict' ? (
          <label className="m-check">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={disabled || !item.keep}
              aria-label={t('m.ri.overwriteLabel', { field: label })}
              onChange={(e) => dispatch({ type: 'overwrite', path: item.path, on: e.target.checked })}
            />
            <span>{t('m.ri.overwrite')}</span>
          </label>
        ) : null}
      </div>
      {sourceOpen ? <SourceLines id={sourceId} lines={lines} line={item.line} /> : null}
    </div>
  );
}
