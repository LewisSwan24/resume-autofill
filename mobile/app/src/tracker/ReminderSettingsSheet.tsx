// Settings › 截止提醒: the time, the day before / on the day, whether notifications can show, and how
// many applications have a reminder. Each change saves at once; useReminderSync re-plans the alarms.
import { useEffect, useId, useState } from 'react';
import { Notice } from '../dialogs';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { RemindersPlugin } from '../native/reminders';
import type { AppState, ReminderSettings } from '../store/appStateStore';
import { Sheet, type ToastMessage } from '../ui';
import './tracker.css';

const QUICK_TIMES = ['08:00', '09:00', '12:00', '20:00'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ReminderSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  reminders: RemindersPlugin | null;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** The last reminder sync failed (useReminderSync's lastError). */
  syncFailed?: boolean;
}

export function ReminderSettingsSheet(props: ReminderSettingsSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.remind.title')} onClose={props.onClose}>
      {props.reminders ? <SettingsBody {...props} reminders={props.reminders} /> : <p className="m-sheet-text">{t('m.remind.needsPhone')}</p>}
    </Sheet>
  );
}

/** How many applications will get a reminder (open status, a deadline, the switch on, and a day ticked). */
export function reminderCount(state: AppState): number {
  if (!state.reminders.dayBefore && !state.reminders.dayOf) return 0;
  return state.applications.filter((r) => r.remind && r.deadline && (r.status === 'wish' || r.status === 'filling')).length;
}

function SettingsBody({ appState, updateAppState, reminders, showToast, syncFailed }: ReminderSettingsSheetProps & { reminders: RemindersPlugin }) {
  const t = useMT();
  const ids = useId();
  const settings = appState.reminders;
  const [time, setTime] = useState(settings.time);
  const [permOn, setPermOn] = useState<boolean | null>(null);

  useEffect(() => setTime(settings.time), [settings.time]);
  // Read on open and again whenever the app comes back (from system settings, say), so the line follows status().
  useEffect(() => {
    let live = true;
    const read = () =>
      reminders
        .status()
        .then((s) => live && setPermOn(s.permission === 'granted' && s.enabled && !s.channelBlocked))
        .catch(() => live && setPermOn(null));
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reminders]);

  const save = (patch: Partial<ReminderSettings>) =>
    void updateAppState((s) => ({ ...s, reminders: { ...s.reminders, ...patch } })).then((ok) => {
      if (!ok) showToast({ text: t('m.saveStateFailed') });
    });
  const n = reminderCount(appState);
  const daysOff = !settings.dayBefore && !settings.dayOf;

  return (
    <div className="m-sheet-stack">
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-time`}>
          {t('m.remind.time')}
        </label>
        <input
          id={`${ids}-time`}
          className="m-input"
          type="time"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            if (HHMM.test(e.target.value) && e.target.value !== settings.time) save({ time: e.target.value });
          }}
          onBlur={() => setTime(settings.time)}
        />
        <div className="rt-quick">
          {QUICK_TIMES.map((q) => (
            <button key={q} type="button" className="rt-chip" aria-pressed={settings.time === q} onClick={() => settings.time !== q && save({ time: q })}>
              {q}
            </button>
          ))}
        </div>
      </div>
      <label className="m-check">
        <input type="checkbox" checked={settings.dayBefore} onChange={(e) => save({ dayBefore: e.target.checked })} />
        <span>{t('m.remind.dayBefore')}</span>
      </label>
      <label className="m-check">
        <input type="checkbox" checked={settings.dayOf} onChange={(e) => save({ dayOf: e.target.checked })} />
        <span>{t('m.remind.dayOf')}</span>
      </label>
      <p className="rt-muted">{t('m.remind.dayOfNote')}</p>
      <p className="rt-muted">{t('m.remind.approx')}</p>
      {permOn === null ? null : permOn ? (
        <p className="rt-section__title">
          <Icon name="bell" />
          <span>{t('m.remind.permOn')}</span>
        </p>
      ) : (
        <>
          <Notice tone="warning" icon="bell-slash">
            {t('m.remind.permOff')}
          </Notice>
          <button type="button" className="m-button m-button--wide" onClick={() => void reminders.openSettings().catch(() => undefined)}>
            {t('m.remind.openSettings')}
          </button>
        </>
      )}
      {daysOff ? (
        <Notice tone="warning" icon="bell-slash">
          {t('m.remind.daysOff')}
        </Notice>
      ) : (
        <p className="m-sheet-text">{n > 0 ? t('m.remind.count', { n }) : t('m.remind.none')}</p>
      )}
      {syncFailed ? <Notice tone="danger">{t('m.remind.syncFailed')}</Notice> : null}
    </div>
  );
}
