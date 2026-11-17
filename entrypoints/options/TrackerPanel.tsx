// Options tab: local application tracker with status filtering, search, inline editing, and manual creation.
import { useEffect, useMemo, useState } from 'react';
import { useT, type MessageKey } from '../../src/i18n';
import {
  APPLICATION_STATUSES,
  addManualApplication,
  deleteApplication,
  filterApplications,
  isHttpUrl,
  loadApplications,
  updateApplication,
  type ApplicationRecord,
  type ApplicationStatus,
} from '../../src/tracker';
import { Icon } from '../../src/ui/Icon';
import { Button, EmptyState, Field, IconButton, Input, Notice, SelectInput, Textarea } from './ui/controls';
import { useToast } from './ui/Toast';

const STATUS_KEY: Record<ApplicationStatus, MessageKey> = {
  wish: 'options.tracker.status.wish',
  filling: 'options.tracker.status.filling',
  submitted: 'options.tracker.status.submitted',
  interview: 'options.tracker.status.interview',
  closed: 'options.tracker.status.closed',
};

export function TrackerPanel() {
  const t = useT();
  const toast = useToast();
  const [records, setRecords] = useState<ApplicationRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<'all' | ApplicationStatus>('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadApplications().then((list) => {
      if (active) {
        setRecords(list);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => filterApplications(records, filter, query), [records, filter, query]);

  const handleAdd = async () => {
    const trimmed = newUrl.trim();
    if (!isHttpUrl(trimmed)) {
      setAddError(t('options.tracker.urlInvalid'));
      return;
    }
    setAddError(null);
    await addManualApplication({
      url: trimmed,
      company: newCompany,
      position: newPosition,
      ...(newDeadline ? { deadline: { date: newDeadline } } : {}),
    });
    const refreshed = await loadApplications();
    setRecords(refreshed);
    setNewUrl('');
    setNewCompany('');
    setNewPosition('');
    setNewDeadline('');
    setAdding(false);
  };

  const patch = async (
    id: string,
    changes: Partial<Pick<ApplicationRecord, 'company' | 'position' | 'notes' | 'status' | 'deadline'>>,
  ) => {
    const next = await updateApplication(id, changes);
    setRecords(next);
  };

  const remove = async (id: string) => {
    const next = await deleteApplication(id);
    setRecords(next);
    toast.push({ text: t('options.tracker.delete') });
  };

  return (
    <div className="raf-form-stack">
      <Notice>{t('options.tracker.lead')}</Notice>

      <div className="raf-tracker-bar">
        <Input
          type="search"
          aria-label={t('options.tracker.search')}
          placeholder={t('options.tracker.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button icon="plus-lg" variant="primary" onClick={() => setAdding((v) => !v)}>
          {t('options.tracker.add')}
        </Button>
      </div>

      <div className="raf-tracker-chips" role="group" aria-label={t('options.tracker.status')}>
        <button
          type="button"
          className={`raf-tracker-chip${filter === 'all' ? ' is-selected' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          {t('options.tracker.filter.all')} ({records.length})
        </button>
        {APPLICATION_STATUSES.map((st) => {
          const count = records.filter((r) => r.status === st).length;
          return (
            <button
              key={st}
              type="button"
              className={`raf-tracker-chip${filter === st ? ' is-selected' : ''}`}
              aria-pressed={filter === st}
              onClick={() => setFilter(st)}
            >
              {t(STATUS_KEY[st])} ({count})
            </button>
          );
        })}
      </div>

      {adding ? (
        <div className="raf-tracker-add">
          <div className="raf-pair">
            <Field label={t('options.tracker.url')} error={addError}>
              {(ctrl) => (
                <Input
                  {...ctrl}
                  type="url"
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('options.tracker.deadline')}>
              {(ctrl) => (
                <Input
                  {...ctrl}
                  type="date"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="raf-pair">
            <Field label={t('options.tracker.company')}>
              {(ctrl) => <Input {...ctrl} value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />}
            </Field>
            <Field label={t('options.tracker.position')}>
              {(ctrl) => <Input {...ctrl} value={newPosition} onChange={(e) => setNewPosition(e.target.value)} />}
            </Field>
          </div>
          <div className="raf-row">
            <Button variant="primary" onClick={() => void handleAdd()}>
              {t('options.tracker.add')}
            </Button>
            <Button onClick={() => setAdding(false)}>{t('options.notNow')}</Button>
          </div>
        </div>
      ) : null}

      {loaded && filtered.length === 0 ? (
        <EmptyState icon="file-earmark-check">{t('options.tracker.empty')}</EmptyState>
      ) : (
        <ul className="raf-tracker-list">
          {filtered.map((rec) => (
            <li key={rec.id} className="raf-tracker-item">
              <div className="raf-tracker-item__top">
                <div className="raf-tracker-item__meta">
                  <strong className="raf-tracker-item__host">{rec.company || rec.host}</strong>
                  <span className="raf-caption">
                    {rec.host}
                    {rec.history.length > 0 ? ` · ${t('options.tracker.historyCount', { n: rec.history.length })}` : ''}
                  </span>
                </div>
                <div className="raf-row">
                  <a
                    href={rec.url}
                    target="_blank"
                    rel="noreferrer"
                    className="raf-icon-btn"
                    aria-label={t('options.tracker.open')}
                    data-tip={t('options.tracker.open')}
                  >
                    <Icon name="box-arrow-up-right" />
                  </a>
                  <IconButton
                    icon="trash"
                    label={t('options.tracker.delete')}
                    danger
                    onClick={() => void remove(rec.id)}
                  />
                </div>
              </div>

              <div className="raf-pair raf-pair--3">
                <Field label={t('options.tracker.company')}>
                  {(ctrl) => (
                    <Input
                      {...ctrl}
                      defaultValue={rec.company}
                      onBlur={(e) => {
                        if (e.target.value !== rec.company) void patch(rec.id, { company: e.target.value });
                      }}
                    />
                  )}
                </Field>
                <Field label={t('options.tracker.position')}>
                  {(ctrl) => (
                    <Input
                      {...ctrl}
                      defaultValue={rec.position}
                      onBlur={(e) => {
                        if (e.target.value !== rec.position) void patch(rec.id, { position: e.target.value });
                      }}
                    />
                  )}
                </Field>
                <Field label={t('options.tracker.status')}>
                  {(ctrl) => (
                    <SelectInput
                      {...ctrl}
                      value={rec.status}
                      onChange={(e) => void patch(rec.id, { status: e.target.value as ApplicationStatus })}
                    >
                      {APPLICATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {t(STATUS_KEY[st])}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
              </div>

              <div className="raf-pair">
                <Field label={t('options.tracker.deadline')}>
                  {(ctrl) => (
                    <Input
                      {...ctrl}
                      type="date"
                      value={rec.deadline?.date ?? ''}
                      onChange={(e) => {
                        const date = e.target.value;
                        void patch(rec.id, date ? { deadline: { date } } : { deadline: undefined });
                      }}
                    />
                  )}
                </Field>
                <Field label={t('options.tracker.notes')}>
                  {(ctrl) => (
                    <Textarea
                      {...ctrl}
                      rows={1}
                      defaultValue={rec.notes}
                      onBlur={(e) => {
                        if (e.target.value !== rec.notes) void patch(rec.id, { notes: e.target.value });
                      }}
                    />
                  )}
                </Field>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
