// Single-field controls for the resume form. Controlled; the parent owns the value.
// The label (visible, above the control) and error text are added by <Field> in ModuleForm; this file only renders
// the control itself and receives the ids / aria attributes through `control`.
import { enumOptions } from '../../src/editor';
import type { FieldMeta } from '../../src/editor';
import { useLanguage, useT } from '../../src/i18n';
import { IconButton, Input, SelectInput, Switch, Textarea, type ControlProps } from './ui/controls';
import { TagInput } from './ui/TagInput';

export interface FieldInputProps {
  meta: FieldMeta;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** `id` and aria attributes from the surrounding <Field>. */
  control?: Partial<ControlProps>;
  /** Overrides the accessible name (region parts keep "Native place – City" even though only "City" is visible). */
  ariaLabel?: string;
  /** Shown while empty; a variant shows the base resume's value here. */
  placeholder?: string;
}

export const REGION_PARTS = ['province', 'city', 'district'] as const;

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Boolean that autosaves, so a Switch. `null` ("not set") shows as off with a quiet caption and can be cleared again. */
export function BoolSwitch({ label, value, onChange }: { label: string; value: unknown; onChange: (v: boolean | null) => void }) {
  const t = useT();
  const isSet = value === true || value === false;
  return (
    <div className="raf-bool">
      <Switch label={label} checked={value === true} onChange={(checked) => onChange(checked)} />
      {isSet ? (
        <IconButton icon="x-lg" label={t('options.clearField', { name: label })} className="raf-bool__clear" onClick={() => onChange(null)} />
      ) : (
        <span className="raf-field__help">{t('common.unset')}</span>
      )}
    </div>
  );
}

export function FieldInput({ meta, value, onChange, disabled, control, ariaLabel, placeholder }: FieldInputProps) {
  const t = useT();
  const language = useLanguage();
  const common = { ...control, disabled, 'aria-label': ariaLabel, placeholder };

  switch (meta.input) {
    case 'textarea':
      return <Textarea rows={3} value={asString(value)} {...common} onChange={(e) => onChange(e.target.value)} />;
    case 'date': {
      const s = asString(value);
      return <Input type="date" value={s.length === 10 ? s : ''} {...common} onChange={(e) => onChange(e.target.value)} />;
    }
    case 'month': {
      const s = asString(value);
      return <Input type="month" value={s.slice(0, 7)} {...common} onChange={(e) => onChange(e.target.value)} />;
    }
    case 'number':
      return (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          value={typeof value === 'number' ? value : ''}
          {...common}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange(e.target.value === '' || Number.isNaN(n) ? null : n);
          }}
        />
      );
    case 'select': {
      const options = enumOptions(meta.enumDomain ?? '', language);
      return (
        <SelectInput value={typeof value === 'string' ? value : ''} {...control} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">{t('common.unset')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectInput>
      );
    }
    case 'list':
      return (
        <TagInput
          id={control?.id}
          aria-invalid={control?.['aria-invalid']}
          aria-describedby={control?.['aria-describedby']}
          aria-label={ariaLabel}
          value={Array.isArray(value) ? (value as string[]) : []}
          placeholder={placeholder ?? t('options.listHint')}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'bool':
    case 'region':
      // Rendered by ModuleForm (a Switch / a group of three inputs); never through this single-control path.
      return null;
    case 'text':
    default:
      return <Input type="text" value={asString(value)} {...common} onChange={(e) => onChange(e.target.value)} />;
  }
}
