// Home (首页): the copied-link card when there is one, the resume used for filling, the paste-a-link box,
// the sample form, and the applications sections (快截止了 / 正在填写). Opening a link goes through App's openLink,
// which records it in the tracker; the sample form is never recorded. The old recent-pages list is no longer shown.
import type { ReactNode } from 'react';
import type { Locale, Profile } from '../../../../src/schema';
import { DEMO_URL } from '../browser/model/constants';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { FoundLink } from '../incoming/route';
import type { BrowserOpen } from '../navigation';
import type { AppState } from '../store/appStateStore';
import type { ToastMessage } from '../ui';
import { PasteLinkCard, type PasteFocusRequest } from './PasteLinkCard';
import { ResumeSummaryCard } from './ResumeSummaryCard';
import type { JumpTarget } from './summary';

export interface HomeScreenProps {
  profile: Profile | null;
  loadError: string | null;
  appState: AppState;
  /** No target: the 简历 tab root. */
  onJump: (resumeId: string, target?: JumpTarget) => void;
  onStartResume: (locale: Locale) => void;
  onImport: () => void;
  /** Read a PDF or Word resume. */
  onImportResume?: () => void;
  onOpenSettings: () => void;
  /** The sample form. */
  onOpenBrowser: (target: BrowserOpen) => void;
  /** App's openLink: records the page in the tracker and opens it (it opens even when saving failed). */
  onOpenLink: (link: FoundLink, source: 'paste') => Promise<void> | void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** 「打开刚复制的链接？」, above the resume card. */
  clipboardCard?: ReactNode;
  /** 快截止了 / 正在填写 (tracker/HomeApplications), below the sample form. */
  applications?: ReactNode;
  /** The 粘贴链接 shortcut or 去粘贴链接: focus the paste box (and, for the shortcut, fill it from the clipboard). */
  pasteFocus?: PasteFocusRequest | null;
  readClipboard?: () => Promise<string | null>;
  onPasteFocusDone?: () => void;
  /** The resume keyboard's setup screen, for the WeChat hint under the paste box; absent without the plugin. */
  onKeyboardSetup?: () => void;
  now?: () => number;
}

export function HomeScreen({
  profile,
  loadError,
  appState,
  onJump,
  onStartResume,
  onImport,
  onImportResume,
  onOpenSettings,
  onOpenBrowser,
  onOpenLink,
  showToast,
  clipboardCard,
  applications,
  pasteFocus,
  readClipboard,
  onPasteFocusDone,
  onKeyboardSetup,
}: HomeScreenProps) {
  const t = useMT();
  return (
    <>
      <header className="m-header">
        <h1 className="m-title" tabIndex={-1}>
          {t('m.home.title')}
        </h1>
      </header>
      {clipboardCard}
      <ResumeSummaryCard
        profile={profile}
        loadError={loadError}
        fillLanguage={appState.fillLanguage}
        onJump={onJump}
        onStartResume={onStartResume}
        onImport={onImport}
        onImportResume={onImportResume}
        onOpenSettings={onOpenSettings}
      />
      <PasteLinkCard
        showToast={showToast}
        onOpen={async (link) => {
          const found: FoundLink = { url: link.url, host: link.host, insecure: link.insecure };
          if (link.title) found.title = link.title;
          await onOpenLink(found, 'paste');
        }}
        focusRequest={pasteFocus ?? null}
        readClipboard={readClipboard}
        onFocusDone={onPasteFocusDone}
        onKeyboardSetup={onKeyboardSetup}
      />
      <div className="m-home-demo">
        <button
          type="button"
          className="m-button m-button--text"
          aria-describedby="m-home-demo-hint"
          onClick={() => onOpenBrowser({ url: DEMO_URL, demo: true, source: 'demo-home' })}
        >
          <Icon name="play-circle" />
          <span>{t('m.home.demo')}</span>
        </button>
        <p className="m-help" id="m-home-demo-hint">
          {t('m.home.demoHint')}
        </p>
      </div>
      {applications}
    </>
  );
}
