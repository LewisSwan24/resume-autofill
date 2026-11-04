// Toolbar control: choose the active resume (`title (locale)`); writes via `setActiveResume`.
// A native <select> (the design system recommends it on narrow screens) dressed as the Select trigger.
import type { Profile } from '../../src/schema';
import { useT } from '../../src/i18n';
import { Icon } from '../../src/ui/Icon';
import { setActiveResume } from '../../src/storage';

export interface ResumeSwitcherProps {
  profile: Profile;
  /** Called with `null` when a change starts and with a message when writing it failed. */
  onError: (message: string | null) => void;
}

export function ResumeSwitcher({ profile, onError }: ResumeSwitcherProps) {
  const t = useT();
  if (profile.resumes.length === 0) return null;

  const change = (id: string) => {
    onError(null);
    setActiveResume(id).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="raf-select">
      <label className="raf-sr-only" htmlFor="raf-active-resume">
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
      <span className="raf-select-icon">
        <Icon name="chevron-down" />
      </span>
    </div>
  );
}
