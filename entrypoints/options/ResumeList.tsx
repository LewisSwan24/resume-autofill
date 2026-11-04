// Left column: the resume library as a list of rows (select, active badge, row menu) plus "New".
import { useEffect, useId, useState } from 'react';
import { useLanguage, useT } from '../../src/i18n';
import { LOCALES, type Locale, type Profile, type Resume } from '../../src/schema';
import { formatWhen } from './format';
import { Icon } from '../../src/ui/Icon';
import { Badge, Button, ListItem, Segmented } from './ui/controls';
import { Menu } from './ui/Menu';

interface Props {
  profile: Profile;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (locale: Locale) => void;
  onSetActive: (resume: Resume) => void;
  onDuplicate: (resume: Resume) => void;
  onLink: (resume: Resume) => void;
  /** Opens the confirmation Dialog; nothing is deleted yet. */
  onDelete: (resume: Resume) => void;
}

/** True below the 768px breakpoint (same one options.css uses for the single-column layout). jsdom has no matchMedia: wide. */
function useNarrow(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function ResumeList({ profile, selectedId, onSelect, onCreate, onSetActive, onDuplicate, onLink, onDelete }: Props) {
  const t = useT();
  const language = useLanguage();
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const narrow = useNarrow();
  // Under 768px the list folds away (it would push the editor ~360px down); it stays open on wide screens.
  const [folded, setFolded] = useState(true);
  const bodyId = useId();
  const collapsed = narrow && folded;
  const selected = profile.resumes.find((r) => r.id === selectedId);

  return (
    <section className="raf-side-section" aria-label={t('options.resumes')}>
      <h2 className="raf-heading">
        {narrow ? (
          <button type="button" className="raf-fold" aria-expanded={!folded} aria-controls={bodyId} onClick={() => setFolded((v) => !v)}>
            <span>{t('options.resumes')}</span>
            {folded && selected ? <span className="raf-fold__current">{selected.title || '—'}</span> : null}
            <Icon name="chevron-down" className="raf-fold__chevron" />
          </button>
        ) : (
          t('options.resumes')
        )}
      </h2>
      <div id={bodyId} className="raf-side-body" hidden={collapsed}>
        <ul className="raf-list">
          {profile.resumes.map((r) => {
            const active = r.id === profile.activeResumeId;
            const title = r.title || '—';
            return (
              <li key={r.id}>
                <ListItem
                  icon="file-earmark-text"
                  title={title}
                  meta={`${r.locale} · ${t('options.updated', { time: formatWhen(r.updatedAt, language, t('options.today')) })}`}
                  current={r.id === selectedId}
                  badge={active ? <Badge>{t('options.active')}</Badge> : null}
                  onClick={() => {
                    onSelect(r.id);
                    setFolded(true);
                  }}
                >
                  <Menu
                    label={t('options.menuLabel', { title })}
                    items={[
                      { id: 'active', label: t('options.setActive'), icon: 'check-lg', disabled: active, onSelect: () => onSetActive(r) },
                      { id: 'duplicate', label: t('options.duplicate'), icon: 'copy', onSelect: () => onDuplicate(r) },
                      { id: 'link', label: t('options.linkAction'), icon: 'link-45deg', disabled: profile.resumes.length < 2, onSelect: () => onLink(r) },
                      { id: 'delete', label: t('options.delete'), icon: 'trash', danger: true, onSelect: () => onDelete(r) },
                    ]}
                  />
                </ListItem>
              </li>
            );
          })}
        </ul>
        <div className="raf-new">
          <Segmented
            label={t('options.newLocale')}
            visibleLabel
            value={locale}
            options={LOCALES.map((l) => ({ value: l, label: l }))}
            onChange={setLocale}
          />
          <Button variant="primary" icon="plus-lg" onClick={() => onCreate(locale)}>
            {t('options.new')}
          </Button>
        </div>
      </div>
    </section>
  );
}
