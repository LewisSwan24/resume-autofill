// Status chips: a radiogroup that wraps onto more lines. In filter mode each chip shows its count
// (「想投 5」, read as 「想投，5 条」); in status mode the five statuses of one record. Arrow keys move the choice.
import type { KeyboardEvent } from 'react';
import { useMT } from '../i18n';
import type { ApplicationStatus } from '../store/appStateStore';
import { STATUSES, STATUS_FILTERS, type StatusFilter } from './model/filters';
import './tracker.css';

type Props =
  | { mode: 'filter'; value: StatusFilter; counts: Record<StatusFilter, number>; onChange: (value: StatusFilter) => void }
  | { mode: 'status'; value: ApplicationStatus; onChange: (value: ApplicationStatus) => void; label?: string };

export function StatusPicker(props: Props) {
  const t = useMT();
  const options: readonly StatusFilter[] = props.mode === 'filter' ? STATUS_FILTERS : STATUSES;
  const pick = (value: StatusFilter) => {
    if (value === props.value) return;
    if (props.mode === 'filter') props.onChange(value);
    else props.onChange(value as ApplicationStatus);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = options.indexOf(props.value);
    const next = options[(index + step + options.length) % options.length]!;
    pick(next);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[options.indexOf(next)]?.focus();
  };
  const groupLabel = props.mode === 'filter' ? t('m.apps.filter') : (props.label ?? t('m.status.label'));
  return (
    <div className="rt-chips" role="radiogroup" aria-label={groupLabel} onKeyDown={onKeyDown}>
      {options.map((value) => {
        const label = t(`m.status.${value}`);
        const checked = value === props.value;
        const n = props.mode === 'filter' ? props.counts[value] : null;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="rt-chip"
            aria-label={n === null ? undefined : t('m.apps.filterA11y', { label, n })}
            onClick={() => pick(value)}
          >
            {n === null ? label : t('m.apps.filterCount', { label, n })}
          </button>
        );
      })}
    </div>
  );
}
