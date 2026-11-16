// The 简历 tab: the profile page (简历资料). Pick a resume, pick a module, edit it. Two screens, the module list and
// one module; which module is open lives in the app's navigation state, so it survives a trip to another tab.
import type { ReactNode } from 'react';
import {
  MODULES,
  getByPath,
  issuesForResume,
  updateResume,
  type ArrayModuleName,
  type ModuleMeta,
  type ModuleName,
} from '../../../src/editor';
import type { Profile, Resume } from '../../../src/schema';
import { AttachmentsBody, attachedCount } from './AttachmentsScreen';
import { blankValue, isFilled, type ResumeEdit } from './fields';
import { Icon, MODULE_ICONS } from './Icon';
import { useMT } from './i18n';
import { ModuleBody, entrySummary } from './ModuleScreen';
import type { FocusTarget } from './navigation';
import { ResumeSwitcher, startResume } from './ResumeSwitcher';
import type { FileStore } from './store/fileStore';
import { IconButton, SaveStatusLine, type ToastMessage } from './ui';
import type { ProfileEditor } from './useProfileEditor';

/** The modules this page edits: all of the extension editor's, in its order (attachments last). */
export const PROFILE_MODULES: readonly ModuleMeta[] = MODULES;

function moduleCaption(meta: ModuleMeta, resume: Resume, t: ReturnType<typeof useMT>): string {
  if (meta.container === 'attachments') {
    const n = attachedCount(resume);
    return n === 0 ? t('m.notFilled') : t('m.attached', { n });
  }
  if (meta.repeatable) {
    const entries = resume[meta.module as ArrayModuleName] as unknown as Record<string, unknown>[];
    if (entries.length === 0) return t('m.notFilled');
    const summary = entrySummary(meta, entries[0]!);
    const count = t('m.entries', { n: entries.length });
    return summary ? `${count} · ${summary}` : count;
  }
  const base = meta.container === 'root' ? '' : `${meta.module}.`;
  const filled = meta.fields.filter((f) => isFilled(getByPath(resume, `${base}${f.key}`), blankValue(meta, f))).length;
  return filled === 0 ? t('m.notFilled') : t('m.filled', { n: filled });
}

export interface ResumeTabProps {
  editor: ProfileEditor;
  files: FileStore;
  module: ModuleName | null;
  onModule: (module: ModuleName | null) => void;
  focus: FocusTarget | null;
  onFocusDone: () => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** A file was just stored and is not yet in the resume: keep the sweep away from it. */
  onStored: (id: string) => void;
  /** Read a PDF or Word resume (the resume import's picker). */
  onImportResume?: () => void;
  /** Read the resume PDF stored in a resume's attachment slot. */
  onReadStored?: (fileId: string, resumeId: string) => void;
}

export function ResumeTab({
  editor,
  files,
  module: moduleName,
  onModule,
  focus,
  onFocusDone,
  showToast,
  onStored,
  onImportResume,
  onReadStored,
}: ResumeTabProps) {
  const t = useMT();
  const { profile, edit } = editor;

  if (editor.loadError) {
    return (
      <ListHeader title={t('m.title')}>
        <p className="m-empty">{t('m.loadFailed', { message: editor.loadError })}</p>
      </ListHeader>
    );
  }
  if (!profile) return null;
  const index = profile.resumes.findIndex((r) => r.id === profile.activeResumeId);
  const resume = profile.resumes[index];

  if (!resume) {
    return (
      <ListHeader title={t('m.title')}>
        <div className="m-card m-card--padded m-start">
          <p className="m-empty">{t('m.empty')}</p>
          {onImportResume ? (
            <button type="button" className="m-button m-button--primary m-button--wide" onClick={onImportResume}>
              <Icon name="file-earmark-pdf" />
              <span>{t('m.ri.entry')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={onImportResume ? 'm-button m-button--wide' : 'm-button m-button--primary m-button--wide'}
            onClick={() => edit((p) => startResume(p, 'zh-CN', t('m.defaultTitle.zh')), { immediate: true })}
          >
            <Icon name="plus-lg" />
            <span>{t('m.newZh')}</span>
          </button>
          <button
            type="button"
            className="m-button m-button--wide"
            onClick={() => edit((p) => startResume(p, 'en-AU', t('m.defaultTitle.en')), { immediate: true })}
          >
            <Icon name="plus-lg" />
            <span>{t('m.newEn')}</span>
          </button>
        </div>
      </ListHeader>
    );
  }

  const issues = issuesForResume(editor.issues, index);
  const editResume: ResumeEdit = (change) => edit((p: Profile) => updateResume(p, resume.id, change));
  const editResumeNow: ResumeEdit = (change) => edit((p: Profile) => updateResume(p, resume.id, change), { immediate: true });
  const meta = moduleName ? PROFILE_MODULES.find((m) => m.module === moduleName) : undefined;

  if (meta) {
    return (
      <>
        <header className="m-header m-header--module">
          <IconButton icon="arrow-left" label={t('m.back')} onClick={() => onModule(null)} />
          <h1 className="m-title" tabIndex={-1}>
            {t(meta.labelKey)}
          </h1>
        </header>
        <SaveStatusLine status={editor.status} />
        {meta.container === 'attachments' ? (
          <AttachmentsBody
            key={resume.id}
            resume={resume}
            files={files}
            edit={editResumeNow}
            showToast={showToast}
            onStored={onStored}
            onReadStored={onReadStored}
            focus={focus}
            onFocusDone={onFocusDone}
          />
        ) : (
          <ModuleBody
            key={`${resume.id}:${meta.module}`}
            meta={meta}
            resume={resume}
            issues={issues}
            edit={editResume}
            showToast={showToast}
            focus={focus}
            onFocusDone={onFocusDone}
          />
        )}
      </>
    );
  }

  return (
    <ListHeader title={t('m.title')}>
      <ResumeSwitcher profile={profile} edit={edit} showToast={showToast} onImportResume={onImportResume} />
      <SaveStatusLine status={editor.status} />
      <ul className="m-card m-modules" aria-label={t('m.modules')}>
        {PROFILE_MODULES.map((m) => (
          <li key={m.module}>
            <button type="button" className="m-row" onClick={() => onModule(m.module)}>
              <span className="m-row__tile">
                <Icon name={MODULE_ICONS[m.module]} />
              </span>
              <span className="m-row__text">
                <span className="m-row__name">{t(m.labelKey)}</span>
                <span className="m-row__caption">{moduleCaption(m, resume, t)}</span>
              </span>
              <Icon name="chevron-right" />
            </button>
          </li>
        ))}
      </ul>
    </ListHeader>
  );
}

/** Title row of the module list. The interface language switch moved to Settings. */
function ListHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="m-header">
        <h1 className="m-title" tabIndex={-1}>
          {title}
        </h1>
      </header>
      {children}
    </>
  );
}
