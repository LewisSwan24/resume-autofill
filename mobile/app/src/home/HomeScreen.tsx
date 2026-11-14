// Home (首页): the resume used for filling, the paste-a-link box, and recent application pages. Recent pages live in
// app state (state.enc), not in the profile; every change is saved at once and can be undone from the toast.
import type { Locale, Profile } from '../../../../src/schema';
import { useMT } from '../i18n';
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
  onOpenSettings: () => void;
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
  onOpenSettings,
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
        onOpenSettings={onOpenSettings}
      />
      <PasteLinkCard
        showToast={showToast}
        onSave={(link) => save((s) => addRecentPage(s, { url: link.url, host: link.host, title: link.title }, now()))}
      />
      <RecentPages pages={appState.recentPages} now={now()} onRemove={(p) => void remove(p)} onClear={() => void clear()} showToast={showToast} />
    </>
  );
}
