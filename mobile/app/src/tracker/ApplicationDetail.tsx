// One application: open the page, status, company, position, deadline, reminder, notes, fill history,
// pin and delete. Text fields autosave 500 ms after the last keystroke, on blur, when the screen goes (back, tab
// change) and when the app is paused. History shows counts only, never what was filled in.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../../../../src/i18n';
import type { Profile } from '../../../../src/schema';
import { Notice } from '../dialogs';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { RemindersPlugin } from '../native/reminders';
import { LanguageTag } from '../ResumeSwitcher';
import type { AppState, ApplicationRecord, ApplicationStatus, Deadline } from '../store/appStateStore';
import { IconButton, Sheet, SheetAction, type ToastMessage } from '../ui';
import { DeadlineSheet } from './DeadlineSheet';
import { defaultTimeZone, formatDate, formatDateTime, localDate } from './model/dates';
import { deleteRecord, displayName, editRecord, restoreRecord, setDeadline, setRemind, setStatus } from './model/records';
import { StatusPicker } from './StatusPicker';
import { useNotificationPermission } from './useNotificationPermission';
import './tracker.css';

export const DETAIL_SAVE_MS = 500;

export interface ApplicationDetailProps {
  id: string;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  profile: Profile | null;
  reminders: RemindersPlugin | null;
  onBack: () => void;
  onOpenPage: (record: ApplicationRecord) => void;
  onMissing: () => void;
  onPin?: (record: ApplicationRecord) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  now?: () => number;
  timeZone?: string;
}

export function ApplicationDetail(props: ApplicationDetailProps) {
  const record = props.appState.applications.find((r) => r.id === props.id) ?? null;
  const gone = useRef(false);
  const onMissing = useRef(props.onMissing);
  onMissing.current = props.onMissing;
  useEffect(() => {
    if (record || gone.current) return;
    gone.current = true;
    onMissing.current();
  }, [record]);
  if (!record) return null;
  return <DetailBody key={record.id} {...props} record={record} onDeleted={() => (gone.current = true)} />;
}

type Draft = { company: string; position: string; notes: string };
const FIELDS = ['company', 'position', 'notes'] as const;

