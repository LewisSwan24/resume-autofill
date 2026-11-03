// Left column: the resume library (select, create).
import { useState } from 'react';
import { useT } from '../../src/i18n';
import { LOCALES, type Locale, type Profile } from '../../src/schema';

interface Props {
  profile: Profile;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (locale: Locale) => void;
}

export function ResumeList({ profile, selectedId, onSelect, onCreate }: Props) {
  const t = useT();
  const [locale, setLocale] = useState<Locale>('zh-CN');

  return (
    <section className="raf-card" aria-label={t('options.resumes')}>
      <h2>{t('options.resumes')}</h2>
      <ul className="raf-resumes">
        {profile.resumes.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`raf-resume${r.id === selectedId ? ' is-selected' : ''}`}
              aria-current={r.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(r.id)}
            >
              <span className="raf-resume-title">{r.title || '—'}</span>
              <span className="raf-badge">{r.locale}</span>
              {r.id === profile.activeResumeId ? <span className="raf-badge raf-badge-active">★ {t('options.active')}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="raf-new">
        <select aria-label={t('options.newLocale')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {t(`options.locale.${l}`)}
            </option>
          ))}
        </select>
        <button type="button" className="raf-primary" onClick={() => onCreate(locale)}>
          + {t('options.new')}
        </button>
      </div>
    </section>
  );
}
