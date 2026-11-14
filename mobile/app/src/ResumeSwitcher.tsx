// The bar under the page title: which resume is being edited. Tapping it raises a sheet to switch, start, rename
// or delete a resume. Deleting offers Undo in a toast, which puts the resume (and links pointing at it) back.
import { useState } from 'react';
import { addResume, createResume, removeResume, setActive, updateResume } from '../../../src/editor';
import type { Locale, Profile } from '../../../src/schema';
import { Icon } from './Icon';
import { useMT } from './i18n';
import { Sheet, SheetAction, type ToastMessage } from './ui';

/** Same rule as the extension's `resumeLanguage`: any zh* locale is Chinese. */
const resumeLanguageOf = (locale: Locale): 'zh' | 'en' => (locale.startsWith('zh') ? 'zh' : 'en');

type ProfileEdit = (change: (profile: Profile) => Profile, options?: { immediate?: boolean }) => void;

export function LanguageTag({ locale }: { locale: Locale }) {
  const t = useMT();
  return <span className="m-tag">{resumeLanguageOf(locale) === 'zh' ? t('m.zhTag') : t('m.enTag')}</span>;
}

/** Start a resume in the given language and make it the one being edited. */
export function startResume(profile: Profile, locale: Locale, title: string): Profile {
  return addResume(profile, createResume({ title, locale }), { activate: true });
}

export function ResumeSwitcher({
  profile,
  edit,
  showToast,
}: {
  profile: Profile;
  edit: ProfileEdit;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}) {
  const t = useMT();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const active = profile.resumes.find((r) => r.id === profile.activeResumeId);
  if (!active) return null;

  const close = () => {
    setOpen(false);
    setRenaming(null);
  };
  const start = (locale: Locale) => {
    edit((p) => startResume(p, locale, t(locale === 'zh-CN' ? 'm.defaultTitle.zh' : 'm.defaultTitle.en')), { immediate: true });
    close();
  };
  const remove = () => {
    const index = profile.resumes.findIndex((r) => r.id === active.id);
    const removed = active;
    const linkedFrom = profile.resumes.filter((r) => r.linkedResumeId === removed.id).map((r) => r.id);
    edit((p) => removeResume(p, removed.id), { immediate: true });
    close();
    showToast({
      text: t('m.deleted', { name: removed.title }),
      action: {
        label: t('options.undo'),
        onClick: () =>
          edit(
            (p) => ({
              ...p,
              resumes: [
                ...p.resumes.slice(0, index).map((r) => (linkedFrom.includes(r.id) ? { ...r, linkedResumeId: removed.id } : r)),
                removed,
                ...p.resumes.slice(index).map((r) => (linkedFrom.includes(r.id) ? { ...r, linkedResumeId: removed.id } : r)),
              ],
              activeResumeId: removed.id,
            }),
            { immediate: true },
          ),
      },
    });
  };
  const saveName = () => {
    const title = (renaming ?? '').trim();
    if (title) edit((p) => updateResume(p, active.id, (r) => ({ ...r, title })), { immediate: true });
    setRenaming(null);
  };

  return (
    <>
      <button type="button" className="m-input m-switcher" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="m-switcher__caption">{t('m.editing')}</span>
        <LanguageTag locale={active.locale} />
        <span className="m-switcher__title">{active.title}</span>
        <Icon name="chevron-down" />
      </button>
      <Sheet open={open} title={t('m.resumes')} onClose={close}>
        <div role="radiogroup" aria-label={t('m.resumes')} className="m-choices">
          {profile.resumes.map((r) => {
            const checked = r.id === active.id;
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={checked}
                className={checked ? 'm-choice m-choice--on' : 'm-choice'}
                onClick={() => {
                  edit((p) => setActive(p, r.id), { immediate: true });
                  close();
                }}
              >
                <LanguageTag locale={r.locale} />
                <span className="m-choice__text">{r.title}</span>
                {checked ? <Icon name="check-lg" /> : null}
              </button>
            );
          })}
        </div>
        {renaming !== null ? (
          <form
            className="m-rename"
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
          >
            <label className="m-label" htmlFor="m-rename-input">
              {t('m.renameLabel')}
            </label>
            <div className="m-list-add">
              <input
                id="m-rename-input"
                className="m-input"
                type="text"
                autoComplete="off"
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
              />
              <button type="submit" className="m-button m-button--primary">
                {t('m.renameSave')}
              </button>
            </div>
          </form>
        ) : null}
        <div className="m-actions">
          <SheetAction icon="plus-lg" label={t('m.newZh')} onClick={() => start('zh-CN')} />
          <SheetAction icon="plus-lg" label={t('m.newEn')} onClick={() => start('en-AU')} />
          <SheetAction icon="pencil" label={t('m.rename')} onClick={() => setRenaming(active.title)} />
          <SheetAction icon="trash" label={t('m.delete')} danger onClick={remove} />
        </div>
      </Sheet>
    </>
  );
}
