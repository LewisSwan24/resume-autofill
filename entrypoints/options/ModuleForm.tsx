// Form for one module of the selected resume: a plain object, or a repeatable list of entries.
import { Fragment, type ReactNode } from 'react';
import {
  addEntry,
  getByPath,
  insertEntry,
  moveEntry,
  removeEntry,
  setByPath,
  setEndDate,
  toggleCurrent,
  type ArrayModuleName,
  type FieldMeta,
  type ModuleMeta,
} from '../../src/editor';
import { useLanguage, useT } from '../../src/i18n';
import type { Resume } from '../../src/schema';
import { BoolSwitch, FieldInput, REGION_PARTS } from './fields';
import { Button, Checkbox, Divider, EmptyState, Field, IconButton, Input } from './ui/controls';
import { useToast } from './ui/Toast';

interface Props {
  resume: Resume;
  meta: ModuleMeta;
  /** Validation messages keyed by path relative to the resume. */
  issues: ReadonlyMap<string, string>;
  /** Apply an edit to the resume being edited; always runs against the newest saved state. */
  onEdit: (edit: (resume: Resume) => Resume) => void;
}

const join = (...parts: (string | number)[]) => parts.join('.');

/**
 * Deliberate deviation from the design system's "one field per row" rule: pairs of SHORT, related values sit side by
 * side (start / end month, min / max salary, height / weight, country code / phone). They are read as one thing and
 * would otherwise stretch to 680px each. The three-part region (province / city / district) does the same.
 * Key = first field of the pair, value = the field that joins it. Everything else is one column.
 */
const PAIRS: Readonly<Record<string, string>> = {
  startDate: 'endDate',
  salaryMin: 'salaryMax',
  height: 'weight',
  phoneCountryCode: 'phone',
};

/** English module names start with a capital in the module list ("Education") but read lower-case mid-sentence. */
const lowerFirst = (text: string, language: string) => (language === 'en' ? text.charAt(0).toLowerCase() + text.slice(1) : text);

interface FieldsProps {
  resume: Resume;
  fields: readonly FieldMeta[];
  /** Path of the object holding the fields, relative to the resume (`''` = resume root). */
  base: string;
  issues: ReadonlyMap<string, string>;
  onEdit: (edit: (resume: Resume) => Resume) => void;
}

