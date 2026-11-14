// Home (首页): the resume used for filling, the paste-a-link box (opens the fill browser), the sample form, and recent
// application pages. Recent pages live in app state (state.enc), not in the profile; every change is saved at once and
// can be undone from the toast. The sample form is never written to recent pages.
import type { Locale, Profile } from '../../../../src/schema';
import { DEMO_URL } from '../browser/model/constants';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { BrowserOpen } from '../navigation';
import type { AppState, RecentPage } from '../store/appStateStore';
import { addRecentPage, clearRecentPages, removeRecentPage, restoreRecentPages } from '../store/recentPages';
import type { ToastMessage } from '../ui';
import { PasteLinkCard } from './PasteLinkCard';
import { RecentPages } from './RecentPages';
import { ResumeSummaryCard } from './ResumeSummaryCard';
import type { JumpTarget } from './summary';

export interface HomeScreenProps {
  profile: Profile | null;
  loadError: string | null;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  /** No target: the 简历 tab root. */
  onJump: (resumeId: string, target?: JumpTarget) => void;
  onStartResume: (locale: Locale) => void;
  onImport: () => void;
  /** Read a PDF or Word resume. */
  onImportResume?: () => void;
  onOpenSettings: () => void;
  /** Open a page (or the sample form) in the fill browser. */
  onOpenBrowser: (target: BrowserOpen) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  now?: () => number;
}

export function HomeScreen({
  profile,
  loadError,
  appState,
  updateAppState,
  onJump,
  onStartResume,
  onImport,
  onImportResume,
  onOpenSettings,
  onOpenBrowser,
  showToast,
  now = Date.now,
}: HomeScreenProps) {
  const t = useMT();

  /** Save a change; on failure say so (the hook has already put the stored list back on screen). */
  const save = async (change: (s: AppState) => AppState) => {
    const ok = await updateAppState(change);
    if (!ok) showToast({ text: t('m.saveStateFailed') });
    return ok;
  };

  const undoTo = (pages: readonly RecentPage[]) => ({
    label: t('options.undo'),
    onClick: () => void save((s) => restoreRecentPages(s, pages)),
  });

  const remove = async (page: RecentPage) => {
    const before = appState.recentPages;
    if (await save((s) => removeRecentPage(s, page.id))) {
      showToast({ text: t('m.recent.removed', { host: page.host }), action: undoTo(before) });
    }
  };

  /** Put the page on top of recent pages (same id when listed) and open it; a failed save still opens it, and says so
   * after the browser is asked to open, so the words land where the person will be looking (the browser's toast slot). */
  const openPage = async (page: { url: string; host: string; title?: string }, source: 'paste' | 'recent') => {
    let recentId: string | undefined;
    const ok = await updateAppState((s) => {
      const next = addRecentPage(s, page, now());
      recentId = next.recentPages[0]?.id;
      return next;
    });
    onOpenBrowser({ url: page.url, demo: false, ...(recentId ? { recentId } : {}), source });
    if (!ok) showToast({ text: t('m.saveStateFailed') });
  };

  const clear = async () => {
    const before = appState.recentPages;
    if (await save(clearRecentPages)) showToast({ text: t('m.recent.cleared'), action: undoTo(before) });
  };

  return (
    <>
      <header className="m-header">
        <h1 className="m-title" tabIndex={-1}>
          {t('m.home.title')}
        </h1>
      </header>
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
      <PasteLinkCard showToast={showToast} onOpen={(link) => openPage({ url: link.url, host: link.host, title: link.title }, 'paste')} />
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
      <RecentPages
        pages={appState.recentPages}
        now={now()}
        onOpen={(p) => void openPage({ url: p.url, host: p.host }, 'recent')}
        onRemove={(p) => void remove(p)}
        onClear={() => void clear()}
        showToast={showToast}
      />
    </>
  );
}
