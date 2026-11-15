// One application in a list (网申 tab and Home): the whole row opens the detail; the window button opens
// the page. Status and deadline are words first; line weight, fill and fade only repeat them.
import { useLanguage } from '../../../../src/i18n';
import { relativeTime } from '../home/relativeTime';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { ApplicationRecord, ApplicationStatus, Deadline } from '../store/appStateStore';
import { IconButton } from '../ui';
import { deadlineBadge } from './model/dates';
import { displayName } from './model/records';
import './tracker.css';

export function StatusTag({ status }: { status: ApplicationStatus }) {
  const t = useMT();
  return <span className={`rt-status rt-status--${status}`}>{t(`m.status.${status}`)}</span>;
}

export function DeadlineBadge({ deadline, status, now, timeZone }: { deadline: Deadline; status: ApplicationStatus; now: number; timeZone: string }) {
  const t = useMT();
  const language = useLanguage();
  const badge = deadlineBadge(deadline, status, now, timeZone, language);
  return (
    <span className={`rt-badge rt-badge--${badge.urgency}`}>
      <Icon name="calendar-event" />
      <span>{t(badge.key, badge.params)}</span>
    </span>
  );
}

export interface ApplicationRowProps {
  record: ApplicationRecord;
  now: number;
  timeZone: string;
  onOpenDetail: (id: string) => void;
  onOpenPage: (record: ApplicationRecord) => void;
}

export function ApplicationRow({ record, now, timeZone, onOpenDetail, onOpenPage }: ApplicationRowProps) {
  const t = useMT();
  const language = useLanguage();
  const name = displayName(record);
  const second = record.position ? `${record.position} · ${record.host}` : record.host;
  const last = record.history[0];
  return (
    <li className="rt-row">
      <button type="button" className="rt-row__open" onClick={() => onOpenDetail(record.id)}>
        <span className="rt-row__head">
          <span className="rt-row__name">{name}</span>
          <StatusTag status={record.status} />
        </span>
        <span className="rt-row__line">{second}</span>
        <span className="rt-row__meta">
          {record.deadline ? <DeadlineBadge deadline={record.deadline} status={record.status} now={now} timeZone={timeZone} /> : null}
          <span>{last ? t('m.apps.lastFill', { when: relativeTime(last.at, now, language) }) : t('m.apps.neverFilled')}</span>
        </span>
      </button>
      <IconButton icon="window" label={t('m.apps.openPage', { name })} onClick={() => onOpenPage(record)} />
    </li>
  );
}
