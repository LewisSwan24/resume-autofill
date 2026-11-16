// Global (not per-resume) tab panels: UI settings and JSON import/export.
import { useId, useRef, useState } from 'react';
import { forgetAllPlaces } from '../fab.content/placement';
import { exportProfile, parseProfileJson } from '../../src/editor';
import { useT, type LanguageSetting } from '../../src/i18n';
import type { Profile, Settings } from '../../src/schema';
import { MAPPING_PRESETS, isValidPresetId } from '../../src/templates';
import { ApplicationRecordSchema, loadApplications, mergeTrackerRecords, saveApplications, type ApplicationRecord } from '../../src/tracker';
import { Button, Field, Notice, Segmented, SelectInput, Switch } from './ui/controls';
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
      <Field label={t('options.settings.mappingPreset')} help={t('options.settings.mappingHint')}>
        {(ctrl) => (
          <SelectInput
            {...ctrl}
            value={isValidPresetId(settings.mappingPresetId) ? settings.mappingPresetId : 'default'}
            onChange={(e) => {
              const next = e.target.value;
              onChange({ ...settings, ...(next === 'default' ? { mappingPresetId: undefined } : { mappingPresetId: next }) });
            }}
          >
            {MAPPING_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.labelKey)}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
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
  const [includeTracker, setIncludeTracker] = useState(true);
  /** A file that parsed fine and waits for the "Replace your resumes?" answer. */
  const [pending, setPending] = useState<{ profile: Profile; tracker: ApplicationRecord[] } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    if (!profile) return;
    let payloadText = exportProfile(profile);
    if (includeTracker) {
      const records = await loadApplications().catch(() => []);
      if (records.length > 0) {
        payloadText = JSON.stringify({ ...profile, mobileTracker: records }, null, 2);
      }
    }
    const url = URL.createObjectURL(new Blob([payloadText], { type: 'application/json' }));
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
    const tracker: ApplicationRecord[] = [];
    try {
      const parsedJson = JSON.parse(text) as { mobileTracker?: unknown; applications?: unknown };
      const rawList = Array.isArray(parsedJson.mobileTracker)
        ? parsedJson.mobileTracker
        : Array.isArray(parsedJson.applications)
          ? parsedJson.applications
          : [];
      for (const item of rawList) {
        const valid = ApplicationRecordSchema.safeParse(item);
        if (valid.success) tracker.push(valid.data);
      }
    } catch {
      /* ignore optional tracker parse errors */
    }
    setPending({ profile: result.profile, tracker });
  };

  const confirmImport = async () => {
    const incoming = pending;
    setPending(null);
    if (!incoming) return;
    await onImport(incoming.profile);
    if (incoming.tracker.length > 0) {
      const current = await loadApplications().catch(() => []);
      await saveApplications(mergeTrackerRecords(current, incoming.tracker));
    }
    const extra = incoming.tracker.length > 0 ? ` ${t('options.data.trackerImported', { n: incoming.tracker.length })}` : '';
    toast.push({ text: `${t('options.data.importOk', { count: incoming.profile.resumes.length })}${extra}` });
  };

  return (
    <div className="raf-form-stack">
      <div className="raf-row">
        <Button icon="download" onClick={() => void doExport()} disabled={!profile}>
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
      <Switch
        label={t('options.data.includeTracker')}
        checked={includeTracker}
        onChange={setIncludeTracker}
      />
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
