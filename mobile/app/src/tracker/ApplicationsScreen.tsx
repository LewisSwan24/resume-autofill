// The 网申 tab: every application record, filtered by status chips, searched, sorted. Filter, query and
// sort live in the app's nav state so they survive tab switches; the search box feeds it after 300 ms.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { AppState, ApplicationRecord } from '../store/appStateStore';
import { IconButton, type ToastMessage } from '../ui';
import { AddApplicationSheet } from './AddApplicationSheet';
import { ApplicationRow } from './ApplicationRow';
import { defaultTimeZone } from './model/dates';
import { countByStatus, filterRecords, type StatusFilter, type TrackerSort } from './model/filters';
import { StatusPicker } from './StatusPicker';
import './tracker.css';

export const SEARCH_DEBOUNCE_MS = 300;

export interface ApplicationsScreenProps {
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  nav: { filter: StatusFilter; query: string; sort: TrackerSort };
  onNav: (patch: Partial<{ filter: StatusFilter; query: string; sort: TrackerSort }>) => void;
  onOpenDetail: (id: string) => void;
  onOpenPage: (record: ApplicationRecord) => void;
  onPasteLink: () => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  now?: () => number;
  timeZone?: string;
}

export function ApplicationsScreen({
  appState,
  updateAppState,
  nav,
  onNav,
  onOpenDetail,
  onOpenPage,
  onPasteLink,
  showToast,
  now = Date.now,
  timeZone,
}: ApplicationsScreenProps) {
  const t = useMT();
  const ids = useId();
  const zone = timeZone ?? defaultTimeZone();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState(nav.query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNavRef = useRef(onNav);
  onNavRef.current = onNav;

  // The query changed from outside (清除筛选, a reset): show it in the box.
  useEffect(() => {
    setText((current) => (current.trim() === nav.query.trim() ? current : nav.query));
  }, [nav.query]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const typed = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onNavRef.current({ query: value });
    }, SEARCH_DEBOUNCE_MS);
  };
  const clearSearch = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setText('');
    onNav({ query: '' });
  };

  const records = appState.applications;
  const at = now();
  const counts = useMemo(() => countByStatus(records), [records]);
  const shown = useMemo(() => filterRecords(records, nav, at, zone), [records, nav, at, zone]);

  return (
    <div className="m-page">
      <header className="m-header">
        <h1 className="m-title">{t('m.apps.title')}</h1>
        <button type="button" className="m-button rt-add" onClick={() => setAdding(true)}>
          <Icon name="plus-lg" />
          <span>{t('m.apps.add')}</span>
        </button>
      </header>

      {records.length === 0 ? (
        <section className="m-card rt-empty">
          <h2>{t('m.apps.empty')}</h2>
          <p>{t('m.apps.emptyHint')}</p>
          <button type="button" className="m-button m-button--primary" onClick={onPasteLink}>
            <Icon name="clipboard" />
            <span>{t('m.apps.emptyPaste')}</span>
          </button>
        </section>
      ) : (
        <>
          <div className="rt-controls">
            <div className="rt-search">
              <label className="m-label" htmlFor={`${ids}-search`}>
                {t('m.apps.search')}
              </label>
              <div className="rt-search__box">
                <input
                  id={`${ids}-search`}
                  className="m-input"
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={text}
                  onChange={(e) => typed(e.target.value)}
                />
                {text !== '' ? <IconButton icon="x-lg" label={t('m.apps.searchClear')} onClick={clearSearch} /> : null}
              </div>
            </div>
            <StatusPicker mode="filter" value={nav.filter} counts={counts} onChange={(filter) => onNav({ filter })} />
            <div className="rt-sort">
              <span id={`${ids}-sort`} className="m-label">
                {t('m.apps.sort')}
              </span>
              <div className="m-segmented m-segmented--small" role="radiogroup" aria-labelledby={`${ids}-sort`}>
                {(['opened', 'deadline'] as const).map((sort) => (
                  <button
                    key={sort}
                    type="button"
                    role="radio"
                    aria-checked={nav.sort === sort}
                    className={nav.sort === sort ? 'm-segment m-segment--on' : 'm-segment'}
                    onClick={() => nav.sort !== sort && onNav({ sort })}
                  >
                    {t(sort === 'opened' ? 'm.apps.sortOpened' : 'm.apps.sortDeadline')}
                  </button>
                ))}
              </div>
            </div>
            <p className="rt-count" aria-live="polite">
              {t('m.apps.count', { n: shown.length })}
            </p>
          </div>

          {shown.length === 0 ? (
            <section className="m-card rt-empty">
              <h2>{t('m.apps.noMatch')}</h2>
              <button
                type="button"
                className="m-button"
                onClick={() => {
                  clearSearch();
                  onNav({ filter: 'all', query: '' });
                }}
              >
                {t('m.apps.clearFilters')}
              </button>
            </section>
          ) : (
            <ul className="m-card rt-list" aria-label={t('m.apps.title')}>
              {shown.map((r) => (
                <ApplicationRow key={r.id} record={r} now={at} timeZone={zone} onOpenDetail={onOpenDetail} onOpenPage={onOpenPage} />
              ))}
            </ul>
          )}
        </>
      )}

      <AddApplicationSheet
        open={adding}
        onClose={() => setAdding(false)}
        appState={appState}
        updateAppState={updateAppState}
        onOpenDetail={onOpenDetail}
        showToast={showToast}
        now={now}
      />
    </div>
  );
}