function DetailBody({
  record,
  appState,
  updateAppState,
  profile,
  reminders,
  onBack,
  onOpenPage,
  onPin,
  showToast,
  now = Date.now,
  timeZone,
  onDeleted,
}: ApplicationDetailProps & { record: ApplicationRecord; onDeleted: () => void }) {
  const t = useMT();
  const language = useLanguage();
  const ids = useId();
  const zone = timeZone ?? defaultTimeZone();
  const permission = useNotificationPermission(reminders);
  const [draft, setDraft] = useState<Draft>({ company: record.company, position: record.position, notes: record.notes });
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [turningOn, setTurningOn] = useState(false);

  // ---- autosave of the text fields
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const recordRef = useRef(record);
  recordRef.current = record;
  const updateRef = useRef(updateAppState);
  updateRef.current = updateAppState;
  const nowRef = useRef(now);
  nowRef.current = now;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleted = useRef(false);
  /** Fields the person typed in since their last save. Only these are written; the others follow the record, which
   *  can change while the detail is mounted (the page opened from here sets a better company from its title). */
  const dirty = useRef(new Set<keyof Draft>());
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;
  const saveFailed = useCallback(() => toastRef.current({ text: tRef.current('m.saveStateFailed') }), []);

  // A clean field shows what is stored now.
  const { company, position, notes } = record;
  useEffect(() => {
    const stored = { company, position, notes };
    setDraft((d) => {
      let next = d;
      for (const f of FIELDS) if (!dirty.current.has(f) && d[f] !== stored[f]) next = { ...next, [f]: stored[f] };
      return next;
    });
  }, [company, position, notes]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (deleted.current) return;
    const d = draftRef.current;
    const r = recordRef.current;
    const patch: Partial<Draft> = {};
    for (const f of dirty.current) if (d[f].trim() !== r[f]) patch[f] = d[f];
    const fields = [...dirty.current];
    dirty.current.clear();
    if (Object.keys(patch).length === 0) return;
    void updateRef.current((s) => editRecord(s, r.id, patch, nowRef.current())).then((ok) => {
      if (ok) return;
      saveFailed();
      // Rolled back: a field not typed in again since shows the stored value.
      const stored = recordRef.current;
      setDraft((cur) => {
        let next = cur;
        for (const f of fields) if (!dirty.current.has(f)) next = { ...next, [f]: stored[f] };
        return next;
      });
    });
  }, [saveFailed]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      flush(); // back, tab change, unmount
    };
  }, [flush]);

  const typed = (field: keyof Draft, value: string) => {
    dirty.current.add(field);
    setDraft((d) => ({ ...d, [field]: value }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DETAIL_SAVE_MS);
  };

  // ---- the rest saves at once
  const at = now();
  const name = displayName(record);
  const open = record.status === 'wish' || record.status === 'filling';
  const insecure = record.url.startsWith('http:');

  useEffect(() => {
    if (record.remind) void permission.check();
    // only when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Save at once; a failed save rolls back on screen and says so. */
  const save = async (change: (s: AppState) => AppState): Promise<boolean> => {
    const ok = await updateAppState(change);
    if (!ok) saveFailed();
    return ok;
  };

  const changeStatus = async (status: ApplicationStatus) => {
    setAnnounce('');
    if (await save((s) => setStatus(s, record.id, status, now()))) {
      setAnnounce(t('m.app.statusChanged', { status: t(`m.status.${status}`) }));
    }
  };

  const saveDeadline = (deadline: Deadline | null) => {
    setDeadlineOpen(false);
    void save((s) => setDeadline(s, record.id, deadline, now()));
  };

  const toggleRemind = async (on: boolean) => {
    if (!on) {
      void save((s) => setRemind(s, record.id, false, now()));
      return;
    }
    if (turningOn) return;
    setTurningOn(true);
    const outcome = await permission.ensure();
    setTurningOn(false);
    if (outcome === 'granted') {
      void save((s) => {
        const next = setRemind(s, record.id, true, now());
        return next.reminders.defaultOn ? next : { ...next, reminders: { ...next.reminders, defaultOn: true } };
      });
    } else if (outcome === 'denied') {
      showToast({ text: t('m.perm.denied') });
    }
  };

  const remove = () => {
    flush();
    const { removed } = deleteRecord(appState, record.id);
    if (!removed) return;
    deleted.current = true;
    onDeleted();
    onBack();
    void updateAppState((s) => deleteRecord(s, record.id).state).then((ok) => {
      if (!ok) {
        saveFailed();
        return;
      }
      showToast({
        text: t('m.app.deleted', { name }),
        action: { label: t('options.undo'), onClick: () => void save((s) => restoreRecord(s, removed)) },
      });
    });
  };

  const copy = async () => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
      await navigator.clipboard.writeText(record.url);
      showToast({ text: t('m.recent.copied') });
    } catch {
      showToast({ text: t('m.recent.copyFailed') });
    }
  };

  const { time, dayBefore, dayOf } = appState.reminders;
  const remindWhen =
    dayBefore && dayOf
      ? t('m.app.remindWhen', { time })
      : dayBefore
        ? t('m.app.remindDayBefore', { time })
        : dayOf
          ? t('m.app.remindDayOf', { time })
          : t('m.app.remindDaysOff');
  const deadlineText = record.deadline
    ? `${formatDate(record.deadline.date, language, at, zone)}${record.deadline.time ? ` ${record.deadline.time}` : ''}`
    : t('m.deadline.none');
  const resumes = new Map((profile?.resumes ?? []).map((r) => [r.id, r]));

  return (
    <div className="m-page rt-detail">
      <header className="rt-detail__head">
        <IconButton
          icon="arrow-left"
          label={t('m.app.back')}
          onClick={() => {
            flush();
            onBack();
          }}
        />
        <div className="rt-detail__titles">
          <h1 className="m-title">{name}</h1>
          {record.position ? <p className="rt-detail__position">{record.position}</p> : null}
        </div>
      </header>

      <button
        type="button"
        className="m-button m-button--primary m-button--wide rt-open"
        onClick={() => {
          flush();
          onOpenPage(record);
        }}
      >
        <Icon name="window" />
        <span>{t('m.app.open')}</span>
      </button>

      <div className="rt-link-row">
        <Icon name="link-45deg" />
        <span className="rt-link-row__host">{record.host}</span>
        <IconButton icon="three-dots" label={t('m.app.linkMore', { host: record.host })} onClick={() => setLinkOpen(true)} />
      </div>
      {insecure ? <Notice tone="warning">{t('m.paste.insecure')}</Notice> : null}

      <section className="rt-section">
        <h2 id={`${ids}-status`} className="rt-section__title">
          {t('m.status.label')}
        </h2>
        <StatusPicker mode="status" value={record.status} onChange={(status) => void changeStatus(status)} label={t('m.status.label')} />
        <p className="rt-muted" aria-live="polite">
          {announce}
        </p>
      </section>

      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-company`}>
          {t('m.app.company')}
        </label>
        <input
          id={`${ids}-company`}
          className="m-input"
          maxLength={80}
          value={draft.company}
          aria-describedby={record.companyGuessed ? `${ids}-guess` : undefined}
          onChange={(e) => typed('company', e.target.value)}
          onBlur={flush}
        />
        {record.companyGuessed ? (
          <p id={`${ids}-guess`} className="m-help">
            {t('m.app.companyGuess')}
          </p>
        ) : null}
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-position`}>
          {t('m.app.position')}
        </label>
        <input
          id={`${ids}-position`}
          className="m-input"
          maxLength={80}
          placeholder={t('m.app.positionHint')}
          value={draft.position}
          onChange={(e) => typed('position', e.target.value)}
          onBlur={flush}
        />
      </div>

      <div className="m-card">
        <button type="button" className="rt-setting" onClick={() => setDeadlineOpen(true)}>
          <Icon name="calendar-event" />
          <span className="rt-setting__text">
            <span>{t('m.deadline.label')}</span>
            <span className="rt-setting__value">{deadlineText}</span>
          </span>
          <Icon name="chevron-right" />
        </button>
      </div>

      <section className="rt-section">
        {record.deadline ? (
          <>
            <label className="rt-setting" htmlFor={`${ids}-remind`}>
              <Icon name="bell" />
              <span className="rt-setting__text">
                <span>{t('m.app.remind')}</span>
                <span className="rt-setting__value">{open ? remindWhen : t('m.app.remindDone')}</span>
              </span>
              <input
                id={`${ids}-remind`}
                className="rt-switch"
                type="checkbox"
                role="switch"
                aria-label={t('m.app.remind')}
                checked={record.remind && open}
                disabled={!open || turningOn}
                aria-busy={turningOn || undefined}
                onChange={(e) => void toggleRemind(e.target.checked)}
              />
            </label>
            {permission.off && open ? (
              <div className="m-sheet-stack">
                <Notice tone="warning" icon="bell-slash">
                  {t('m.app.remindOff')}
                </Notice>
                <button type="button" className="m-button" onClick={permission.openSettings}>
                  {t('m.remind.openSettings')}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="rt-muted">{t('m.app.remindNeedsDeadline')}</p>
        )}
      </section>

      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-notes`}>
          {t('m.app.notes')}
        </label>
        <textarea
          id={`${ids}-notes`}
          className="m-input m-textarea"
          maxLength={1000}
          placeholder={t('m.app.notesHint')}
          value={draft.notes}
          onChange={(e) => typed('notes', e.target.value)}
          onBlur={flush}
        />
      </div>

      <section className="rt-section" aria-labelledby={`${ids}-history`}>
        <h2 id={`${ids}-history`} className="rt-section__title">
          <Icon name="clock-history" />
          <span>{t('m.app.history')}</span>
        </h2>
        {record.history.length === 0 ? (
          <p className="rt-muted">{t('m.app.historyEmpty')}</p>
        ) : (
          <ul className="m-card rt-history" aria-labelledby={`${ids}-history`}>
            {record.history.map((h) => {
              const resume = h.resumeId ? resumes.get(h.resumeId) : undefined;
              return (
                <li key={h.at} className={h.undone ? 'rt-history__undone' : undefined}>
                  <span className="rt-history__when">
                    <span>{formatDateTime(h.at, language, zone)}</span>
                    {resume ? (
                      <>
                        <span>{t('m.app.historyResume', { name: resume.title })}</span>
                        <LanguageTag locale={resume.locale} />
                      </>
                    ) : h.resumeId ? (
                      <span>{t('m.app.historyResumeGone')}</span>
                    ) : null}
                  </span>
                  <span className="rt-history__counts">
                    <span>{t('m.app.historyRow', { filled: h.filled, attention: h.attention, skipped: h.skipped })}</span>
                    {h.undone ? <span className="m-tag">{t('m.app.historyUndone')}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="rt-muted">{t('m.app.created', { date: formatDate(localDate(record.createdAt, zone), language, at, zone) })}</p>

      <div className="m-actions">
        {onPin ? (
          <button type="button" className="m-action" onClick={() => onPin(record)}>
            <Icon name="pin-angle" />
            <span>{t('m.app.pin')}</span>
          </button>
        ) : null}
        <button type="button" className="m-action m-action--danger" onClick={remove}>
          <Icon name="trash" />
          <span>{t('m.app.delete')}</span>
        </button>
      </div>

      <DeadlineSheet open={deadlineOpen} onClose={() => setDeadlineOpen(false)} deadline={record.deadline} onSave={saveDeadline} now={at} timeZone={zone} />
      <Sheet open={linkOpen} title={t('m.app.link')} onClose={() => setLinkOpen(false)}>
        <div className="m-sheet-stack">
          <p className="m-url">{record.url}</p>
          <div className="m-actions">
            <SheetAction icon="copy" label={t('m.recent.copy')} onClick={() => void copy()} />
          </div>
        </div>
      </Sheet>
      {permission.element}
    </div>
  );
}
