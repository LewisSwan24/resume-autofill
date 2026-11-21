// Form for one module of the selected resume: a plain object, or a repeatable list of entries.
import { Fragment, type ReactNode } from 'react';
import {
  addEntry,
  enumLabel,
  getByPath,
  insertEntry,
  moveEntry,
  newSubItem,
  removeEntry,
  setByPath,
  setEndDate,
  toggleCurrent,
  type ArrayModuleName,
  type FieldMeta,
  type ModuleMeta,
  type SubListMeta,
} from '../../src/editor';
import { useLanguage, useT, type MessageKey } from '../../src/i18n';
import {
  clearVariantOverride,
  inheritedSection,
  inheritedValue,
  isVariantOverride,
  type Resume,
} from '../../src/schema';
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
  /** Every resume in the profile: a variant shows what it inherits from its base. */
  allResumes?: readonly Resume[];
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
  /** Set for a variant's own (non-repeatable) fields: empty ones show the base value, marked as inherited. */
  allResumes?: readonly Resume[] | undefined;
}

function Fields({ resume, fields, base, issues, onEdit, allResumes }: FieldsProps) {
  const t = useT();
  const language = useLanguage();
  const pathOf = (key: string) => (base ? `${base}.${key}` : key);
  const change = (path: string, v: unknown) => onEdit((r) => setByPath(r, path, v));
  const variant = Boolean(allResumes && resume.variantOf);

  /** The base value shown for an empty variant field, as text; undefined when nothing is inherited. */
  const inheritedText = (field: FieldMeta, path: string): string | undefined => {
    if (!variant || !allResumes) return undefined;
    const v = inheritedValue(resume, allResumes, path);
    if (v === undefined) return undefined;
    if (field.input === 'select' && typeof v === 'string') return enumLabel(field.enumDomain ?? '', v, language);
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
    if (Array.isArray(v)) return v.join(', ');
    if (v && typeof v === 'object') return Object.values(v).filter(Boolean).join(' / ');
    return String(v);
  };
  /** "From the base resume: ..." under an inheriting field, or the way back to the base under an override. */
  const variantHint = (field: FieldMeta, path: string, label: string): ReactNode => {
    if (!variant) return null;
    const shown = inheritedText(field, path);
    if (shown !== undefined) return <p className="raf-field__help raf-variant-hint">{t('options.variant.inheritedValue', { value: shown })}</p>;
    if (!isVariantOverride(resume, path)) return null;
    return (
      <div className="raf-variant-hint">
        <Button onClick={() => onEdit((r) => clearVariantOverride(r, path))} aria-label={t('options.variant.useBaseFor', { name: label })}>
          {t('options.variant.useBase')}
        </Button>
      </div>
    );
  };

  const renderControl = (field: FieldMeta): ReactNode => {
    const path = pathOf(field.key);
    const label = t(field.labelKey);
    const error = issues.get(path);
    const value = getByPath(resume, path);

    if (field.input === 'bool') {
      return (
        <div key={field.key} className="raf-field">
          <BoolSwitch label={label} value={value} onChange={(v) => change(path, v)} />
          {error ? <p className="raf-field__help raf-field__help--error">{error}</p> : null}
          {variantHint(field, path, label)}
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
                    placeholder={variant ? inheritedText(field, `${path}.${part}`) : undefined}
                    aria-invalid={error ? true : undefined}
                    aria-label={`${label} – ${t(`options.region.${part}`)}`}
                    onChange={(e) => change(path, { ...region, [part]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
          {error ? <p className="raf-field__help raf-field__help--error">{error}</p> : null}
          {variantHint(field, path, label)}
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

    const inherited = inheritedText(field, path);
    return (
      <Fragment key={field.key}>
        <Field label={label} error={error}>
          {(control) => <FieldInput meta={field} value={value} control={control} placeholder={inherited} onChange={(v) => change(path, v)} />}
        </Field>
        {variantHint(field, path, label)}
      </Fragment>
    );
  };

  // The path marks where the side panel's "Add it to your profile" can jump to (see useFocusRequest.ts).
  const renderField = (field: FieldMeta): ReactNode => (
    <div key={field.key} className="raf-field-anchor" data-field-path={pathOf(field.key)}>
      {renderControl(field)}
    </div>
  );

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

interface SubListProps {
  resume: Resume;
  sub: SubListMeta;
  /** Path of the list, relative to the resume: `languages.0.tests`. */
  base: string;
  issues: ReadonlyMap<string, string>;
  onEdit: (edit: (resume: Resume) => Resume) => void;
}

/** A list inside one entry (the tests of a language): each item a small group of fields, added and deleted here. */
function SubList({ resume, sub, base, issues, onEdit }: SubListProps) {
  const t = useT();
  const items = (getByPath(resume, base) as unknown[] | undefined) ?? [];
  const editItems = (edit: (items: unknown[]) => unknown[]) =>
    onEdit((r) => setByPath(r, base, edit([...((getByPath(r, base) as unknown[] | undefined) ?? [])])));
  return (
    <fieldset className="raf-fieldset raf-sublist" data-field-path={base}>
      <legend className="raf-field__label">{t(sub.labelKey as MessageKey)}</legend>
      <p className="raf-field__help">{t(sub.helpKey as MessageKey)}</p>
      {items.map((_, j) => (
        // Index keys, as for entries: every edit re-renders the whole list.
        <fieldset key={j} className="raf-entry raf-sublist__item">
          <legend className="raf-entry__legend">
            <span className="raf-entry__name">{t(sub.itemLabelKey as MessageKey, { n: j + 1 })}</span>
          </legend>
          <div className="raf-entry__actions">
            <IconButton icon="trash" label={t(sub.removeLabelKey as MessageKey)} danger onClick={() => editItems((list) => list.filter((_, k) => k !== j))} />
          </div>
          <Fields resume={resume} fields={sub.fields} base={`${base}.${j}`} issues={issues} onEdit={onEdit} />
        </fieldset>
      ))}
      <Button icon="plus-lg" onClick={() => editItems((list) => [...list, newSubItem(sub)])}>
        {t(sub.addLabelKey as MessageKey)}
      </Button>
    </fieldset>
  );
}

/** First filled text field of an entry, shown next to its number so long lists stay scannable. */
function entrySummary(meta: ModuleMeta, entry: Record<string, unknown>): string {
  for (const field of meta.fields) {
    const v = entry[field.key];
    if (field.input === 'text' && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function ModuleForm({ resume, meta, issues, onEdit, allResumes }: Props) {
  const t = useT();
  const language = useLanguage();
  const toast = useToast();

  if (!meta.repeatable) {
    const base = meta.container === 'root' ? '' : meta.module;
    return <Fields resume={resume} fields={meta.fields} base={base} issues={issues} onEdit={onEdit} allResumes={allResumes} />;
  }

  const module = meta.module as ArrayModuleName;
  const entries = resume[module] as unknown as Record<string, unknown>[];
  const name = t(meta.labelKey);
  const lowerName = lowerFirst(name, language);
  const variant = Boolean(allResumes && resume.variantOf);
  const inherited = variant && allResumes ? (inheritedSection(resume, allResumes, module) as unknown as Record<string, unknown>[]) : [];

  // A variant's own entries replace the base list; giving them up returns to the base (Undo puts them back).
  const backToBase = () => {
    const own = structuredClone(entries);
    onEdit((r) => ({ ...r, [module]: [] }) as Resume);
    toast.push({
      text: t('options.variant.sectionReset', { name }),
      action: { label: t('options.undo'), onClick: () => onEdit((r) => ({ ...r, [module]: own }) as Resume) },
    });
  };

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
      {inherited.length > 0 ? (
        <div className="raf-variant-inherited" data-testid={`inherited-${module}`}>
          <p className="raf-field__help raf-variant-hint">{t('options.variant.sectionInherited')}</p>
          <ul className="raf-list">
            {inherited.map((entry, index) => (
              <li key={index} className="raf-caption">
                {entrySummary(meta, entry) || t('options.entry', { name, n: index + 1 })}
              </li>
            ))}
          </ul>
          <Button onClick={() => onEdit((r) => ({ ...r, [module]: structuredClone(inherited) }) as Resume)}>
            {t('options.variant.copySection')}
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState>{t('options.noEntries', { name: lowerName })}</EmptyState>
      ) : null}
      {variant && entries.length > 0 ? (
        <div className="raf-variant-hint">
          <p className="raf-field__help">{t('options.variant.sectionOwn')}</p>
          <Button onClick={backToBase}>{t('options.variant.resetSection')}</Button>
        </div>
      ) : null}
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
              {meta.subLists?.map((sub) => (
                <SubList key={sub.key} resume={resume} sub={sub} base={join(module, index, sub.key)} issues={issues} onEdit={onEdit} />
              ))}
            </fieldset>
          </Fragment>
        );
      })}
      <Button className="raf-add" icon="plus-lg" data-add-module={module} onClick={() => onEdit((r) => addEntry(r, module))}>
        {t('options.add', { name: lowerName })}
      </Button>
    </div>
  );
}
