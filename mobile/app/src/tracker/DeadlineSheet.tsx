// Set a deadline: quick days, a date (required) and an optional time with quick times. Tapping an input
// opens Android's own picker; the sheet stays. A past day may be saved, with a line saying no reminder will come.
import { useId, useState } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { Deadline } from '../store/appStateStore';
import { Sheet } from '../ui';
import { addDays, localDate } from './model/dates';
import './tracker.css';

const QUICK_TIMES = ['12:00', '18:00', '23:59'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DeadlineSheetProps {
  open: boolean;
  onClose: () => void;
  deadline: Deadline | undefined;
  /** null removes the deadline (and the reminder with it). */
  onSave: (deadline: Deadline | null) => void;
  now: number;
  timeZone: string;
}

export function DeadlineSheet(props: DeadlineSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.deadline.sheetTitle')} onClose={props.onClose}>
      <DeadlineBody {...props} />
    </Sheet>
  );
}

function DeadlineBody({ deadline, onSave, now, timeZone }: DeadlineSheetProps) {
  const t = useMT();
  const ids = useId();
  const [date, setDate] = useState(deadline?.date ?? '');
  const [time, setTime] = useState(deadline?.time ?? '');
  const [invalid, setInvalid] = useState(false);
  const today = localDate(now, timeZone);
  const past = YMD.test(date) && date < today;

  const save = () => {
    if (!YMD.test(date)) {
      setInvalid(true);
      document.getElementById(`${ids}-date`)?.focus();
      return;
    }
    onSave({ date, ...(HHMM.test(time) ? { time } : {}) });
  };

  const quickDays = [
    { label: t('m.deadline.quickToday'), date: today },
    { label: t('m.deadline.quickTomorrow'), date: addDays(today, 1) },
    { label: t('m.deadline.quickWeek'), date: addDays(today, 7) },
  ];

  return (
    <form
      className="m-sheet-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="rt-quick">
        {quickDays.map((q) => (
          <button
            key={q.label}
            type="button"
            className="rt-chip"
            aria-pressed={date === q.date}
            onClick={() => {
              setDate(q.date);
              setInvalid(false);
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-date`}>
          {t('m.deadline.date')}
        </label>
        <input
          id={`${ids}-date`}
          className="m-input"
          type="date"
          required
          value={date}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid || past ? `${ids}-date-help` : undefined}
          onChange={(e) => {
            setDate(e.target.value);
            setInvalid(false);
          }}
        />
        {invalid ? (
          <p id={`${ids}-date-help`} className="m-help m-help--error" role="alert">
            <Icon name="exclamation-circle" />
            <span>{t('m.deadline.invalid')}</span>
          </p>
        ) : past ? (
          <p id={`${ids}-date-help`} className="m-help">
            {t('m.deadline.past')}
          </p>
        ) : null}
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-time`}>
          {t('m.deadline.time')}
        </label>
        <input id={`${ids}-time`} className="m-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <div className="rt-quick">
          {QUICK_TIMES.map((q) => (
            <button key={q} type="button" className="rt-chip" aria-pressed={time === q} onClick={() => setTime(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
      <button type="submit" className="m-button m-button--primary m-button--wide">
        {t('m.deadline.save')}
      </button>
      {deadline ? (
        <button type="button" className="m-button m-button--wide" onClick={() => onSave(null)}>
          {t('m.deadline.clear')}
        </button>
      ) : null}
    </form>
  );
}
