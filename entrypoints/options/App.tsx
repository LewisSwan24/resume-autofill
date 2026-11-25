// Options page: resume library editor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ARRAY_MODULES,
  MODULES,
  addResume,
  createResume,
  duplicateResume,
  issuesForResume,
  validateProfile,
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
  type ProfileTarget,
} from '../../src/editor';
import { resolveLanguage, setLanguage, useT, type MessageKey } from '../../src/i18n';
import { inheritedSection, materializeResume, type Locale, type Profile, type Resume } from '../../src/schema';
import { draftToResume, refusedPaths } from '../../src/import/draft';
import { applyDiffMergeDecisions } from '../../src/import/diffMerge';
import type { ExtractFailure, TextLine } from '../../src/import/extract/types';
import { parseResume, type Draft } from '../../src/import/parse';
import { cleanLines } from '../../src/import/parse/clean';
import { readResumeFile } from '../../src/import/read';
import { deleteFile, getFile, putFile } from '../../src/storage';
import { Icon } from '../../src/ui/Icon';
import { Attachments, MAX_ATTACHMENT_MB, acceptsFile, slotTypeKey } from './Attachments';
import { ModuleForm } from './ModuleForm';
import { ImportReview, type ReviewProblem } from './ImportReview';
import { ResumeList } from './ResumeList';
import { AnswerTemplatesPanel } from './AnswerTemplates';
import { DataPanel, SettingsPanel } from './SidePanels';
import { TailorPanel } from './TailorPanel';
import { TemplatesPanel } from './TemplatesPanel';
import { TrackerPanel } from './TrackerPanel';
import { AuditCard } from './AuditCard';
import { VaultPanel } from './VaultPanel';
import { useProfileEditor, type SaveStatus } from './useProfileEditor';
import { findJumpControl, focusAndMark, useFocusRequest } from './useFocusRequest';
import { Accordion, AccordionItem } from './ui/Accordion';
import { Badge, Button, EmptyState, Field, Input, Notice, SelectInput } from './ui/controls';
import { Dialog } from './ui/Dialog';
import { Tabs, panelId, tabId, type TabItem } from './ui/Tabs';
import { ToastProvider, useToast } from './ui/Toast';
import { LanguageToggle } from '../../src/ui/LanguageToggle';
import { HELP_PAGE, openExtensionPage } from '../../src/ui/pages';
import '../../src/ui/fonts.css';
import '../../src/ui/theme.css';
import './ui/ui.css';
import './options.css';

export interface AppProps {
  /** Autosave debounce; production uses 500 ms (tests shorten it). */
  autosaveDelayMs?: number;
}

type TabKey = 'editor' | 'attachments' | 'tailor' | 'settings' | 'data' | 'tracker' | 'templates';

/** Sections that start expanded; the rest stay folded until asked for. */
const OPEN_BY_DEFAULT: readonly ModuleName[] = ['basics', 'contact', 'education', 'work'];
const EDITOR_MODULES = MODULES.filter((m) => m.container !== 'attachments');
const PREFIX = 'raf-options';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Autosave state as a caption: always in the DOM (role=status) so changes are announced; failures add icon + danger colour. */
function SaveStatusLine({ status }: { status: SaveStatus }) {
  const t = useT();
  const view =
    status === 'saved'
      ? { text: t('options.allSaved'), icon: 'check-lg' as const }
      : status === 'pending' || status === 'saving'
        ? { text: t('options.saving'), icon: null }
        : status === 'invalid'
          ? { text: t('options.needsLook'), icon: 'exclamation-triangle' as const }
          : status === 'locked'
            ? { text: t('options.lockedUnsaved'), icon: 'exclamation-triangle' as const }
          : status === 'error'
            ? { text: t('options.saveFailed'), icon: 'exclamation-triangle' as const }
            : null;
  const bad = status === 'invalid' || status === 'error' || status === 'locked';
  return (
    <span className={`raf-status${bad ? ' is-bad' : ''}`} role="status" data-status={status}>
      {view?.icon ? <Icon name={view.icon} size={16} /> : null}
      {view?.text}
    </span>
  );
}

type ImportState =
  | { state: 'reading'; file: File }
  | { state: 'failed'; file: File; reason: ExtractFailure }
  | { state: 'review'; turn: number; file: File; lines: TextLine[]; draft: Draft; title?: string; saving?: boolean; problem?: ReviewProblem | undefined };

const IMPORT_FAILURES: Record<ExtractFailure, MessageKey> = {
  encrypted: 'options.import.encrypted',
  no_text: 'options.import.noText',
  unsupported: 'options.import.unsupported',
  too_large: 'options.import.tooLarge',
  failed: 'options.import.failed',
};

