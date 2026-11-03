// Options page: resume library editor.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARRAY_MODULES,
  MODULES,
  addResume,
  createResume,
  duplicateResume,
  getModule,
  issuesForResume,
  pruneMissingAttachments,
  referencedFileIds,
  removeResume,
  setActive,
  setAttachment,
  setLinkedResume,
  updateResume,
  type ArrayModuleName,
  type AttachmentSlot,
  type ModuleName,
} from '../../src/editor';
import { resolveLanguage, setLanguage, useT } from '../../src/i18n';
import type { Locale, Profile, Resume } from '../../src/schema';
import { deleteFile, getFile, putFile } from '../../src/storage';
import { Attachments, MAX_ATTACHMENT_MB } from './Attachments';
import { ModuleForm } from './ModuleForm';
import { ResumeList } from './ResumeList';
import { DataPanel, SettingsPanel } from './SidePanels';
import { useProfileEditor, type SaveStatus } from './useProfileEditor';
import './options.css';

export interface AppProps {
  /** Autosave debounce; production uses 500 ms (tests shorten it). */
  autosaveDelayMs?: number;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function StatusBadge({ status, error, issueCount }: { status: SaveStatus; error: string | null; issueCount: number }) {
  const t = useT();
  if (status === 'idle') return <span className="raf-status" role="status" />;
  const text =
    status === 'saved'
      ? `✓ ${t('options.saved')}`
      : status === 'error'
        ? t('options.saveError', { message: error ?? '' })
        : status === 'invalid'
          ? t('options.invalid', { count: issueCount })
          : t('options.saving');
  return (
    <span className={`raf-status is-${status}`} role="status" data-status={status}>
      {text}
    </span>
  );
}

export default function App({ autosaveDelayMs }: AppProps = {}) {
  const t = useT();
  const { profile, loadError, status, saveError, issues, commit } = useProfileEditor(autosaveDelayMs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ModuleName>('basics');
  const [attachErrors, setAttachErrors] = useState<Partial<Record<AttachmentSlot, string>>>({});

  // Handlers run after awaits; always read the newest profile through this ref.
  const latest = useRef<Profile | null>(profile);
  latest.current = profile;

  // UI language follows the stored setting.
  const uiLanguage = profile?.settings.uiLanguage ?? 'auto';
  useEffect(() => {
    const language = resolveLanguage(uiLanguage, navigator.language);
    setLanguage(language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [uiLanguage]);
  useEffect(() => {
    document.title = t('options.title');
  }, [t]);

  const resume: Resume | null = useMemo(() => {
    if (!profile) return null;
    return (
      profile.resumes.find((r) => r.id === selectedId) ??
      profile.resumes.find((r) => r.id === profile.activeResumeId) ??
      profile.resumes[0] ??
      null
    );
  }, [profile, selectedId]);
  const resumeIndex = resume && profile ? profile.resumes.indexOf(resume) : -1;
  const resumeIssues = useMemo(() => issuesForResume(issues, resumeIndex), [issues, resumeIndex]);

  // ---------------------------------------------------------------- resume-level actions

  const editResume = (next: Resume) => {
    if (profile && resume) void commit(updateResume(profile, resume.id, () => next));
  };

  const createNew = (locale: Locale) => {
    if (!profile) return;
    const created = createResume({ title: t('options.defaultTitle'), locale });
    void commit(addResume(profile, created, { activate: profile.resumes.length === 0 }), { immediate: true });
    setSelectedId(created.id);
    setTab('basics');
  };

  const duplicate = () => {
    if (!profile || !resume) return;
    const copy = duplicateResume(resume, { title: `${resume.title}${t('options.copySuffix')}` });
    void commit(addResume(profile, copy), { immediate: true });
    setSelectedId(copy.id);
  };

  const remove = async () => {
    if (!profile || !resume) return;
    if (!window.confirm(t('options.confirmDelete', { title: resume.title }))) return;
    const next = removeResume(profile, resume.id);
    setSelectedId(null);
    await commit(next, { immediate: true });
    // Attachment files nobody references any more would only waste space.
    const keep = referencedFileIds(next);
    for (const id of referencedFileIds({ ...profile, resumes: [resume] })) {
      if (!keep.has(id)) await deleteFile(id).catch(() => undefined);
    }
  };

  // ---------------------------------------------------------------- attachments

  const uploadAttachment = async (slot: AttachmentSlot, file: File) => {
    if (!resume) return;
    const resumeId = resume.id;
    const setError = (message: string | null) => setAttachErrors((prev) => ({ ...prev, [slot]: message ?? undefined }));
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setError(t('options.attach.tooLarge', { max: MAX_ATTACHMENT_MB }));
      return;
    }
    try {
      const id = await putFile({ name: file.name, type: file.type || 'application/octet-stream', blob: file });
      const current = latest.current;
      const old = current?.resumes.find((r) => r.id === resumeId)?.attachments[slot];
      if (!current) return;
      const next = updateResume(current, resumeId, (r) => setAttachment(r, slot, id));
      setError(null);
      await commit(next, { immediate: true });
      if (old && !referencedFileIds(next).has(old)) await deleteFile(old);
    } catch (error) {
      setError(t('options.attach.error', { message: messageOf(error) }));
    }
  };

  const removeAttachment = async (slot: AttachmentSlot) => {
    if (!profile || !resume) return;
    const old = resume.attachments[slot];
    const next = updateResume(profile, resume.id, (r) => setAttachment(r, slot, null));
    setAttachErrors((prev) => ({ ...prev, [slot]: undefined }));
    await commit(next, { immediate: true });
    if (old && !referencedFileIds(next).has(old)) await deleteFile(old).catch(() => undefined);
  };

  // ---------------------------------------------------------------- import

  const importProfile = async (imported: Profile) => {
    // Files are not exported: forget attachment ids whose bytes do not exist in this browser.
    const existing = new Set<string>();
    for (const id of referencedFileIds(imported)) {
      if (await getFile(id).catch(() => undefined)) existing.add(id);
    }
    await commit(pruneMissingAttachments(imported, existing), { immediate: true });
    setSelectedId(null);
  };

  // ---------------------------------------------------------------- render

  const settingsPanels = (
    <>
      {profile ? <SettingsPanel settings={profile.settings} onChange={(settings) => void commit({ ...profile, settings })} /> : null}
      <DataPanel profile={profile} onImport={importProfile} />
    </>
  );

  if (!profile) {
    return (
      <div className="raf-app">
        <header className="raf-header">
          <h1>{t('options.title')}</h1>
        </header>
        {loadError ? (
          <div className="raf-body raf-body-single">
            <p role="alert" className="raf-error">
              {loadError}
            </p>
            {settingsPanels}
          </div>
        ) : (
          <p className="raf-muted raf-pad">{t('options.loading')}</p>
        )}
      </div>
    );
  }

  const meta = getModule(tab);
  const others = profile.resumes.filter((r) => r.id !== resume?.id);

  return (
    <div className="raf-app">
      <header className="raf-header">
        <h1>{t('options.title')}</h1>
        <span className="raf-muted">{t('options.subtitle')}</span>
        <StatusBadge status={status} error={saveError} issueCount={issues.length} />
      </header>

      <div className="raf-body">
        <aside className="raf-side">
          <ResumeList profile={profile} selectedId={resume?.id ?? null} onSelect={setSelectedId} onCreate={createNew} />
          {settingsPanels}
        </aside>

        <main className="raf-main">
          {!resume ? (
            <p className="raf-muted raf-pad">{t('options.empty')}</p>
          ) : (
            <>
              <section className="raf-card raf-resume-head" aria-label={t('options.resumeTitle')}>
                <label className="raf-field raf-grow">
                  <span className="raf-label">{t('options.resumeTitle')}</span>
                  <input type="text" value={resume.title} onChange={(e) => editResume({ ...resume, title: e.target.value })} />
                </label>
                <div className="raf-field">
                  <span className="raf-label">{t('options.locale')}</span>
                  <span className="raf-badge">{resume.locale}</span>
                </div>
                <label className="raf-field">
                  <span className="raf-label">{t('options.linked')}</span>
                  <select
                    value={resume.linkedResumeId ?? ''}
                    title={t('options.linkHint')}
                    onChange={(e) => void commit(setLinkedResume(profile, resume.id, e.target.value || null))}
                  >
                    <option value="">{t('options.linkNone')}</option>
                    {others.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} ({r.locale})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="raf-row raf-actions">
                  <button type="button" disabled={resume.id === profile.activeResumeId} onClick={() => void commit(setActive(profile, resume.id), { immediate: true })}>
                    {resume.id === profile.activeResumeId ? `★ ${t('options.active')}` : t('options.setActive')}
                  </button>
                  <button type="button" onClick={duplicate}>
                    {t('options.duplicate')}
                  </button>
                  <button type="button" className="raf-danger" onClick={() => void remove()}>
                    {t('options.delete')}
                  </button>
                </div>
              </section>

              <div className="raf-tabs" role="tablist" aria-label={t('options.title')}>
                {MODULES.map((m) => {
                  const count = (ARRAY_MODULES as readonly string[]).includes(m.module)
                    ? (resume[m.module as ArrayModuleName] as unknown[]).length
                    : 0;
                  return (
                    <button
                      key={m.module}
                      type="button"
                      role="tab"
                      aria-selected={m.module === tab}
                      className={m.module === tab ? 'is-selected' : ''}
                      onClick={() => setTab(m.module)}
                    >
                      {t(m.labelKey)}
                      {count > 0 ? <span className="raf-count">{count}</span> : null}
                    </button>
                  );
                })}
              </div>

              <section className="raf-card raf-panel" role="tabpanel" aria-label={t(meta.labelKey)}>
                {meta.container === 'attachments' ? (
                  <Attachments resume={resume} errors={attachErrors} onUpload={(s, f) => void uploadAttachment(s, f)} onRemove={(s) => void removeAttachment(s)} />
                ) : (
                  <ModuleForm resume={resume} meta={meta} issues={resumeIssues} onChange={editResume} />
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
