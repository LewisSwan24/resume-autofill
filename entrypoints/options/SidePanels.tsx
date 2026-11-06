// Global (not per-resume) tab panels: UI settings and JSON import/export.
import { useId, useRef, useState } from 'react';
import { forgetAllPlaces } from '../fab.content/placement';
import { exportProfile, parseProfileJson } from '../../src/editor';
import { useT, type LanguageSetting } from '../../src/i18n';
import type { Profile, Settings } from '../../src/schema';
import { Button, Notice, Segmented, Switch } from './ui/controls';
import { Dialog } from './ui/Dialog';
import { useToast } from './ui/Toast';

// ------------------------------------------------------------------ settings

interface SettingsProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsProps) {
  const t = useT();
  return (
    <div className="raf-form-stack raf-form-stack--cols">
      <Segmented<LanguageSetting>
        label={t('options.settings.uiLanguage')}
        visibleLabel
        value={settings.uiLanguage}
        options={[
          { value: 'auto', label: t('options.settings.langAuto') },
          { value: 'zh', label: t('common.lang.zh') },
          { value: 'en', label: t('common.lang.en') },
        ]}
        onChange={(uiLanguage) => onChange({ ...settings, uiLanguage })}
      />
      <Switch
        label={t('options.settings.previewBeforeFill')}
        help={t('options.settings.previewHint')}
        checked={settings.previewBeforeFill}
        onChange={(previewBeforeFill) => onChange({ ...settings, previewBeforeFill })}
      />
      <FabPlace />
    </div>
  );
}

/** Where the autofill button sits is kept per site, outside the profile; this puts every site's button back. */
function FabPlace() {
  const t = useT();
  const toast = useToast();
  const hintId = useId();
  const reset = () =>
    void forgetAllPlaces()
      .then(() => toast.push({ text: t('options.settings.fabPlaceDone') }))
      .catch(() => {
        /* storage is local; a failure here leaves the places as they were */
      });
  return (
    <div className="raf-field">
      <span className="raf-field__label">{t('options.settings.fabPlace')}</span>
      <div>
        <Button icon="arrow-counterclockwise" aria-describedby={hintId} onClick={reset}>
          {t('options.settings.fabPlaceReset')}
        </Button>
      </div>
      <p id={hintId} className="raf-field__help">
        {t('options.settings.fabPlaceHint')}
      </p>
    </div>
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

export function DataPanel({ profile, onImport }: DataProps) {
  const t = useT();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  /** A file that parsed fine and waits for the "Replace your resumes?" answer. */
  const [pending, setPending] = useState<Profile | null>(null);
  const picker = useRef<HTMLInputElement>(null);

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
    setError(null);
    let text: string;
    try {
      text = await readText(file);
    } catch {
      setError(t('options.data.importError', { message: t('options.data.readError') }));
      return;
    }
    const result = parseProfileJson(text);
    if (!result.ok) {
      const message = result.code === 'invalid_json' ? t('options.data.invalidJson') : result.message;
      setError(t('options.data.importError', { message }));
      return;
    }
    setPending(result.profile);
  };

  const confirmImport = async () => {
    const incoming = pending;
    setPending(null);
    if (!incoming) return;
    await onImport(incoming);
    toast.push({ text: t('options.data.importOk', { count: incoming.resumes.length }) });
  };

  return (
    <div className="raf-form-stack">
      <div className="raf-row">
        <Button icon="download" onClick={doExport} disabled={!profile}>
          {t('options.data.export')}
        </Button>
        <Button icon="upload" onClick={() => picker.current?.click()}>
          {t('options.data.import')}
        </Button>
        <input
          ref={picker}
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
      </div>
      <Notice>{t('options.data.note')}</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {pending ? (
        <Dialog
          title={t('options.data.importTitle')}
          text={t('options.data.confirmImport')}
          cancelLabel={t('options.notNow')}
          confirmLabel={t('options.data.importConfirm')}
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmImport()}
        />
      ) : null}
    </div>
  );
}
