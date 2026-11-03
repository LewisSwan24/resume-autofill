// Header control: choose the active resume (`title (locale)`); writes via `setActiveResume`.
import { useState } from 'react';
import { useT } from '../../src/i18n';
import type { Profile } from '../../src/schema';
import { setActiveResume } from '../../src/storage';

export function ResumeSwitcher({ profile }: { profile: Profile }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  if (profile.resumes.length === 0) return <p className="raf-muted">{t('panel.noResume')}</p>;

  const change = (id: string) => {
    setError(null);
    setActiveResume(id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="raf-field raf-switcher">
      <label className="raf-label" htmlFor="raf-active-resume">
        {t('panel.resume')}
      </label>
      <select id="raf-active-resume" value={profile.activeResumeId ?? ''} onChange={(e) => change(e.target.value)}>
        {profile.activeResumeId === null ? <option value="" disabled /> : null}
        {profile.resumes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title || '—'} ({r.locale})
          </option>
        ))}
      </select>
      {error ? (
        <span className="raf-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
