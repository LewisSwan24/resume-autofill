// Home's tracker block: 「快截止了」 and 「正在填写」, three rows each at most, and a link to the full list.
import { useId } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { AppState, ApplicationRecord } from '../store/appStateStore';
import { ApplicationRow } from './ApplicationRow';
import { defaultTimeZone } from './model/dates';
import { homeSections } from './model/filters';
import './tracker.css';

export interface HomeApplicationsProps {
  appState: AppState;
  onOpenDetail: (id: string) => void;
  onOpenPage: (record: ApplicationRecord) => void;
  onShowAll: () => void;
  now?: () => number;
  timeZone?: string;
}

export function HomeApplications({ appState, onOpenDetail, onOpenPage, onShowAll, now = Date.now, timeZone }: HomeApplicationsProps) {
  const t = useMT();
  const ids = useId();
  const zone = timeZone ?? defaultTimeZone();
  const at = now();
  const { dueSoon, inProgress, total } = homeSections(appState.applications, at, zone);

  if (total === 0) {
    return (
      <div className="rt-home">
        <p className="m-empty">{t('m.home.appsEmpty')}</p>
      </div>
    );
  }

  // Only 快截止了 carries an icon (calendar-event = deadline); no icon has a second meaning.
  const section = (key: 'due' | 'progress', title: string, icon: 'calendar-event' | null, list: ApplicationRecord[]) =>
    list.length === 0 ? null : (
      <section className="rt-home__section" aria-labelledby={`${ids}-${key}`}>
        <h2 id={`${ids}-${key}`}>
          {icon ? <Icon name={icon} /> : null}
          <span>{title}</span>
        </h2>
        <ul className="m-card rt-list">
          {list.map((r) => (
            <ApplicationRow key={r.id} record={r} now={at} timeZone={zone} onOpenDetail={onOpenDetail} onOpenPage={onOpenPage} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="rt-home">
      {section('due', t('m.home.deadlines'), 'calendar-event', dueSoon)}
      {section('progress', t('m.home.inProgress'), null, inProgress)}
      <button type="button" className="m-button m-button--text rt-link" onClick={onShowAll}>
        <Icon name="list-check" />
        <span>{t('m.home.allApps', { n: total })}</span>
      </button>
    </div>
  );
}