function Options({ autosaveDelayMs }: AppProps) {
  const t = useT();
  const toast = useToast();
  const { profile, loadError, vaultLocked, status, saveError, issues, markLocked, unlocked, vaultRemoved, commit } =
    useProfileEditor(autosaveDelayMs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('editor');
  const [open, setOpen] = useState<ReadonlySet<ModuleName>>(() => new Set(OPEN_BY_DEFAULT));
  const [attachErrors, setAttachErrors] = useState<Partial<Record<AttachmentSlot, string>>>({});
  const [attachBusy, setAttachBusy] = useState<Partial<Record<AttachmentSlot, boolean>>>({});
  const [deleteTarget, setDeleteTarget] = useState<Resume | null>(null);
  const [linkTarget, setLinkTarget] = useState<Resume | null>(null);
  const [linkChoice, setLinkChoice] = useState('');
  const [imported, setImported] = useState<ImportState | null>(null);
  /** The vault was deleted after a lost passphrase: point at the backup import until one is imported. */
  const [restoring, setRestoring] = useState(false);
  const importTurn = useRef(0);

  const jump = useFocusRequest();

  // Handlers run after awaits (and Undo runs seconds later); always read the newest profile through this ref.
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

  // A jump request from the side panel: one state change per render until the input is on screen, then focus it.
  // The resume shown is the active one, the one that filled the form.
  const { target: jumpTarget, done: jumpDone } = jump;
  const [auditJump, setAuditJump] = useState<ProfileTarget | null>(null);
  const activeJump = jumpTarget ?? auditJump;
  useEffect(() => {
    if (!activeJump || !profile) return;
    const wantTab: TabKey = activeJump.module === 'attachments' ? 'attachments' : 'editor';
    if (tab !== wantTab) return setTab(wantTab);
    if (!auditJump && profile.activeResumeId && resume?.id !== profile.activeResumeId) return setSelectedId(profile.activeResumeId);
    if (wantTab === 'editor' && !open.has(activeJump.module)) return setOpen((prev) => new Set(prev).add(activeJump.module));
    if (jumpTarget) jumpDone();
    if (auditJump) setAuditJump(null);
    const control = findJumpControl(activeJump);
    if (control) focusAndMark(control);
  }, [activeJump, jumpTarget, auditJump, jumpDone, profile, tab, resume, open]);

  // ---------------------------------------------------------------- resume-level actions

  /** Edit one resume against the newest profile (also what the entry-delete Undo uses). */
  const editResumeById = (id: string, edit: (resume: Resume) => Resume) => {
    const current = latest.current;
    if (!current) return;
    const next = updateResume(current, id, edit);
    latest.current = next; // two edits in one tick must build on each other
    void commit(next);
  };

  const createNew = (locale: Locale) => {
    if (!profile) return;
    const created = createResume({ title: t('options.defaultTitle'), locale });
    void commit(addResume(profile, created, { activate: profile.resumes.length === 0 }), { immediate: true });
    setSelectedId(created.id);
    setTab('editor');
  };

  // A draft lives here and nowhere else until it is saved.
  const startImport = async (file: File) => {
    // The file chosen last is the one being checked, whichever finishes first.
    const turn = ++importTurn.current;
    setImported({ state: 'reading', file });
    setTab('editor');
    const result = await readResumeFile(file);
    if (turn !== importTurn.current) return;
    if (!result.ok) {
      setImported({ state: 'failed', file, reason: result.reason });
      return;
    }
    try {
      setImported({ state: 'review', turn, file, lines: cleanLines(result.lines), draft: parseResume(result.lines) });
    } catch {
      setImported({ state: 'failed', file, reason: 'failed' });
    }
  };

  const keepImportEdits = useCallback((draft: Draft, title: string) => {
    setImported((prev) => (prev?.state === 'review' ? { ...prev, draft, title } : prev));
  }, []);

  const saveImport = async (turn: number, file: File, draft: Draft, title: string) => {
    const stopped = (problem: ReviewProblem) =>
      setImported((prev) => (prev?.state === 'review' && prev.turn === turn ? { ...prev, saving: false, problem } : prev));
    const id = createResume({ title, locale: draft.locale }).id;
    // A value the schema refuses would otherwise be left out without a word.
    const refused = refusedPaths(draft, { id, title });
    if (refused.length > 0) {
      stopped({ kind: 'fields', paths: refused });
      return;
    }
    setImported((prev) => (prev?.state === 'review' ? { ...prev, saving: true, problem: undefined } : prev));
    let fileId: string;
    try {
      fileId = await putFile({ name: file.name, type: file.type || 'application/octet-stream', blob: file });
    } catch {
      stopped({ kind: 'store' });
      return;
    }
    // Read only now: the profile may have changed while the file was being stored.
    const current = latest.current;
    const next = current && addResume(current, setAttachment(draftToResume(draft, { id, title }), 'resumeFileId', fileId), { activate: true });
    if (!next || validateProfile(next).length > 0) {
      await deleteFile(fileId).catch(() => undefined);
      stopped({ kind: next ? 'other_resume' : 'store' });
      return;
    }
    await commit(next, { immediate: true });
    setSelectedId(id);
    if (turn === importTurn.current) setImported(null);
  };

  const mergeImportIntoExisting = async (turn: number, target: Resume, draft: Draft) => {
    const incoming = draftToResume(draft, { id: target.id, title: target.title });
    const merged = applyDiffMergeDecisions(target, incoming);
    const current = latest.current;
    if (!current) return;
    const next = updateResume(current, target.id, () => merged);
    await commit(next, { immediate: true });
    toast.push({ text: t('options.import.mergeDone') });
    if (turn === importTurn.current) setImported(null);
  };

  const duplicate = (source: Resume) => {
    if (!profile) return;
    const copy = duplicateResume(source, { title: `${source.title}${t('options.copySuffix')}` });
    void commit(addResume(profile, copy), { immediate: true });
    setSelectedId(copy.id);
  };

  const remove = async (target: Resume) => {
    if (!profile) return;
    setDeleteTarget(null);
    const next = removeResume(profile, target.id);
    setSelectedId(null);
    await commit(next, { immediate: true });
    // Attachment files nobody references any more would only waste space.
    const keep = referencedFileIds(next);
    for (const id of referencedFileIds({ ...profile, resumes: [target] })) {
      if (!keep.has(id)) await deleteFile(id).catch(() => undefined);
    }
  };

  const saveLink = () => {
    const target = linkTarget;
    const current = latest.current;
    setLinkTarget(null);
    if (target && current) void commit(setLinkedResume(current, target.id, linkChoice || null));
  };

  // ---------------------------------------------------------------- attachments

  const uploadAttachment = async (slot: AttachmentSlot, file: File) => {
    if (!resume) return;
    const resumeId = resume.id;
    const setError = (message: string | null) => setAttachErrors((prev) => ({ ...prev, [slot]: message ?? undefined }));
    const types = t(slotTypeKey(slot));
    if (!acceptsFile(slot, file)) {
      setError(t('options.attach.wrongType', { types, max: MAX_ATTACHMENT_MB }));
      return;
    }
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setError(t('options.attach.tooLarge', { max: MAX_ATTACHMENT_MB }));
      return;
    }
    setAttachBusy((prev) => ({ ...prev, [slot]: true }));
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
    } finally {
      setAttachBusy((prev) => ({ ...prev, [slot]: false }));
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
    setRestoring(false);
  };

  // ---------------------------------------------------------------- render

  const header = (
    <header className="raf-header">
      <div className="raf-header__text">
        <h1 className="raf-title">{t('options.title')}</h1>
        <p className="raf-caption">{t('options.subtitle')}</p>
      </div>
      <div className="raf-header__end">
        <SaveStatusLine status={status} />
        <Button icon="book" onClick={() => openExtensionPage(HELP_PAGE)}>
          {t('common.help')}
        </Button>
        {profile ? (
          <LanguageToggle
            onChange={(uiLanguage) => void commit({ ...profile, settings: { ...profile.settings, uiLanguage } }, { immediate: true })}
          />
        ) : null}
      </div>
    </header>
  );

  // A locked vault takes the resume off the screen. Unsaved edits stay in the
  // editor hook and are saved once the vault is unlocked.
  if (!profile || vaultLocked) {
    return (
      <div className="raf-app">
        {header}
        {vaultLocked ? (
          <div className="raf-single raf-form-stack">
            <VaultPanel
              mode="unlock"
              onUnlocked={unlocked}
              pendingChanges={status === 'locked'}
              onForgotten={() => {
                vaultRemoved();
                setRestoring(true);
                setTab('data');
              }}
            />
          </div>
        ) : loadError ? (
          <div className="raf-single raf-form-stack">
            <Notice tone="danger">{loadError}</Notice>
            <section className="raf-card" aria-label={t('options.data.title')}>
              <h2 className="raf-heading">{t('options.data.title')}</h2>
              <DataPanel profile={null} onImport={importProfile} />
            </section>
          </div>
        ) : (
          <p className="raf-caption raf-pad">{t('options.loading')}</p>
        )}
      </div>
    );
  }

  const tabs: TabItem<TabKey>[] = [
    { id: 'editor', label: t('options.tab.editor'), icon: 'pencil' },
    { id: 'attachments', label: t('options.module.attachments'), icon: 'paperclip' },
    { id: 'tailor', label: t('options.tab.tailor'), icon: 'search' },
    { id: 'settings', label: t('options.settings.title'), icon: 'gear' },
    { id: 'data', label: t('options.data.title'), icon: 'download' },
    { id: 'tracker', label: t('options.tab.tracker'), icon: 'check-circle' },
    { id: 'templates', label: t('options.tab.templates'), icon: 'file-earmark-check' },
  ];
  const linkedTitle = resume?.linkedResumeId ? profile.resumes.find((r) => r.id === resume.linkedResumeId)?.title : undefined;
  const baseVariantTitle = resume?.variantOf ? profile.resumes.find((r) => r.id === resume.variantOf)?.title : undefined;
  const linkOthers = linkTarget ? profile.resumes.filter((r) => r.id !== linkTarget.id) : [];
  const resumeScoped = tab === 'editor' || tab === 'attachments';

  const toggle = (module: ModuleName, value: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (value) next.add(module);
      else next.delete(module);
      return next;
    });

  const editor = !resume ? (
    <EmptyState>{t('options.empty')}</EmptyState>
  ) : tab === 'attachments' ? (
    <section className="raf-card" aria-label={t('options.module.attachments')}>
      <Attachments
        resume={resume}
        allResumes={profile.resumes}
        errors={attachErrors}
        busy={attachBusy}
        onUpload={(s, f) => void uploadAttachment(s, f)}
        onRemove={(s) => void removeAttachment(s)}
      />
    </section>
  ) : (
    <>
      <div className="raf-resume-head">
        <Field label={t('options.resumeTitle')}>
          {(control) => <Input {...control} type="text" value={resume.title} onChange={(e) => editResumeById(resume.id, (r) => ({ ...r, title: e.target.value }))} />}
        </Field>
        <div className="raf-resume-head__meta">
          <Badge>{resume.locale}</Badge>
          {baseVariantTitle !== undefined ? (
            <Badge>{t('options.variant.badge', { base: baseVariantTitle || '—' })}</Badge>
          ) : null}
          {linkedTitle !== undefined ? <span className="raf-caption">{t('options.linkedTo', { title: linkedTitle || '—' })}</span> : null}
        </div>
        {baseVariantTitle !== undefined ? <p className="raf-caption">{t('options.variant.editHint')}</p> : null}
      </div>
      {/* A variant is audited as it fills: with what it inherits. */}
      <AuditCard resume={resume.variantOf ? materializeResume(resume, profile.resumes) : resume} onJump={(target) => setAuditJump(target)} />
      <Accordion>
        {EDITOR_MODULES.map((m) => {
          const isList = (ARRAY_MODULES as readonly string[]).includes(m.module);
          const own = isList ? (resume[m.module as ArrayModuleName] as unknown[]).length : 0;
          // A variant without entries of its own shows (and fills) the base's.
          const count = !isList || own > 0 || !resume.variantOf ? own : (inheritedSection(resume, profile.resumes, m.module as ArrayModuleName) as unknown[]).length;
          return (
            <AccordionItem key={m.module} title={t(m.labelKey)} count={count} open={open.has(m.module)} onToggle={(v) => toggle(m.module, v)}>
              <ModuleForm resume={resume} meta={m} issues={resumeIssues} allResumes={profile.resumes} onEdit={(edit) => editResumeById(resume.id, edit)} />
            </AccordionItem>
          );
        })}
      </Accordion>
    </>
  );

  return (
    <div className="raf-app">
      {header}

      {restoring && tab === 'data' ? (
        <div className="raf-notices">
          {restoring && tab === 'data' ? <Notice tone="info">{t('options.vault.restoreNotice')}</Notice> : null}
        </div>
      ) : null}

      {status === 'error' || status === 'invalid' ? (
        <div className="raf-notices">
          {status === 'error' ? (
            <Notice
              tone="danger"
              action={
                <Button onClick={() => latest.current && void commit(latest.current, { immediate: true })}>{t('options.tryAgain')}</Button>
              }
            >
              {t('options.saveError', { message: saveError ?? '' })}
            </Notice>
          ) : (
            <Notice tone="danger">{t('options.invalid', { count: issues.length })}</Notice>
          )}
        </div>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel={t('options.title')} idPrefix={PREFIX} />

      <div role="tabpanel" id={panelId(PREFIX, tab)} aria-labelledby={tabId(PREFIX, tab)} className={resumeScoped ? 'raf-workspace' : 'raf-single'}>
        {resumeScoped ? (
          <>
            <aside className="raf-side">
              <ResumeList
                profile={profile}
                selectedId={resume?.id ?? null}
                onSelect={setSelectedId}
                onCreate={createNew}
                onUpload={(file) => void startImport(file)}
                onSetActive={(r) => void commit(setActive(profile, r.id), { immediate: true })}
                onDuplicate={duplicate}
                onLink={(r) => {
                  setLinkChoice(r.linkedResumeId ?? '');
                  setLinkTarget(r);
                }}
                onDelete={setDeleteTarget}
              />
            </aside>
            <main className="raf-main">
              {imported?.state === 'review' ? (
                <ImportReview
                  key={imported.turn}
                  fileName={imported.file.name}
                  lines={imported.lines}
                  draft={imported.draft}
                  {...(imported.title === undefined ? {} : { title: imported.title })}
                  busy={!!imported.saving}
                  problem={imported.problem}
                  mergeTargetTitle={resume?.title}
                  onMerge={resume ? (d) => void mergeImportIntoExisting(imported.turn, resume, d) : undefined}
                  onCancel={() => {
                    importTurn.current++;
                    setImported(null);
                  }}
                  onEdit={keepImportEdits}
                  onSave={(draft, title) => void saveImport(imported.turn, imported.file, draft, title)}
                />
              ) : (
                <>
                  {imported?.state === 'reading' ? <Notice>{t('options.import.reading')}</Notice> : null}
                  {imported?.state === 'failed' ? (
                    <Notice tone="danger" action={<Button onClick={() => setImported(null)}>{t('common.close')}</Button>}>
                      {t(IMPORT_FAILURES[imported.reason])}
                    </Notice>
                  ) : null}
                  {editor}
                </>
              )}
            </main>
          </>
        ) : tab === 'tailor' ? (
          <TailorPanel profile={profile} resume={resume} onCommit={commit} onSelectResume={setSelectedId} />
        ) : tab === 'settings' ? (
          <section className="raf-card" aria-label={t('options.settings.title')}>
            <h2 className="raf-heading">{t('options.settings.title')}</h2>
            <SettingsPanel
              settings={profile.settings}
              onChange={(settings) => void commit({ ...profile, settings })}
              onVaultLocked={markLocked}
              onVaultUnlocked={unlocked}
            />
            <h3 className="raf-heading">{t('options.answers.title')}</h3>
            <AnswerTemplatesPanel settings={profile.settings} onChange={(settings) => void commit({ ...profile, settings })} />
          </section>
        ) : tab === 'tracker' ? (
          <section className="raf-card" aria-label={t('options.tracker.title')}>
            <h2 className="raf-heading">{t('options.tracker.title')}</h2>
            <TrackerPanel />
          </section>
        ) : tab === 'templates' ? (
          <section className="raf-card" aria-label={t('options.templates.title')}>
            <h2 className="raf-heading">{t('options.templates.title')}</h2>
            <TemplatesPanel resume={resume} allResumes={profile.resumes} />
          </section>
        ) : (
          <section className="raf-card" aria-label={t('options.data.title')}>
            <h2 className="raf-heading">{t('options.data.title')}</h2>
            <DataPanel profile={profile} onImport={importProfile} />
          </section>
        )}
      </div>

      {deleteTarget ? (
        <Dialog
          title={t('options.deleteTitle')}
          text={t('options.confirmDelete', { title: deleteTarget.title || '—' })}
          cancelLabel={t('options.notNow')}
          confirmLabel={t('options.deleteConfirm')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void remove(deleteTarget)}
        />
      ) : null}

      {linkTarget ? (
        <Dialog
          title={t('options.linkTitle')}
          text={t('options.linkHint')}
          cancelLabel={t('options.notNow')}
          confirmLabel={t('options.linkSave')}
          onCancel={() => setLinkTarget(null)}
          onConfirm={saveLink}
        >
          <Field label={t('options.linked')} className="raf-dialog__field">
            {(control) => (
              <SelectInput {...control} value={linkChoice} onChange={(e) => setLinkChoice(e.target.value)}>
                <option value="">{t('options.linkNone')}</option>
                {linkOthers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.locale})
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </Dialog>
      ) : null}
    </div>
  );
}

export default function App(props: AppProps = {}) {
  return (
    <ToastProvider>
      <Options {...props} />
    </ToastProvider>
  );
}
