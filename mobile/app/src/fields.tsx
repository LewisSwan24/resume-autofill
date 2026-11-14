// Field editors of the mobile profile page, one per InputKind in src/editor/modules.ts. Every editor is controlled:
// it shows the value at `path` in the resume and reports changes through `edit`.
import { useId, useState, type ReactNode } from 'react';
import {
  addEntry,
  enumOptions,
  getByPath,
  setByPath,
  setEndDate,
  toggleCurrent,
  type ArrayModuleName,
  type FieldMeta,
  type ModuleMeta,
} from '../../../src/editor';
import { useLanguage } from '../../../src/i18n';
import { ResumeSchema, type Resume } from '../../../src/schema';
import { Icon } from './Icon';
import { useMT } from './i18n';
import { IconButton, Sheet } from './ui';

export type ResumeEdit = (change: (resume: Resume) => Resume) => void;

export const REGION_PARTS = ['province', 'city', 'district'] as const;

// ------------------------------------------------------------------ schema facts

const BLANK = ResumeSchema.parse({ id: 'blank', title: '', locale: 'zh-CN' });
const nullCache = new Map<string, boolean>();

/** Whether the schema lets this field be "not set" (null). Work kind and the diversity answers, for one, do not. */
export function acceptsNull(meta: ModuleMeta, field: FieldMeta): boolean {
  const cacheKey = `${meta.module}.${field.key}`;
  const cached = nullCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let resume = BLANK;
  let base: string = meta.module;
  if (meta.repeatable) {
    resume = addEntry(resume, meta.module as ArrayModuleName);
    base = `${meta.module}.0`;
  } else if (meta.container === 'root') {
    base = '';
  }
  const path = base ? `${base}.${field.key}` : field.key;
  const ok = ResumeSchema.safeParse(setByPath(resume, path, null)).success;
  nullCache.set(cacheKey, ok);
  return ok;
}

/** Whether a value says something beyond the schema default. */
export function isFilled(value: unknown, blank: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '' && value !== blank;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.values(value).some((v) => typeof v === 'string' && v.trim() !== '');
  return value !== null && value !== undefined && value !== blank;
}

export function blankValue(meta: ModuleMeta, field: FieldMeta): unknown {
  return meta.container === 'root' ? getByPath(BLANK, field.key) : getByPath(BLANK, `${meta.module}.${field.key}`);
}

/** Keyboard and autofill hints for text fields, by key. */
function textInputProps(key: string): { type: string; inputMode?: 'email' | 'tel' | 'url'; autoComplete?: string } {
  if (key === 'email') return { type: 'email', inputMode: 'email', autoComplete: 'off' };
  if (key === 'phone' || key === 'phoneCountryCode') return { type: 'tel', inputMode: 'tel', autoComplete: 'off' };
  if (['linkedin', 'github', 'portfolio', 'website', 'link'].includes(key)) return { type: 'url', inputMode: 'url', autoComplete: 'off' };
  return { type: 'text', autoComplete: 'off' };
}

