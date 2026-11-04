// Side panel: active resume switcher + fill report of the current tab.
import { useEffect, useMemo, useState } from 'react';
import type { FieldReport, Outcome } from '../../src/engine/types';
import { resolveLanguage, setLanguage, useT } from '../../src/i18n';
import { FilterChips } from './FilterChips';
import { countOutcomes, filterByOutcomes, sortBySeverity, toggleOutcome } from './model';
import { ReportTable } from './ReportTable';
import { ResumeSwitcher } from './ResumeSwitcher';
import { useActiveTab } from './useActiveTab';
import { useFieldActions } from './useFieldActions';
import { useProfile } from './useProfile';
import { useReport } from './useReport';
import '../../src/ui/theme.css';
import './sidepanel.css';

const NO_FIELDS: readonly FieldReport[] = [];

export default function App() {
  const t = useT();
  const { profile } = useProfile();
  const tabId = useActiveTab();
  const { report, loading, patchField } = useReport(tabId);
  const { focus, apply } = useFieldActions(tabId, patchField);
  const [selected, setSelected] = useState<ReadonlySet<Outcome>>(new Set());

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
  const counts = useMemo(() => countOutcomes(fields), [fields]);
  const rows = useMemo(() => sortBySeverity(filterByOutcomes(fields, selected)), [fields, selected]);

  return (
    <div className="raf-panel-app">
      <header className="raf-header">
        <h1>{t('panel.title')}</h1>
        {profile ? <ResumeSwitcher profile={profile} /> : <span className="raf-muted">{t('panel.loading')}</span>}
      </header>

      <main className="raf-main">
        {loading && tabId !== null ? (
          <p className="raf-muted raf-pad">{t('panel.loading')}</p>
        ) : fields.length === 0 ? (
          <p className="raf-empty raf-muted raf-pad">{t('panel.empty')}</p>
        ) : (
          <>
            <p className="raf-summary raf-muted">{t('panel.summary', { total: fields.length, filled: counts.filled })}</p>
            <FilterChips
              counts={counts}
              selected={selected}
              onToggle={(o) => setSelected((prev) => toggleOutcome(prev, o))}
              onClear={() => setSelected(new Set())}
            />
            {rows.length === 0 ? (
              <p className="raf-muted raf-pad">{t('panel.filter.none')}</p>
            ) : (
              <ReportTable fields={rows} onFocus={focus} onApply={apply} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
