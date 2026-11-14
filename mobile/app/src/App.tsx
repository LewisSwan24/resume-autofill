// The mobile app's profile page (简历资料): pick a resume, pick a module, edit it. Two screens, no router:
// the module list and one module. The Android back key closes a sheet first, then returns to the list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MODULES,
  getByPath,
  issuesForResume,
  updateResume,
  type ArrayModuleName,
  type ModuleMeta,
  type ModuleName,
} from '../../../src/editor';
import { resolveLanguage, setLanguage, useLanguage } from '../../../src/i18n';
import type { Profile, Resume } from '../../../src/schema';
import { blankValue, isFilled, type ResumeEdit } from './fields';
import { Icon, MODULE_ICONS } from './Icon';
import { useMT } from './i18n';
import { ModuleBody, entrySummary } from './ModuleScreen';
import { ResumeSwitcher, startResume } from './ResumeSwitcher';
import type { ProfileStore } from './store/profileStore';
import { BackStackContext, IconButton, SaveStatusLine, Toast, createBackStack, type ToastMessage } from './ui';
import { useProfileEditor } from './useProfileEditor';

/** What the page needs from the phone. main.tsx wires it to Capacitor; tests press the keys by hand. */
export interface Platform {
  /** The handler returns true when it used the back key, false to let the system have it (leave the app). */
  onBack(handler: () => boolean): () => void;
  /** The app is going to the background. */
  onPause(handler: () => void): () => void;
}

/** The modules this page edits: all of the extension editor's, except attachments, which get their own page. */
export const PROFILE_MODULES: readonly ModuleMeta[] = MODULES.filter((m) => m.container !== 'attachments');

interface Props {
  store: ProfileStore;
  platform?: Platform;
  autosaveDelayMs?: number;
}

function moduleCaption(meta: ModuleMeta, resume: Resume, t: ReturnType<typeof useMT>): string {
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

export default function App({ store, platform, autosaveDelayMs }: Props) {
  const t = useMT();
  const language = useLanguage();
  const editor = useProfileEditor(store, autosaveDelayMs);
  const { profile, edit } = editor;
  const [moduleName, setModuleName] = useState<ModuleName | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const backStack = useMemo(() => createBackStack(), []);
  const moduleRef = useRef(moduleName);
  moduleRef.current = moduleName;

  const uiLanguage = profile?.settings.uiLanguage;
  useEffect(() => {
    if (uiLanguage) setLanguage(resolveLanguage(uiLanguage, navigator.language));
  }, [uiLanguage]);

  const open = useCallback((name: ModuleName | null) => {
    setModuleName(name);
    document.documentElement.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!platform) return;
    const offBack = platform.onBack(() => {
      if (backStack.pop()) return true;
      if (moduleRef.current) {
        open(null);
        return true;
      }
      return false;
    });
    const offPause = platform.onPause(() => void editor.flush());
    return () => {
      offBack();
      offPause();
    };
  }, [platform, backStack, open, editor.flush]);

  const showToast = useCallback((next: Omit<ToastMessage, 'id'>) => setToast({ ...next, id: Date.now() }), []);
  const hideToast = useCallback(() => setToast(null), []);

  const body = (() => {
    if (editor.loadError) return <p className="m-empty">{t('m.loadFailed', { message: editor.loadError })}</p>;
    if (!profile) return null;
    const index = profile.resumes.findIndex((r) => r.id === profile.activeResumeId);
    const resume = profile.resumes[index];

    if (!resume) {
      return (
        <ListHeader profile={profile} edit={edit} title={t('m.title')}>
          <div className="m-card m-card--padded m-start">
            <p className="m-empty">{t('m.empty')}</p>
            <button
              type="button"
              className="m-button m-button--primary m-button--wide"
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
    const meta = moduleName ? PROFILE_MODULES.find((m) => m.module === moduleName) : undefined;

    if (meta) {
      return (
        <>
          <header className="m-header m-header--module">
            <IconButton icon="arrow-left" label={t('m.back')} onClick={() => open(null)} />
            <h1 className="m-title">{t(meta.labelKey)}</h1>
          </header>
          <SaveStatusLine status={editor.status} />
          <ModuleBody key={`${resume.id}:${meta.module}`} meta={meta} resume={resume} issues={issues} edit={editResume} showToast={showToast} />
        </>
      );
    }

    return (
      <ListHeader profile={profile} edit={edit} title={t('m.title')}>
        <ResumeSwitcher profile={profile} edit={edit} showToast={showToast} />
        <SaveStatusLine status={editor.status} />
        <ul className="m-card m-modules" aria-label={t('m.modules')}>
          {PROFILE_MODULES.map((m) => (
            <li key={m.module}>
              <button type="button" className="m-row" onClick={() => open(m.module)}>
                <span className="m-row__tile">
                  <Icon name={MODULE_ICONS[m.module as keyof typeof MODULE_ICONS]} />
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
  })();

  return (
    <BackStackContext.Provider value={backStack}>
      <main className="m-page" lang={language === 'zh' ? 'zh-CN' : 'en'}>
        {body}
      </main>
      <Toast toast={toast} onDone={hideToast} />
    </BackStackContext.Provider>
  );
}

/** Title row of the first screen: the page title and the interface language switch. */
function ListHeader({
  profile,
  edit,
  title,
  children,
}: {
  profile: Profile;
  edit: (change: (p: Profile) => Profile, options?: { immediate?: boolean }) => void;
  title: string;
  children: React.ReactNode;
}) {
  const t = useMT();
  const language = useLanguage();
  const choose = (next: 'zh' | 'en') => {
    setLanguage(next);
    if (profile.settings.uiLanguage !== next) edit((p) => ({ ...p, settings: { ...p.settings, uiLanguage: next } }), { immediate: true });
  };
  return (
    <>
      <header className="m-header">
        <h1 className="m-title">{title}</h1>
        <div className="m-segmented m-segmented--small" role="radiogroup" aria-label={t('common.uiLanguage')}>
          {(['zh', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={language === l}
              className={language === l ? 'm-segment m-segment--on' : 'm-segment'}
              onClick={() => choose(l)}
            >
              {l === 'zh' ? t('m.zhTag') : t('m.enTag')}
            </button>
          ))}
        </div>
      </header>
      {children}
    </>
  );
}
