// Side panel: toolbar (title, active resume, refresh) + fill report of the current tab.
// Layout follows DESIGN-SYSTEM §6.2-B: a `paper` page with `surface` islands, no shadows.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldReport } from '../../src/engine/types';
import { resolveLanguage, setLanguage, useT } from '../../src/i18n';
import { setUiLanguage } from '../../src/storage';
import { LanguageToggle } from '../../src/ui/LanguageToggle';
import type { StatusGroupId } from '../../src/ui/status';
import { FilterChips } from './FilterChips';
import { countGroups, filterByGroups, sortBySeverity, toggleGroup } from './model';
import { EmptyState, IconButton, LoadingList, Notice, Toast } from './parts';
import { ReportList } from './ReportList';
import { ResumeSwitcher } from './ResumeSwitcher';
import { useActiveTab } from './useActiveTab';
import { useFieldActions } from './useFieldActions';
import { useProfile } from './useProfile';
import { useReport } from './useReport';
import '../../src/ui/fonts.css';
import '../../src/ui/theme.css';
import './sidepanel.css';

const NO_FIELDS: readonly FieldReport[] = [];

export default function App() {
  const t = useT();
  const { profile } = useProfile();
  const tabId = useActiveTab();
  const { report, loading, error, reload, patchField } = useReport(tabId);
  const { focus, apply } = useFieldActions(tabId, patchField);
  const [selected, setSelected] = useState<ReadonlySet<StatusGroupId>>(new Set());
  const [switchFailed, setSwitchFailed] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  // UI language follows the stored setting.
  const uiLanguage = profile?.settings.uiLanguage ?? 'auto';
  useEffect(() => {
    const language = resolveLanguage(uiLanguage, navigator.language);
    setLanguage(language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [uiLanguage]);
  useEffect(() => {
    document.title = t('panel.title');
  }, [t]);

  const fields = report?.fields ?? NO_FIELDS;
  const counts = useMemo(() => countGroups(fields), [fields]);
  const rows = useMemo(() => sortBySeverity(filterByGroups(fields, selected)), [fields, selected]);

  const dismissToast = useCallback(() => setToast(null), []);
  const onApplied = useCallback(() => setToast({ id: Date.now(), text: t('panel.applied') }), [t]);

  // One sentence in the same groups as the chips (and the FAB card): filled, to review, not filled.
  // "No data" is neutral and never counted as something to look at.
  const { filled, review, failed } = counts;
  const summary =
    review > 0 && failed > 0
      ? t('panel.summaryBoth', { filled, review, failed })
      : review > 0
        ? t('panel.summaryReview', { filled, review })
        : failed > 0
          ? t('panel.summaryFailed', { filled, failed })
          : t('panel.summaryClear', { filled });

  return (
    <div className="raf-panel-app">
      <header className="raf-header">
        <div className="raf-toolbar raf-toolbar--rows">
          <div className="raf-toolbar-row">
            <h1 className="raf-toolbar-title">{t('panel.title')}</h1>
            <div className="raf-toolbar-end">
              {/* A failed write leaves the language as it was, which the toggle then still shows: nothing else to say. */}
              <LanguageToggle onChange={(language) => void setUiLanguage(language).catch(() => undefined)} />
              <IconButton icon="arrow-clockwise" label={t('panel.refresh')} onClick={reload} />
            </div>
          </div>
          {profile ? (
            profile.resumes.length > 0 ? (
              <div className="raf-toolbar-row">
                <ResumeSwitcher profile={profile} onError={(message) => setSwitchFailed(message !== null)} />
              </div>
            ) : null
          ) : (
            <div className="raf-toolbar-row">
              <span className="raf-skeleton raf-skeleton-select" aria-hidden="true" />
            </div>
          )}
        </div>
      </header>

      <main className="raf-main">
        {profile && profile.resumes.length === 0 ? <Notice>{t('panel.noResume')}</Notice> : null}
        {switchFailed ? <Notice tone="danger">{t('panel.switchError')}</Notice> : null}
        {error ? (
          <Notice
            tone="danger"
            title={t('panel.error.title')}
            action={
              <button type="button" className="raf-btn" onClick={reload}>
                {t('panel.retry')}
              </button>
            }
          >
            {t('panel.error.text')}
          </Notice>
        ) : null}

        {loading && tabId !== null ? (
          <LoadingList />
        ) : fields.length === 0 ? (
          error ? null : <EmptyState icon="file-earmark-text" title={t('panel.emptyTitle')} text={t('panel.empty')} />
        ) : (
          <>
            <section className="raf-overview">
              <p className="raf-summary">{summary}</p>
              <FilterChips
                counts={counts}
                total={fields.length}
                selected={selected}
                onToggle={(g) => setSelected((prev) => toggleGroup(prev, g))}
                onClear={() => setSelected(new Set())}
              />
            </section>
            {rows.length === 0 ? (
              <EmptyState compact icon="search" text={t('panel.filter.none')} />
            ) : (
              <ReportList fields={rows} onFocus={focus} onApply={apply} onApplied={onApplied} />
            )}
          </>
        )}
      </main>

      <div className="raf-toast-stack" role="status">
        {toast ? <Toast key={toast.id} text={toast.text} onDismiss={dismissToast} /> : null}
      </div>
    </div>
  );
}