/** Split typed text into list items: commas, Chinese commas, 、 and semicolons all separate. */
export function splitListInput(text: string): string[] {
  return text
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

// ------------------------------------------------------------------ field shell

interface ShellProps {
  label: string;
  htmlFor?: string;
  labelId?: string;
  error?: string;
  errorId: string;
  children: ReactNode;
}

function FieldShell({ label, htmlFor, labelId, error, errorId, children }: ShellProps) {
  return (
    <div className="m-field">
      <label className="m-label" htmlFor={htmlFor} id={labelId}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="m-help m-help--error" id={errorId}>
          <Icon name="exclamation-triangle" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ editors

interface FieldProps {
  meta: ModuleMeta;
  field: FieldMeta;
  /** Path of the object holding the field, relative to the resume (`''` = resume root). */
  base: string;
  resume: Resume;
  issues: ReadonlyMap<string, string>;
  edit: ResumeEdit;
}

export function FieldEditor(props: FieldProps) {
  const { field } = props;
  switch (field.input) {
    case 'select':
      return <EnumField {...props} />;
    case 'bool':
      return <BoolField {...props} />;
    case 'list':
      return <ListField {...props} />;
    case 'region':
      return <RegionField {...props} />;
    default:
      return <InputField {...props} />;
  }
}

const pathIn = (base: string, key: string) => (base ? `${base}.${key}` : key);

/** text, textarea, number, date and month; an end month carries the "present" checkbox. */
function InputField({ field, base, resume, issues, edit }: FieldProps) {
  const t = useMT();
  const id = useId();
  const path = pathIn(base, field.key);
  const label = t(field.labelKey);
  const error = issues.get(path);
  const value = getByPath(resume, path);
  const current = field.currentKey ? getByPath(resume, pathIn(base, field.currentKey)) === true : false;
  const set = (v: unknown) => edit((r) => setByPath(r, path, v));
  const aria = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined };

  let control: ReactNode;
  switch (field.input) {
    case 'textarea':
      control = <textarea className="m-input m-textarea" rows={3} value={asString(value)} {...aria} onChange={(e) => set(e.target.value)} />;
      break;
    case 'number':
      control = (
        <input
          className="m-input"
          type="number"
          inputMode="decimal"
          min={0}
          value={typeof value === 'number' ? value : ''}
          {...aria}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const n = Number(raw);
            set(raw === '' || Number.isNaN(n) ? null : n);
          }}
        />
      );
      break;
    case 'date': {
      const s = asString(value);
      control = <input className="m-input" type="date" value={s.length === 10 ? s : ''} {...aria} onChange={(e) => set(e.target.value)} />;
      break;
    }
    case 'month': {
      const s = asString(value).slice(0, 7);
      control = field.currentKey ? (
        <div className="m-end-date">
          <input
            className="m-input"
            type="month"
            value={s}
            disabled={current}
            {...aria}
            onChange={(e) => edit((r) => setByPath(r, base, setEndDate(getByPath(r, base) as never, e.target.value)))}
          />
          <label className="m-check">
            <input
              type="checkbox"
              checked={current}
              onChange={(e) => edit((r) => setByPath(r, base, toggleCurrent(getByPath(r, base) as never, e.target.checked)))}
            />
            <span>{t('options.present')}</span>
          </label>
        </div>
      ) : (
        <input className="m-input" type="month" value={s} {...aria} onChange={(e) => set(e.target.value)} />
      );
      break;
    }
    default:
      control = <input className="m-input" {...textInputProps(field.key)} value={asString(value)} {...aria} onChange={(e) => set(e.target.value)} />;
  }
  return (
    <FieldShell label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      {control}
    </FieldShell>
  );
}

