// 「简历输入法」: a Settings sub-page that says what the resume keyboard does before
// Android's own warning, leads to the system settings (step 1) and the input-method picker (step 2), reads the state
// back, and holds the keyboard's data switch and the kinds it shows. The practice field keeps nothing: its value is
// component state only.
import { useId, useState } from 'react';
import { MODULES } from '../../../../src/editor';
import type { Profile } from '../../../../src/schema';
import { Notice } from '../dialogs';
import { isModuleFilled } from '../home/summary';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import type { KeyboardStatus, ResumeKeyboardPlugin } from '../native/resumeKeyboard';
import { Row, SwitchRow } from '../settings/SettingsScreen';
import type { AppState } from '../store/appStateStore';
import { IconButton, type ToastMessage } from '../ui';
import { KeyboardModulesSheet } from './KeyboardModulesSheet';
import './keyboard.css';

/** What App hands the Settings screen about the keyboard; absent (null) without the plugin. */
export interface KeyboardProps {
  native: ResumeKeyboardPlugin;
  status: KeyboardStatus | null;
  error: boolean;
  refresh: () => Promise<void>;
  /** useKeyboardSync's lastError. */
  syncFailed: boolean;
}

export interface KeyboardSetupScreenProps {
  onBack: () => void;
  keyboard: KeyboardProps | null;
  profile: Profile | null;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

const PROMISES: ReadonlyArray<{ key: string; icon: IconName }> = [
  { key: 'm.kb.promise.reads', icon: 'lock' },
  { key: 'm.kb.promise.offline', icon: 'shield' },
  { key: 'm.kb.promise.noRecord', icon: 'eye-slash' },
  { key: 'm.kb.promise.password', icon: 'input-cursor-text' },
];

/** Some resume has something the keyboard could show (attachments and diversity never go in). */
export function hasKeyboardContent(profile: Profile | null): boolean {
  if (!profile) return false;
  const modules = MODULES.filter((m) => m.container !== 'attachments' && m.module !== 'diversity');
  return profile.resumes.some((resume) => modules.some((meta) => isModuleFilled(meta, resume)));
}

type Phase = 'unavailable' | 'unknown' | 'error' | 'off' | 'on' | 'current';

function phaseOf(keyboard: KeyboardProps | null): Phase {
  if (!keyboard) return 'unavailable';
  const s = keyboard.status;
  if (s) return s.current ? 'current' : s.enabled ? 'on' : 'off';
  return keyboard.error ? 'error' : 'unknown';
}

const STATUS: Record<Phase, { key: string; icon: IconName | null }> = {
  unavailable: { key: 'm.kb.state.unavailable', icon: 'info-circle' },
  unknown: { key: 'm.kb.state.unknown', icon: null },
  error: { key: 'm.kb.state.error', icon: 'exclamation-circle' },
  off: { key: 'm.kb.state.off', icon: 'info-circle' },
  on: { key: 'm.kb.state.on', icon: 'check-circle' },
  current: { key: 'm.kb.state.current', icon: 'check-circle' },
};

export function KeyboardSetupScreen({ onBack, keyboard, profile, appState, updateAppState, showToast }: KeyboardSetupScreenProps) {
  const t = useMT();
  const id = useId();
  const [practice, setPractice] = useState('');
  const [modulesOpen, setModulesOpen] = useState(false);
  const phase = phaseOf(keyboard);
  const status = STATUS[phase];
  const busy = phase === 'unknown';
  const enabled = phase === 'on' || phase === 'current';
  const show = appState.keyboard.show;
  const hiddenCount = appState.keyboard.hidden.length;

  const openSettings = () => {
    if (!keyboard) return;
    void keyboard.native.openInputMethodSettings().then(
      (r) => {
        if (!r.opened) showToast({ text: t('m.kb.step1.failed') });
      },
      () => showToast({ text: t('m.kb.step1.failed') }),
    );
  };
  const showPicker = () => {
    if (!keyboard) return;
    void keyboard.native.showPicker().catch(() => undefined);
  };

  return (
    <>
      <header className="m-header m-header--module">
        <IconButton icon="arrow-left" label={t('m.back')} onClick={onBack} />
        <h1 className="m-title" tabIndex={-1}>
          {t('m.kb.title')}
        </h1>
      </header>

      <div className="m-kb-setup">
        <p className="m-prose m-kb-setup__lead">{t('m.kb.lead')}</p>

        <div className="m-card m-kb-status" role="status" aria-live="polite" aria-label={t('m.kb.state.label')}>
          {status.icon ? <Icon name={status.icon} /> : <Icon name="keyboard" />}
          <span>{t(status.key)}</span>
        </div>

        <section className="m-card m-card--padded m-kb-step" aria-labelledby={`${id}-s1`}>
          <h2 className="m-kb-step__title" id={`${id}-s1`}>
            {t('m.kb.step1.title')}
          </h2>
          <p className="m-kb-step__text">{t('m.kb.step1.before')}</p>
          <ul className="m-kb-promises" aria-label={t('m.kb.promises')}>
            {PROMISES.map((p) => (
              <li key={p.key} className="m-kb-promise">
                <span className="m-row__tile">
                  <Icon name={p.icon} />
                </span>
                <span>{t(p.key)}</span>
              </li>
            ))}
          </ul>
          {phase === 'unavailable' ? null : enabled ? (
            <div className="m-kb-step__done">
              <p className="m-kb-step__ok">
                <Icon name="check-lg" />
                <span>{t('m.kb.step1.done')}</span>
              </p>
              <button type="button" className="m-button m-button--text" onClick={openSettings}>
                {t('m.kb.step1.again')}
              </button>
            </div>
          ) : (
            <button type="button" className="m-button m-button--primary m-button--wide" disabled={busy} onClick={openSettings}>
              {t('m.kb.step1.go')}
            </button>
          )}
        </section>

        <section className="m-card m-card--padded m-kb-step" aria-labelledby={`${id}-s2`}>
          <h2 className="m-kb-step__title" id={`${id}-s2`}>
            {t('m.kb.step2.title')}
          </h2>
          <p className="m-kb-step__text">{t('m.kb.step2.text')}</p>
          {phase === 'unavailable' ? null : phase === 'current' ? (
            <div className="m-kb-step__done">
              <p className="m-kb-step__ok">
                <Icon name="check-lg" />
                <span>{t('m.kb.step2.done')}</span>
              </p>
              <button type="button" className="m-button m-button--text" onClick={showPicker}>
                {t('m.kb.step2.go')}
              </button>
            </div>
          ) : enabled ? (
            <button type="button" className="m-button m-button--primary m-button--wide" onClick={showPicker}>
              {t('m.kb.step2.go')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="m-button m-button--primary m-button--wide"
                disabled
                aria-describedby={phase === 'unknown' ? undefined : `${id}-need`}
              >
                {t('m.kb.step2.go')}
              </button>
              {phase === 'unknown' ? null : (
                <p className="m-help" id={`${id}-need`}>
                  {t('m.kb.step2.needStep1')}
                </p>
              )}
            </>
          )}
        </section>

        <section className="m-card m-card--padded m-kb-step" aria-labelledby={`${id}-try`}>
          <h2 className="m-kb-step__title" id={`${id}-try`}>
            {t('m.kb.try.title')}
          </h2>
          <div className="m-field">
            <label className="m-label" htmlFor={`${id}-practice`}>
              {t('m.kb.try.label')}
            </label>
            <input
              id={`${id}-practice`}
              className="m-input"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('m.kb.try.placeholder')}
              value={practice}
              onChange={(e) => setPractice(e.target.value)}
            />
          </div>
          {!show ? <Notice>{t('m.kb.try.dataOff')}</Notice> : !hasKeyboardContent(profile) ? <Notice>{t('m.kb.try.noResume')}</Notice> : null}
        </section>

        <Notice icon="info-circle">{t('m.kb.chinese')}</Notice>

        <ul className="m-card m-settings-group">
          <SwitchRow
            icon="person-vcard"
            label={t('m.kb.show')}
            hint={t('m.kb.showHint')}
            checked={show}
            onChange={(next) => {
              void updateAppState((s) => ({ ...s, keyboard: { ...s.keyboard, show: next } })).then((ok) => {
                if (!ok) showToast({ text: t('m.saveStateFailed') });
              });
            }}
          />
          <Row
            icon="list-check"
            label={t('m.kb.modules')}
            value={hiddenCount === 0 ? t('m.kb.modulesAll') : t('m.kb.modulesHidden', { n: hiddenCount })}
            disabled={!show}
            onClick={() => setModulesOpen(true)}
          />
        </ul>

        {keyboard?.syncFailed ? <Notice tone="warning">{t('m.kb.syncFailed')}</Notice> : null}
      </div>

      <KeyboardModulesSheet
        open={modulesOpen && show}
        onClose={() => setModulesOpen(false)}
        appState={appState}
        updateAppState={updateAppState}
        showToast={showToast}
      />
    </>
  );
}
