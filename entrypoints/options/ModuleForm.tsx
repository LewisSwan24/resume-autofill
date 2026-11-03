// Form for one module of the selected resume: a plain object, or a repeatable list of entries.
import type { ReactNode } from 'react';
import {
  addEntry,
  getByPath,
  moveEntry,
  removeEntry,
  setByPath,
  setEndDate,
  toggleCurrent,
  type ArrayModuleName,
  type FieldMeta,
  type ModuleMeta,
} from '../../src/editor';
import { useT } from '../../src/i18n';
import type { Resume } from '../../src/schema';
import { FieldInput } from './fields';

interface Props {
  resume: Resume;
  meta: ModuleMeta;
  /** Validation messages keyed by path relative to the resume. */
  issues: ReadonlyMap<string, string>;
  onChange: (next: Resume) => void;
}

const join = (...parts: (string | number)[]) => parts.join('.');

interface FieldsProps {
  resume: Resume;
  fields: readonly FieldMeta[];
  /** Path of the object holding the fields, relative to the resume (`''` = resume root). */
  base: string;
  issues: ReadonlyMap<string, string>;
  onChange: (next: Resume) => void;
}

function Fields({ resume, fields, base, issues, onChange }: FieldsProps) {
  const t = useT();
  const pathOf = (key: string) => (base ? `${base}.${key}` : key);

  return (
    <div className="raf-grid">
      {fields.map((field) => {
        const path = pathOf(field.key);
        const label = t(field.labelKey);
        const error = issues.get(path);
        const value = getByPath(resume, path);
        const wide = field.input === 'textarea' || field.input === 'region' || field.input === 'list';
        const className = `raf-field${wide ? ' raf-wide' : ''}${error ? ' raf-invalid' : ''}`;
        const set = (v: unknown) => onChange(setByPath(resume, path, v));

        let control: ReactNode;
        if (field.currentKey) {
          const current = getByPath(resume, pathOf(field.currentKey)) === true;
          const entryPath = base;
          control = (
            <span className="raf-inline">
              <FieldInput
                meta={field}
                value={value}
                disabled={current}
                ariaLabel={label}
                onChange={(v) => onChange(setByPath(resume, entryPath, setEndDate(getByPath(resume, entryPath) as never, String(v))))}
              />
              <label className="raf-check">
                <input
                  type="checkbox"
                  checked={current}
                  onChange={(e) =>
                    onChange(setByPath(resume, entryPath, toggleCurrent(getByPath(resume, entryPath) as never, e.target.checked)))
                  }
                />
                {t('options.present')}
              </label>
            </span>
          );
          return (
            <div key={field.key} className={className}>
              <span className="raf-label">{label}</span>
              {control}
              {error ? <small className="raf-error">{error}</small> : null}
            </div>
          );
        }

        if (field.input === 'region') {
          return (
            <fieldset key={field.key} className={className}>
              <legend className="raf-label">{label}</legend>
              <FieldInput meta={field} value={value} onChange={set} ariaLabel={label} />
              {error ? <small className="raf-error">{error}</small> : null}
            </fieldset>
          );
        }

        return (
          <label key={field.key} className={className}>
            <span className="raf-label">{label}</span>
            <FieldInput meta={field} value={value} onChange={set} />
            {error ? <small className="raf-error">{error}</small> : null}
          </label>
        );
      })}
    </div>
  );
}

/** First filled text field of an entry, shown next to its number so collapsed lists stay scannable. */
function entrySummary(meta: ModuleMeta, entry: Record<string, unknown>): string {
  for (const field of meta.fields) {
    const v = entry[field.key];
    if (field.input === 'text' && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function ModuleForm({ resume, meta, issues, onChange }: Props) {
  const t = useT();

  if (!meta.repeatable) {
    const base = meta.container === 'root' ? '' : meta.module;
    return <Fields resume={resume} fields={meta.fields} base={base} issues={issues} onChange={onChange} />;
  }

  const module = meta.module as ArrayModuleName;
  const entries = resume[module] as unknown as Record<string, unknown>[];
  const name = t(meta.labelKey);

  return (
    <div className="raf-entries">
      {entries.length === 0 ? <p className="raf-muted">{t('options.noEntries', { name })}</p> : null}
      {entries.map((entry, index) => (
        // Entries have no stable id; index keys are fine because every edit re-renders the whole list.
        <section key={index} className="raf-entry" aria-label={t('options.entry', { name, n: index + 1 })}>
          <header className="raf-entry-head">
            <strong>{t('options.entry', { name, n: index + 1 })}</strong>
            <span className="raf-entry-summary">{entrySummary(meta, entry)}</span>
            <span className="raf-entry-actions">
              <button type="button" aria-label={t('options.moveUp')} title={t('options.moveUp')} disabled={index === 0} onClick={() => onChange(moveEntry(resume, module, index, -1))}>
                ↑
              </button>
              <button type="button" aria-label={t('options.moveDown')} title={t('options.moveDown')} disabled={index === entries.length - 1} onClick={() => onChange(moveEntry(resume, module, index, 1))}>
                ↓
              </button>
              <button type="button" className="raf-danger" aria-label={t('options.removeEntry')} title={t('options.removeEntry')} onClick={() => onChange(removeEntry(resume, module, index))}>
                ✕
              </button>
            </span>
          </header>
          <Fields resume={resume} fields={meta.fields} base={join(module, index)} issues={issues} onChange={onChange} />
        </section>
      ))}
      <button type="button" className="raf-add" onClick={() => onChange(addEntry(resume, module))}>
        + {t('options.add', { name })}
      </button>
    </div>
  );
}