/** Enum: looks like an input; tapping it raises a sheet of choices. "Unset" is offered only when the schema allows it. */
function EnumField({ meta, field, base, resume, issues, edit }: FieldProps) {
  const t = useMT();
  const language = useLanguage();
  const id = useId();
  const [open, setOpen] = useState(false);
  const path = pathIn(base, field.key);
  const label = t(field.labelKey);
  const error = issues.get(path);
  const value = getByPath(resume, path);
  const options = enumOptions(field.enumDomain ?? '', language);
  const nullable = acceptsNull(meta, field);
  const choices = nullable ? [{ value: '', label: t('common.unset') }, ...options] : options;
  const currentValue = typeof value === 'string' ? value : '';
  const shown = options.find((o) => o.value === currentValue)?.label ?? t('common.unset');

  return (
    <FieldShell label={label} labelId={`${id}-label`} error={error} errorId={`${id}-error`}>
      <button
        type="button"
        className="m-input m-select"
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => setOpen(true)}
      >
        <span id={`${id}-value`} className={currentValue ? undefined : 'm-placeholder'}>
          {shown}
        </span>
        <Icon name="chevron-down" />
      </button>
      <Sheet open={open} title={label} onClose={() => setOpen(false)}>
        <div role="radiogroup" aria-label={label} className="m-choices">
          {choices.map((o) => {
            const checked = o.value === currentValue;
            return (
              <button
                key={o.value || 'unset'}
                type="button"
                role="radio"
                aria-checked={checked}
                className={checked ? 'm-choice m-choice--on' : 'm-choice'}
                onClick={() => {
                  edit((r) => setByPath(r, path, o.value === '' ? null : o.value));
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {checked ? <Icon name="check-lg" /> : null}
              </button>
            );
          })}
        </div>
      </Sheet>
    </FieldShell>
  );
}

/** Yes / no / not set: a three-way segmented control, because `null` is a real answer ("not filled in"). */
function BoolField({ field, base, resume, issues, edit }: FieldProps) {
  const t = useMT();
  const id = useId();
  const path = pathIn(base, field.key);
  const label = t(field.labelKey);
  const error = issues.get(path);
  const value = getByPath(resume, path);
  const states: Array<{ v: boolean | null; text: string }> = [
    { v: true, text: t('m.yes') },
    { v: false, text: t('m.no') },
    { v: null, text: t('common.unset') },
  ];
  return (
    <FieldShell label={label} labelId={`${id}-label`} error={error} errorId={`${id}-error`}>
      <div className="m-segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
        {states.map((s) => {
          const checked = value === s.v || (s.v === null && value !== true && value !== false);
          return (
            <button
              key={String(s.v)}
              type="button"
              role="radio"
              aria-checked={checked}
              className={checked ? 'm-segment m-segment--on' : 'm-segment'}
              onClick={() => edit((r) => setByPath(r, path, s.v))}
            >
              {s.text}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

/** List of short strings (意向城市, 意向职位): chips with a remove button, then an input and a plus button. */
function ListField({ field, base, resume, issues, edit }: FieldProps) {
  const t = useMT();
  const id = useId();
  const [draft, setDraft] = useState('');
  const path = pathIn(base, field.key);
  const label = t(field.labelKey);
  const error = issues.get(path);
  const items = (Array.isArray(getByPath(resume, path)) ? getByPath(resume, path) : []) as string[];

  const commit = () => {
    const added = splitListInput(draft).filter((s, i, all) => !items.includes(s) && all.indexOf(s) === i);
    setDraft('');
    if (added.length > 0) edit((r) => setByPath(r, path, [...((getByPath(r, path) as string[]) ?? []), ...added]));
  };

  return (
    <FieldShell label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      {items.length > 0 ? (
        <ul className="m-chips" aria-label={label}>
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="m-chip">
              <span>{item}</span>
              <button
                type="button"
                className="m-chip__remove"
                aria-label={t('m.removeValue', { value: item })}
                onClick={() => edit((r) => setByPath(r, path, (getByPath(r, path) as string[]).filter((_, i) => i !== index)))}
              >
                <Icon name="x-lg" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="m-list-add">
        <input
          id={id}
          className="m-input"
          type="text"
          enterKeyHint="done"
          autoComplete="off"
          value={draft}
          placeholder={t('m.listPlaceholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter that confirms an input-method composition (pinyin) belongs to the input method, not to us.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit();
          }}
        />
        <IconButton icon="plus-lg" label={t('m.addTo', { name: label })} onClick={commit} />
      </div>
    </FieldShell>
  );
}

/** Region (籍贯, 生源地...): province, city and district as three inputs that wrap on a narrow screen. */
function RegionField({ field, base, resume, issues, edit }: FieldProps) {
  const t = useMT();
  const id = useId();
  const path = pathIn(base, field.key);
  const label = t(field.labelKey);
  const error = issues.get(path);
  const raw = getByPath(resume, path);
  const region = (raw && typeof raw === 'object' ? raw : {}) as Record<string, string | undefined>;
  return (
    <fieldset className="m-field m-region" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="m-label">{label}</legend>
      <div className="m-region__parts">
        {REGION_PARTS.map((part) => (
          <div key={part} className="m-region__part">
            <label className="m-label m-label--sub" htmlFor={`${id}-${part}`}>
              {t(`options.region.${part}`)}
            </label>
            <input
              id={`${id}-${part}`}
              className="m-input"
              type="text"
              autoComplete="off"
              value={region[part] ?? ''}
              aria-label={`${label} – ${t(`options.region.${part}`)}`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                const text = e.target.value;
                edit((r) => setByPath(r, path, { ...((getByPath(r, path) as object | undefined) ?? {}), [part]: text }));
              }}
            />
          </div>
        ))}
      </div>
      {error ? (
        <p className="m-help m-help--error" id={`${id}-error`}>
          <Icon name="exclamation-triangle" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
