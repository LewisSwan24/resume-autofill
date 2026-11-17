// Settings (设置): interface language and the resume used for filling, deadline reminders, the copied-link offer and
// how to open job links in this app; export, import, clear site sign-ins and delete everything; the privacy page and
// the about sheet. Each sheet registers on the back stack through the shared Sheet.
import { useId, useState, type ReactNode } from 'react';
import type { Language } from '../../../../src/i18n';
import type { Profile } from '../../../../src/schema';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { KeyboardSetupScreen, type KeyboardProps } from '../keyboard/KeyboardSetupScreen';
import type { SettingsPage } from '../navigation';
import type { BrowserRolePlugin } from '../native/browserRole';
import type { RemindersPlugin } from '../native/reminders';
import { ReminderSettingsSheet } from '../tracker/ReminderSettingsSheet';
import type { AppState } from '../store/appStateStore';
import type { FileStore } from '../store/fileStore';
import type { ToastMessage } from '../ui';
import { AboutSheet, type AppInfo } from './AboutSheet';
import { ClearSiteDataSheet } from './ClearSiteDataSheet';
import { DeleteAllSheet } from './DeleteAllSheet';
import { ExportSheet, type SaveDocument } from './ExportSheet';
import { FILL_LANGUAGE_LABELS, FillLanguageSheet } from './FillLanguageSheet';
import { LanguageSwitch } from './LanguageSwitch';
import { OpenLinksSheet } from './OpenLinksSheet';
import { PrivacyScreen } from './PrivacyScreen';
import { SyncSheet } from './SyncSheet';
import { TemplateExportSheet } from './TemplateExportSheet';

export interface SettingsScreenProps {
  profile: Profile | null;
  /** Set when the stored profile cannot be read; delete-all then says that unreadable data goes too. */
  loadError?: string | null;
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  language: Language;
  onLanguage: (language: Language) => void;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  /** Saves pending edits and returns the stored profile (what export writes). */
  readStoredProfile: () => Promise<Profile>;
  /** Delete-all counts. */
  files: FileStore;
  saveDocument?: SaveDocument;
  appInfo?: AppInfo;
  onImport: () => void;
  /** Called when a chunked `.raf` or WebRTC sync produces a new profile. */
  onApplySyncedProfile?: (profile: Profile) => void;
  /** App's wipeAll; false on failure. */
  onWipe: () => Promise<boolean>;
  /** Clear the fill browser's cookies, web storage and cache; absent without the plugin (browser preview). */
  clearSiteData?: () => Promise<void>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** The phone can look at the clipboard (ClipboardPeek); false in the browser preview, which hides the switch. */
  clipboardAvailable?: boolean;
  /** Absent in the browser preview, which hides 「用本 App 打开网申链接」. */
  browserRole?: BrowserRolePlugin | null;
  /** Deadline reminders; null in the browser preview (the sheet then says they need the phone). */
  reminders?: RemindersPlugin | null;
  /** useReminderSync's lastError, shown in the reminder sheet. */
  reminderSyncFailed?: boolean;
  /** The resume keyboard; absent in the browser preview, which hides 「简历输入法」. */
  keyboard?: KeyboardProps | null;
}

/** The 简历输入法 row's value: the keyboard's state, or 正在查看… while unknown. */
function keyboardRowKey(k: KeyboardProps): string {
  if (!k.status) return 'm.kb.row.checking';
  if (k.status.current) return 'm.kb.row.current';
  return k.status.enabled ? 'm.kb.row.on' : 'm.kb.row.off';
}

/** 「09:00，前一天和当天」, or which day is on, or 不提醒. */
function reminderValueKey(r: AppState['reminders']): string {
  if (r.dayBefore && r.dayOf) return 'm.remind.value';
  if (r.dayBefore) return 'm.remind.valueDayBefore';
  if (r.dayOf) return 'm.remind.valueDayOf';
  return 'm.remind.valueNone';
}

type OpenSheet = 'fill' | 'export' | 'sync' | 'templates' | 'siteData' | 'wipe' | 'about' | 'links' | 'reminders' | null;

/** A setting that is on or off: a checkbox with role="switch", named by its label and described by its hint.
 *  Exported for the resume keyboard's setup page. */
export function SwitchRow({ icon, label, hint, checked, onChange }: { icon: IconName; label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <li>
      <label className="m-settings-row" htmlFor={`${id}-input`}>
        <Icon name={icon} />
        <span className="m-settings-row__text">
          <span className="m-settings-row__label" id={`${id}-label`}>
            {label}
          </span>
          <span className="m-settings-row__value" id={`${id}-hint`}>
            {hint}
          </span>
        </span>
        <span className="m-check">
          <input
            id={`${id}-input`}
            type="checkbox"
            role="switch"
            checked={checked}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            onChange={(e) => onChange(e.target.checked)}
          />
        </span>
      </label>
    </li>
  );
}

