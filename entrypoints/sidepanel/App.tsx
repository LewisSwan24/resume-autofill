// Side panel: toolbar (title, active resume, the way to the profile and help pages, refresh) + fill report of the current tab.
// Layout follows DESIGN-SYSTEM §6.2-B: a `paper` page with `surface` islands, no shadows.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldReport } from '../../src/engine/types';
import { resolveLanguage, setLanguage, useT } from '../../src/i18n';
import { loadProfile, saveProfile, setUiLanguage } from '../../src/storage';
import { Icon } from '../../src/ui/Icon';
import { LanguageToggle } from '../../src/ui/LanguageToggle';
import { HELP_PAGE, openExtensionPage, openProfilePage } from '../../src/ui/pages';
import type { StatusGroupId } from '../../src/ui/status';
import { isHeldAnswer, isRetryable } from '../../src/fill/report';
import { FilterChips } from './FilterChips';
import { countGroups, filterByGroups, sortBySeverity, toggleGroup } from './model';
import { EmptyState, IconButton, LoadingList, Notice, Toast } from './parts';
import { PreviewList, type PreviewCommitPayload } from './PreviewList';
import { EntryOverview } from './EntryOverview';
import { ReportList } from './ReportList';
import { ResumeSwitcher } from './ResumeSwitcher';
import { useActiveTab } from './useActiveTab';
import { useFieldActions } from './useFieldActions';
import { usePreview } from './usePreview';
import { useProfile } from './useProfile';
import { useReport } from './useReport';
import { browser } from 'wxt/browser';
import type { InspectorTargetInfo } from '../../src/content/inspector';
import { FIELD_KEYS, materializeResume, type SiteRecipe, type SiteRecipeFingerprint } from '../../src/schema';
import { wizardKey, type WizardSessionState } from '../../src/background/wizardSession';
import { isFromExtension, isValidMessage, sendToBackground } from '../../src/messaging';
import { isHttpUrl, recordFillApplication } from '../../src/tracker';
import '../../src/ui/fonts.css';
import '../../src/ui/theme.css';
import './sidepanel.css';

const NO_FIELDS: readonly FieldReport[] = [];

/** The way to the profile editor (the options page), with its word: an icon alone was not found. */
function ProfileButton({ label }: { label: string }) {
  return (
    <button type="button" className="raf-btn raf-profile-btn" onClick={openProfilePage}>
      <Icon name="person-vcard" />
      <span className="raf-btn-text">{label}</span>
    </button>
  );
}

