// Left-column panels: UI settings and JSON import/export.
import { useState } from 'react';
import { exportProfile, parseProfileJson } from '../../src/editor';
import { useT } from '../../src/i18n';
import type { Profile, Settings } from '../../src/schema';

// ------------------------------------------------------------------ settings

interface SettingsProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsProps) {
  const t = useT();
  return (
    <section className="raf-card" aria-label={t('options.settings.title')}>
      <h2>{t('options.settings.title')}</h2>
      <label className="raf-field">
        <span className="raf-label">{t('options.settings.uiLanguage')}</span>
        <select value={settings.uiLanguage} onChange={(e) => onChange({ ...settings, uiLanguage: e.target.value as Settings['uiLanguage'] })}>
          <option value="auto">{t('common.lang.auto')}</option>
          <option value="zh">{t('common.lang.zh')}</option>
          <option value="en">{t('common.lang.en')}</option>
        </select>
      </label>
      <label className="raf-check">
        <input type="checkbox" checked={settings.previewBeforeFill} onChange={(e) => onChange({ ...settings, previewBeforeFill: e.target.checked })} />
        {t('options.settings.previewBeforeFill')}
      </label>
      <small className="raf-muted">{t('options.settings.previewHint')}</small>
    </section>
  );
}

// ------------------------------------------------------------------ import / export

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

interface DataProps {
  profile: Profile | null;
  /** Called with a validated profile after the user confirmed the replacement. */
  onImport: (profile: Profile) => Promise<void>;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function DataPanel({ profile, onImport }: DataProps) {
  const t = useT();
  const [notice, setNotice] = useState<Notice>(null);

  const doExport = () => {
    if (!profile) return;
    const url = URL.createObjectURL(new Blob([exportProfile(profile)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = t('options.data.exportName');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (file: File) => {
    let text: string;
    try {
      text = await readText(file);
    } catch {
      setNotice({ kind: 'error', text: t('options.data.importError', { message: t('options.data.readError') }) });
      return;
    }
    const result = parseProfileJson(text);
    if (!result.ok) {
      const message = result.code === 'invalid_json' ? t('options.data.invalidJson') : result.message;
      setNotice({ kind: 'error', text: t('options.data.importError', { message }) });
      return;
    }
    if (!window.confirm(t('options.data.confirmImport'))) return;
    await onImport(result.profile);
    setNotice({ kind: 'ok', text: t('options.data.importOk', { count: result.profile.resumes.length }) });
  };

  return (
    <section className="raf-card" aria-label={t('options.data.title')}>
      <h2>{t('options.data.title')}</h2>
      <div className="raf-row">
        <button type="button" onClick={doExport} disabled={!profile}>
          {t('options.data.export')}
        </button>
        <label className="raf-button">
          {t('options.data.import')}
          <input
            type="file"
            hidden
            accept="application/json,.json"
            aria-label={t('options.data.import')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void doImport(file);
            }}
          />
        </label>
      </div>
      <small className="raf-muted">{t('options.data.note')}</small>
      {notice ? (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? 'raf-error' : 'raf-ok'}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