/** A settings row: a button when it leads somewhere, else plain. Exported for the resume keyboard's setup page. */
export function Row({
  icon,
  label,
  value,
  onClick,
  danger,
  disabled,
  children,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const content = (
    <>
      <Icon name={icon} />
      <span className="m-settings-row__text">
        <span className="m-settings-row__label">{label}</span>
        {value ? <span className="m-settings-row__value">{value}</span> : null}
      </span>
      {children}
      {onClick ? <Icon name="chevron-right" /> : null}
    </>
  );
  const className = danger ? 'm-settings-row m-settings-row--danger' : 'm-settings-row';
  return (
    <li>
      {onClick ? (
        <button type="button" className={className} onClick={onClick} disabled={disabled}>
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { profile, page, onPage, language, onLanguage, appState, updateAppState, showToast } = props;
  const t = useMT();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);

  if (page === 'privacy') return <PrivacyScreen onBack={() => onPage('root')} />;
  if (page === 'keyboard') {
    return (
      <KeyboardSetupScreen
        onBack={() => onPage('root')}
        keyboard={props.keyboard ?? null}
        profile={profile}
        appState={appState}
        updateAppState={updateAppState}
        showToast={showToast}
      />
    );
  }

  return (
    <>
      <header className="m-header">
        <h1 className="m-title" tabIndex={-1}>
          {t('m.settings.title')}
        </h1>
      </header>

      <h2 className="m-section-title">{t('m.settings.general')}</h2>
      <ul className="m-card m-settings-group">
        <Row icon="globe" label={t('common.uiLanguage')}>
          <LanguageSwitch language={language} onLanguage={onLanguage} />
        </Row>
        <Row
          icon="person-vcard"
          label={t('m.settings.fillLanguage')}
          value={t(FILL_LANGUAGE_LABELS[appState.fillLanguage])}
          onClick={() => setSheet('fill')}
        />
        <Row
          icon="bell"
          label={t('m.remind.title')}
          value={t(reminderValueKey(appState.reminders), { time: appState.reminders.time })}
          onClick={() => setSheet('reminders')}
        />
        {props.clipboardAvailable ? (
          <SwitchRow
            icon="clipboard"
            label={t('m.clip.setting')}
            hint={t('m.clip.settingHint')}
            checked={appState.clipboard.offer}
            onChange={(offer) => {
              void updateAppState((s) => ({ ...s, clipboard: { ...s.clipboard, offer } })).then((ok) => {
                if (!ok) showToast({ text: t('m.saveStateFailed') });
              });
            }}
          />
        ) : null}
        {props.browserRole ? <Row icon="signpost-split" label={t('m.links.row')} value={t('m.links.rowHint')} onClick={() => setSheet('links')} /> : null}
        {props.keyboard ? <Row icon="keyboard" label={t('m.kb.title')} value={t(keyboardRowKey(props.keyboard))} onClick={() => onPage('keyboard')} /> : null}
      </ul>

      <h2 className="m-section-title">{t('m.settings.data')}</h2>
      <ul className="m-card m-settings-group">
        <Row icon="download" label={t('m.settings.export')} onClick={() => setSheet('export')} />
        <Row icon="upload" label={t('m.settings.import')} onClick={props.onImport} />
        <Row icon="arrow-repeat" label={t('m.sync.row')} value={t('m.sync.rowHint')} onClick={() => setSheet('sync')} />
        <Row icon="file-earmark-pdf" label={t('m.tpl.row')} value={t('m.tpl.rowHint')} onClick={() => setSheet('templates')} />
        {props.clearSiteData ? (
          <Row icon="trash" label={t('m.settings.siteData')} value={t('m.settings.siteDataHint')} onClick={() => setSheet('siteData')} />
        ) : null}
        <Row icon="trash" label={t('m.settings.wipe')} danger onClick={() => setSheet('wipe')} />
      </ul>

      <h2 className="m-section-title">{t('m.settings.about')}</h2>
      <ul className="m-card m-settings-group">
        <Row icon="shield" label={t('m.settings.privacy')} onClick={() => onPage('privacy')} />
        <Row icon="info-circle" label={t('m.settings.aboutApp')} onClick={() => setSheet('about')} />
      </ul>

      <FillLanguageSheet
        open={sheet === 'fill'}
        value={appState.fillLanguage}
        onClose={close}
        onChoose={(fillLanguage) => {
          void updateAppState((s) => ({ ...s, fillLanguage })).then((ok) => {
            if (!ok) showToast({ text: t('m.saveStateFailed') });
          });
        }}
      />
      <ExportSheet
        open={sheet === 'export'}
        onClose={close}
        profile={profile}
        readStoredProfile={props.readStoredProfile}
        appState={appState}
        saveDocument={props.saveDocument}
        showToast={showToast}
      />
      <SyncSheet
        open={sheet === 'sync'}
        onClose={close}
        profile={profile}
        readStoredProfile={props.readStoredProfile}
        onApplyProfile={props.onApplySyncedProfile}
        files={props.files}
        appState={appState}
        updateAppState={updateAppState}
        saveDocument={props.saveDocument}
        showToast={showToast}
      />
      <TemplateExportSheet
        open={sheet === 'templates'}
        onClose={close}
        profile={profile}
        saveDocument={props.saveDocument}
        showToast={showToast}
      />
      {props.clearSiteData ? (
        <ClearSiteDataSheet open={sheet === 'siteData'} onClose={close} clearSiteData={props.clearSiteData} showToast={showToast} />
      ) : null}
      <DeleteAllSheet
        loadError={props.loadError ?? null}
        open={sheet === 'wipe'}
        onClose={close}
        profile={profile}
        files={props.files}
        recordCount={appState.applications.length}
        onExportFirst={() => setSheet('export')}
        onWipe={props.onWipe}
      />
      <AboutSheet open={sheet === 'about'} onClose={close} appInfo={props.appInfo} />
      <ReminderSettingsSheet
        open={sheet === 'reminders'}
        onClose={close}
        appState={appState}
        updateAppState={updateAppState}
        reminders={props.reminders ?? null}
        showToast={showToast}
        syncFailed={props.reminderSyncFailed}
      />
      {props.browserRole ? <OpenLinksSheet open={sheet === 'links'} onClose={close} browserRole={props.browserRole} showToast={showToast} /> : null}
    </>
  );
}