export default function App() {
  const t = useT();
  const { profile, vaultLocked } = useProfile();
  const tabId = useActiveTab();
  const preview = usePreview(tabId, Boolean(profile?.settings.previewBeforeFill));
  const { report, loading, error, reload, patchField } = useReport(tabId);
  const { focus, apply, fillOne } = useFieldActions(tabId, patchField);
  const [retryBusy, setRetryBusy] = useState(false);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<StatusGroupId>>(new Set());
  const [switchFailed, setSwitchFailed] = useState(false);
  const [inspectorActive, setInspectorActive] = useState(false);
  const [pickedState, setPickedState] = useState<{ url: string; target: InspectorTargetInfo } | null>(null);
  const [pickedFieldKey, setPickedFieldKey] = useState<string>(FIELD_KEYS[0]?.key ?? 'basics.familyName');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [wizard, setWizard] = useState<WizardSessionState | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  // UI language follows the stored setting. Until the profile is read the panel keeps the language it has,
  // so a Chinese setting does not flash the browser's English first.
  const uiLanguage = profile?.settings.uiLanguage;
  useEffect(() => {
    if (!uiLanguage) return;
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

  const retryCount = useMemo(() => fields.filter(isRetryable).length, [fields]);
  const retry = useCallback(async () => {
    if (tabId === null) return;
    setRetryBusy(true);
    try {
      const res = await sendToBackground({ type: 'fill:retry', tabId });
      setToast({ id: Date.now(), text: res?.ok ? t('panel.retryDone') : t('panel.retryFailed', { message: res?.error ?? t('panel.noResponse') }) });
    } catch (error) {
      setToast({ id: Date.now(), text: t('panel.retryFailed', { message: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setRetryBusy(false);
    }
  }, [tabId, t]);

  // A page holding an earlier resume (a site's own resume, being updated): the resume's answers over every box that
  // kept its own, one box after another, the way "fill this one" writes one.
  const heldRows = useMemo(() => fields.filter(isHeldAnswer), [fields]);
  const replaceHeld = useCallback(async () => {
    setReplaceBusy(true);
    try {
      let done = 0;
      for (const field of heldRows) if ((await fillOne(field, field.fieldKey!)).ok) done += 1;
      setToast({ id: Date.now(), text: done === heldRows.length ? t('panel.replaceHeldDone', { done }) : t('panel.replaceHeldPartial', { done, left: heldRows.length - done }) });
    } finally {
      setReplaceBusy(false);
    }
  }, [heldRows, fillOne, t]);

  const commitPreview = useCallback(
    async (payload: PreviewCommitPayload) => {
      if (tabId === null) return;
      setPreviewBusy(true);
      try {
        await sendToBackground({ type: 'fill:commitPreview', tabId, ...payload });
      } finally {
        setPreviewBusy(false);
      }
    },
    [tabId],
  );

  const cancelPreview = useCallback(() => {
    if (tabId === null) return;
    void sendToBackground({ type: 'fill:cancelPreview', tabId }).catch(() => undefined);
  }, [tabId]);

  const activeResume = useMemo(() => {
    const raw = profile?.resumes.find((r) => r.id === profile.activeResumeId) ?? null;
    return raw && profile ? materializeResume(raw, profile.resumes) : raw;
  }, [profile]);

  useEffect(() => {
    setWizard(null);
    if (tabId === null) return;
    const key = wizardKey(tabId);
    void browser.storage.session
      .get(key)
      .then((stored) => {
        const res = stored[key] as WizardSessionState | undefined;
        if (res && typeof res.stepCount === 'number') setWizard(res);
      })
      .catch(() => undefined);
  }, [tabId, report?.finishedAt]);

  const persistLearnedSiteRule = useCallback(
    async (
      url: string,
      opts: { fingerprint: SiteRecipeFingerprint; fieldKey?: string | null; constantValue?: string },
    ): Promise<string | null> => {
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        return null;
      }
      if (!host) return null;
      const current = await loadProfile();
      const recipeId = `user-${host.replace(/[^a-z0-9.-]/gi, '_')}`;
      const existing = current.recipes ?? [];
      const idx = existing.findIndex((r) => r.id === recipeId);
      const newRule = {
        id: `rule-${Date.now()}`,
        fingerprint: opts.fingerprint,
        ...(opts.fieldKey ? { fieldKey: opts.fieldKey } : {}),
        ...(opts.constantValue?.trim() ? { constantValue: opts.constantValue.trim() } : {}),
        transformPreset: 'trim' as const,
      };
      const baseRecipe: SiteRecipe =
        idx >= 0
          ? existing[idx]!
          : {
              id: recipeId,
              name: host,
              hostPattern: host,
              enabled: true,
              updatedAt: Date.now(),
              rules: [],
            };
      const updatedRecipe: SiteRecipe = {
        ...baseRecipe,
        updatedAt: Date.now(),
        rules: [...baseRecipe.rules, newRule].slice(-100),
      };
      const nextRecipes = idx >= 0 ? existing.map((r, i) => (i === idx ? updatedRecipe : r)) : [...existing, updatedRecipe];
      await saveProfile({ ...current, recipes: nextRecipes });
      return host;
    },
    [],
  );

  useEffect(() => {
    setInspectorActive(false);
    setPickedState(null);
    if (tabId === null) return;
    const pickKey = `inspectorPick:${tabId}`;
    browser.storage.session
      .get(pickKey)
      .then((stored) => {
        const val = stored[pickKey] as { url?: string; target?: InspectorTargetInfo } | undefined;
        if (val?.target && typeof val.url === 'string') {
          setPickedState({ url: val.url, target: val.target });
          setPickedFieldKey(val.target.fieldKey ?? FIELD_KEYS[0]?.key ?? 'basics.familyName');
        }
      })
      .catch(() => undefined);

    const onMessage = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (!isFromExtension(sender) || sender.tab != null || !isValidMessage(message)) return;
      if (message.type === 'wizard:updated' && message.tabId === tabId) {
        const next = message.session;
        setWizard(next && typeof next.stepCount === 'number' ? next : null);
        return;
      }
      if (message.type === 'inspector:picked' && 'tabId' in message && message.tabId === tabId) {
        setInspectorActive(false);
        setPickedState({ url: message.url, target: message.target });
        setPickedFieldKey(message.target.fieldKey ?? FIELD_KEYS[0]?.key ?? 'basics.familyName');
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [tabId]);

  const recordFieldRecipe = useCallback(
    async (field: FieldReport, answerText: string) => {
      if (tabId === null || field.frameId === undefined || !report?.url) return;
      const fp = await sendToBackground({
        type: 'field:captureFingerprint',
        tabId,
        frameId: field.frameId,
        fieldId: field.fieldId,
      }).catch(() => null);
      if (!fp) {
        setToast({ id: Date.now(), text: t('panel.recipe.failed') });
        return;
      }
      const savedHost = await persistLearnedSiteRule(report.url, {
        fingerprint: fp,
        fieldKey: field.fieldKey,
        constantValue: answerText,
      });
      if (savedHost) setToast({ id: Date.now(), text: t('panel.recipe.recorded') });
    },
    [tabId, report?.url, persistLearnedSiteRule, t],
  );

  const savePickedInspectorRule = useCallback(async () => {
    if (!pickedState) return;
    const host = await persistLearnedSiteRule(pickedState.url, {
      fingerprint: pickedState.target.fingerprint,
      fieldKey: pickedFieldKey,
    });
    if (host) {
      setToast({ id: Date.now(), text: t('panel.inspector.saved', { host, fieldKey: pickedFieldKey }) });
      if (tabId !== null) {
        void browser.storage.session.remove(`inspectorPick:${tabId}`).catch(() => undefined);
      }
      setPickedState(null);
    }
  }, [pickedState, pickedFieldKey, persistLearnedSiteRule, tabId, t]);

  const saveCustomAnswer = useCallback(async (question: string, answer: string) => {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) return;
    const current = await loadProfile();
    const targetId = current.activeResumeId;
    if (!targetId) return;
    const now = Date.now();
    const nextResumes = current.resumes.map((r) => {
      if (r.id !== targetId) return r;
      const idx = r.customAnswers.findIndex((item) => item.question.trim().toLowerCase() === q.toLowerCase());
      const customAnswers =
        idx >= 0
          ? r.customAnswers.map((item, i) => (i === idx ? { question: q, answer: a } : item))
          : [...r.customAnswers, { question: q, answer: a }];
      return { ...r, customAnswers, updatedAt: now };
    });
    await saveProfile({ ...current, resumes: nextResumes });
  }, []);

  const saveReportToTracker = useCallback(async () => {
    if (!report || !isHttpUrl(report.url)) return;
    const activeResume = profile?.resumes.find((r) => r.id === profile.activeResumeId);
    await recordFillApplication({
      url: report.url,
      filled: counts.filled,
      attention: counts.review + counts.failed,
      skipped: Math.max(0, fields.length - counts.filled - counts.review - counts.failed),
      ...(profile?.activeResumeId ? { resumeId: profile.activeResumeId } : {}),
      ...(activeResume ? { variantId: activeResume.id, variantTitle: activeResume.title } : {}),
      locale: activeResume?.locale,
    });
    setToast({ id: Date.now(), text: t('panel.savedTracker') });
  }, [report, counts, fields.length, profile, t]);

  return (
    <div className="raf-panel-app">
      <header className="raf-header">
        <div className="raf-toolbar raf-toolbar--rows">
          <div className="raf-toolbar-row">
            <h1 className="raf-toolbar-title">{t('panel.title')}</h1>
            <div className="raf-toolbar-end">
              {/* A failed write leaves the language as it was, which the toggle then still shows: nothing else to say. */}
              <LanguageToggle onChange={(language) => void setUiLanguage(language).catch(() => undefined)} />
              <IconButton icon="book" label={t('common.help')} onClick={() => openExtensionPage(HELP_PAGE)} />
              <IconButton icon="arrow-clockwise" label={t('panel.refresh')} onClick={reload} />
            </div>
          </div>
          {profile ? (
            <>
              {profile.resumes.length > 0 ? (
                <div className="raf-toolbar-row">
                  <ResumeSwitcher profile={profile} onError={(message) => setSwitchFailed(message !== null)} />
                </div>
              ) : null}
              <div className="raf-toolbar-row">
                <ProfileButton label={t('common.editProfile')} />
                {tabId !== null ? (
                  <button
                    type="button"
                    className={`raf-btn${inspectorActive ? ' raf-btn-primary' : ''}`}
                    aria-pressed={inspectorActive}
                    onClick={() => {
                      const next = !inspectorActive;
                      setInspectorActive(next);
                      void sendToBackground({
                        type: next ? 'inspector:start' : 'inspector:stop',
                        tabId,
                      }).catch(() => undefined);
                    }}
                  >
                    <Icon name="search" size={14} />
                    <span>{t(inspectorActive ? 'panel.inspector.stop' : 'panel.inspector.start')}</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="raf-toolbar-row">
              <span className="raf-skeleton raf-skeleton-select" aria-hidden="true" />
            </div>
          )}
        </div>
      </header>

      <main className="raf-main">
        {inspectorActive ? <p className="raf-help">{t('panel.inspector.activeHint')}</p> : null}
        {pickedState ? (
          <section className="raf-inspector-panel" aria-label={t('panel.inspector.pickedTitle', { label: pickedState.target.label })}>
            <strong>{t('panel.inspector.pickedTitle', { label: pickedState.target.label })}</strong>
            <div className="raf-inspector-form">
              <select
                className="raf-inspector-select"
                aria-label={t('panel.inspector.fieldKeyLabel')}
                value={pickedFieldKey}
                onChange={(e) => setPickedFieldKey(e.target.value)}
              >
                {FIELD_KEYS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.key}
                  </option>
                ))}
              </select>
              <button type="button" className="raf-btn raf-btn-primary raf-btn-small" onClick={() => void savePickedInspectorRule()}>
                {t('panel.inspector.saveRule')}
              </button>
              <button type="button" className="raf-btn raf-btn-small" aria-label={t('common.close')} onClick={() => setPickedState(null)}>
                <Icon name="x-lg" size={14} />
              </button>
            </div>
          </section>
        ) : null}
        {vaultLocked ? (
          <Notice
            tone="danger"
            title={t('panel.vaultLockedTitle')}
            action={<ProfileButton label={t('panel.vaultUnlockBtn')} />}
          >
            {t('panel.vaultLockedText')}
          </Notice>
        ) : null}
        {wizard && wizard.stepCount > 0 ? (
          <Notice
            action={
              <>
                {wizard.advance?.running ? (
                  <button
                    type="button"
                    className="raf-btn raf-btn-small"
                    onClick={() => {
                      if (tabId !== null) void sendToBackground({ type: 'wizard:stopAdvance', tabId }).catch(() => undefined);
                    }}
                  >
                    {t('common.advance.stop')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="raf-btn raf-btn-primary raf-btn-small"
                    onClick={() => {
                      if (tabId !== null) void sendToBackground({ type: 'wizard:autoAdvance', tabId }).catch(() => undefined);
                    }}
                  >
                    {t('common.advance.start')}
                  </button>
                )}
                <button
                  type="button"
                  className="raf-btn raf-btn-small"
                  onClick={() => {
                    if (tabId !== null) void sendToBackground({ type: 'wizard:clear', tabId }).catch(() => undefined);
                    setWizard(null);
                  }}
                >
                  {t('panel.wizard.reset')}
                </button>
              </>
            }
          >
            {t('panel.wizard.banner', { step: wizard.stepCount, title: wizard.resumeTitle })}
            {wizard.advance?.running ? (
              <>
                <br />
                <span data-testid="panel-wizard-advance">{t('common.advance.running', { n: wizard.advance.steps })}</span>
              </>
            ) : wizard.advance?.stopReason ? (
              <>
                <br />
                <span data-testid="panel-wizard-advance">{t(`common.advance.stop.${wizard.advance.stopReason}`)}</span>
              </>
            ) : (
              <>
                <br />
                <span data-testid="panel-wizard-advance">{t('common.advance.hint')}</span>
              </>
            )}
          </Notice>
        ) : null}
        {profile && profile.resumes.length === 0 ? (
          <Notice action={<ProfileButton label={t('common.fillProfile')} />}>{t('panel.noResume')}</Notice>
        ) : null}
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

        {preview && tabId !== null ? (
          <PreviewList
            preview={preview}
            busy={previewBusy}
            onFocus={(frameId, fieldId) => focus({ frameId, fieldId } as FieldReport)}
            onCommit={(payload) => void commitPreview(payload)}
            onCancel={cancelPreview}
          />
        ) : loading && tabId !== null ? (
          <LoadingList />
        ) : fields.length === 0 ? (
          error ? null : (
            <EmptyState
              icon="file-earmark-text"
              title={t('panel.emptyTitle')}
              text={t('panel.empty')}
              action={<ProfileButton label={t('common.fillProfile')} />}
            />
          )
        ) : (
          <>
            <section className="raf-overview">
              <div className="raf-overview-head">
                <p className="raf-summary">{summary}</p>
                {retryCount > 0 ? (
                  <button type="button" className="raf-btn" disabled={retryBusy} onClick={() => void retry()}>
                    <Icon name="arrow-clockwise" size={14} />
                    <span>{t('panel.retryRows', { n: retryCount })}</span>
                  </button>
                ) : null}
                {heldRows.length > 0 ? (
                  <button type="button" className="raf-btn" disabled={replaceBusy} onClick={() => void replaceHeld()}>
                    <Icon name="arrow-clockwise" size={14} />
                    <span>{t('panel.replaceHeld', { n: heldRows.length })}</span>
                  </button>
                ) : null}
                {report && isHttpUrl(report.url) ? (
                  <button type="button" className="raf-btn" onClick={() => void saveReportToTracker()}>
                    <Icon name="check-circle" size={14} />
                    <span>{t('panel.saveTracker')}</span>
                  </button>
                ) : null}
              </div>
              {report?.entries?.length ? <EntryOverview entries={report.entries} fields={report.fields} /> : null}
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
              <ReportList
                fields={rows}
                resume={activeResume}
                settings={profile?.settings}
                onFocus={focus}
                onApply={apply}
                onFillOne={fillOne}
                onSaveCustomAnswer={saveCustomAnswer}
                onRecordRecipe={report?.url ? recordFieldRecipe : undefined}
                onApplied={onApplied}
              />
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
