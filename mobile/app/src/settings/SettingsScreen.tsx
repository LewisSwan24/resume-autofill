// Settings (设置): interface language and the resume used for filling; export, import and delete everything; the
// privacy page and the about sheet. Each sheet registers on the back stack through the shared Sheet.
import { useState, type ReactNode } from 'react';
import type { Language } from '../../../../src/i18n';
import type { Profile } from '../../../../src/schema';
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import type { SettingsPage } from '../navigation';
import type { AppState } from '../store/appStateStore';
import type { FileStore } from '../store/fileStore';
import type { ToastMessage } from '../ui';
import { AboutSheet, type AppInfo } from './AboutSheet';
import { DeleteAllSheet } from './DeleteAllSheet';
import { ExportSheet, type SaveDocument } from './ExportSheet';
import { FILL_LANGUAGE_LABELS, FillLanguageSheet } from './FillLanguageSheet';
import { LanguageSwitch } from './LanguageSwitch';
import { PrivacyScreen } from './PrivacyScreen';

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
  /** App's wipeAll; false on failure. */
  onWipe: () => Promise<boolean>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

type OpenSheet = 'fill' | 'export' | 'wipe' | 'about' | null;

function Row({
  icon,
  label,
  value,
  onClick,
  danger,
  children,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
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
        <button type="button" className={className} onClick={onClick}>
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
      </ul>

      <h2 className="m-section-title">{t('m.settings.data')}</h2>
      <ul className="m-card m-settings-group">
        <Row icon="download" label={t('m.settings.export')} onClick={() => setSheet('export')} />
        <Row icon="upload" label={t('m.settings.import')} onClick={props.onImport} />
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
        saveDocument={props.saveDocument}
        showToast={showToast}
      />
      <DeleteAllSheet
        loadError={props.loadError ?? null}
        open={sheet === 'wipe'}
        onClose={close}
        profile={profile}
        files={props.files}
        recentCount={appState.recentPages.length}
        onExportFirst={() => setSheet('export')}
        onWipe={props.onWipe}
      />
      <AboutSheet open={sheet === 'about'} onClose={close} appInfo={props.appInfo} />
    </>
  );
}