function Fields({ resume, fields, base, issues, onEdit }: FieldsProps) {
  const t = useT();
  const pathOf = (key: string) => (base ? `${base}.${key}` : key);
  const change = (path: string, v: unknown) => onEdit((r) => setByPath(r, path, v));

  const renderField = (field: FieldMeta): ReactNode => {
    const path = pathOf(field.key);
    const label = t(field.labelKey);
    const error = issues.get(path);
    const value = getByPath(resume, path);

    if (field.input === 'bool') {
      return (
        <div key={field.key} className="raf-field">
          <BoolSwitch label={label} value={value} onChange={(v) => change(path, v)} />
          {error ? <p className="raf-field__help raf-field__help--error">{error}</p> : null}
        </div>
      );
    }

    if (field.input === 'region') {
      const region = (value && typeof value === 'object' ? value : {}) as Record<string, string | undefined>;
      return (
        <fieldset key={field.key} className="raf-fieldset">
          <legend className="raf-field__label">{label}</legend>
          {/* Three short parts of one address: side by side (see PAIRS). */}
          <div className="raf-pair raf-pair--3">
            {REGION_PARTS.map((part) => (
              <Field key={part} label={t(`options.region.${part}`)} error={null}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    value={region[part] ?? ''}
                    aria-invalid={error ? true : undefined}
                    aria-label={`${label} – ${t(`options.region.${part}`)}`}
                    onChange={(e) => change(path, { ...region, [part]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
          {error ? <p className="raf-field__help raf-field__help--error">{error}</p> : null}
        </fieldset>
      );
    }

    if (field.currentKey) {
      // End date + "Present": ticking it clears the date; typing a date unticks it.
      const entryPath = base;
      const current = getByPath(resume, pathOf(field.currentKey)) === true;
      return (
        <Field key={field.key} label={label} error={error}>
          {(control) => (
            <>
              <FieldInput
                meta={field}
                value={value}
                disabled={current}
                control={control}
                onChange={(v) => onEdit((r) => setByPath(r, entryPath, setEndDate(getByPath(r, entryPath) as never, String(v))))}
              />
              <Checkbox
                label={t('options.present')}
                checked={current}
                onChange={(checked) => onEdit((r) => setByPath(r, entryPath, toggleCurrent(getByPath(r, entryPath) as never, checked)))}
              />
            </>
          )}
        </Field>
      );
    }

    return (
      <Field key={field.key} label={label} error={error}>
        {(control) => <FieldInput meta={field} value={value} control={control} onChange={(v) => change(path, v)} />}
      </Field>
    );
  };

  const rows: ReactNode[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]!;
    const partner = fields[i + 1];
    if (partner && PAIRS[field.key] === partner.key) {
      rows.push(
        <div key={field.key} className="raf-pair">
          {renderField(field)}
          {renderField(partner)}
        </div>,
      );
      i += 1;
    } else {
      rows.push(renderField(field));
    }
  }
  return <div className="raf-fields">{rows}</div>;
}

/** First filled text field of an entry, shown next to its number so long lists stay scannable. */
function entrySummary(meta: ModuleMeta, entry: Record<string, unknown>): string {
  for (const field of meta.fields) {
    const v = entry[field.key];
    if (field.input === 'text' && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function ModuleForm({ resume, meta, issues, onEdit }: Props) {
  const t = useT();
  const language = useLanguage();
  const toast = useToast();

  if (!meta.repeatable) {
    const base = meta.container === 'root' ? '' : meta.module;
    return <Fields resume={resume} fields={meta.fields} base={base} issues={issues} onEdit={onEdit} />;
  }

  const module = meta.module as ArrayModuleName;
  const entries = resume[module] as unknown as Record<string, unknown>[];
  const name = t(meta.labelKey);
  const lowerName = lowerFirst(name, language);

  // Delete is immediate; the toast offers Undo, which puts the entry back where it was (everything edited since stays).
  const remove = (index: number) => {
    const removed = entries[index] as never;
    const label = t('options.entry', { name, n: index + 1 });
    onEdit((r) => removeEntry(r, module, index));
    toast.push({
      text: t('options.entryRemoved', { name: label }),
      icon: 'trash',
      action: { label: t('options.undo'), onClick: () => onEdit((r) => insertEntry(r, module, index, removed)) },
    });
  };

  return (
    <div className="raf-entries">
      {entries.length === 0 ? <EmptyState>{t('options.noEntries', { name: lowerName })}</EmptyState> : null}
      {entries.map((entry, index) => {
        const legend = t('options.entry', { name, n: index + 1 });
        const summary = entrySummary(meta, entry);
        return (
          // Entries have no stable id; index keys are fine because every edit re-renders the whole list.
          <Fragment key={index}>
            {index > 0 ? <Divider /> : null}
            <fieldset className="raf-entry">
              <legend className="raf-entry__legend">
                <span className="raf-entry__name">{legend}</span>
                {/* Decorative: the same text is in the first field, and it should not become part of the group's name. */}
                {summary ? (
                  <span className="raf-entry__summary" aria-hidden="true">
                    {summary}
                  </span>
                ) : null}
              </legend>
              <div className="raf-entry__actions">
                <IconButton icon="arrow-up" label={t('options.moveUp')} tip={index === 0 ? t('options.moveUpFirst') : undefined} disabled={index === 0} onClick={() => onEdit((r) => moveEntry(r, module, index, -1))} />
                <IconButton
                  icon="arrow-down"
                  label={t('options.moveDown')}
                  tip={index === entries.length - 1 ? t('options.moveDownLast') : undefined}
                  disabled={index === entries.length - 1}
                  onClick={() => onEdit((r) => moveEntry(r, module, index, 1))}
                />
                <IconButton icon="trash" label={t('options.removeEntry')} danger onClick={() => remove(index)} />
              </div>
              <Fields resume={resume} fields={meta.fields} base={join(module, index)} issues={issues} onEdit={onEdit} />
            </fieldset>
          </Fragment>
        );
      })}
      <Button className="raf-add" icon="plus-lg" onClick={() => onEdit((r) => addEntry(r, module))}>
        {t('options.add', { name: lowerName })}
      </Button>
    </div>
  );
}
