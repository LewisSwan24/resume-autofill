// Single-field inputs for the resume form. Controlled; the parent owns the value.
import { useEffect, useState } from 'react';
import { enumOptions } from '../../src/editor';
import type { FieldMeta } from '../../src/editor';
import { useLanguage, useT } from '../../src/i18n';

export interface FieldInputProps {
  meta: FieldMeta;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** Accessible name when no visible label wraps the control (region parts, standalone inputs). */
  ariaLabel?: string;
}

const REGION_PARTS = ['province', 'city', 'district'] as const;
const LIST_SPLIT = /[,，、;；\n]/;

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

export const parseList = (text: string): string[] =>
  text.split(LIST_SPLIT).map((s) => s.trim()).filter(Boolean);

/** Comma-separated list; keeps the raw text locally so typing a trailing comma is not eaten. */
function ListInput({ value, onChange, ariaLabel }: { value: unknown; onChange: (v: string[]) => void; ariaLabel?: string }) {
  const t = useT();
  const list = Array.isArray(value) ? (value as string[]) : [];
  const [raw, setRaw] = useState(list.join(', '));
  useEffect(() => {
    setRaw((prev) => (parseList(prev).join('\u0000') === list.join('\u0000') ? prev : list.join(', ')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join('\u0000')]);
  return (
    <input
      type="text"
      value={raw}
      aria-label={ariaLabel}
      placeholder={t('options.listHint')}
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

export function FieldInput({ meta, value, onChange, disabled, ariaLabel }: FieldInputProps) {
  const t = useT();
  const language = useLanguage();

  switch (meta.input) {
    case 'textarea':
      return (
        <textarea rows={3} value={asString(value)} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
      );
    case 'date': {
      const s = asString(value);
      return (
        <input type="date" value={s.length === 10 ? s : ''} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
      );
    }
    case 'month': {
      const s = asString(value);
      return (
        <input type="month" value={s.slice(0, 7)} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
      );
    }
    case 'number':
      return (
        <input
          type="number"
          min={0}
          value={typeof value === 'number' ? value : ''}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange(e.target.value === '' || Number.isNaN(n) ? null : n);
          }}
        />
      );
    case 'select': {
      const options = enumOptions(meta.enumDomain ?? '', language);
      return (
        <select value={typeof value === 'string' ? value : ''} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">{t('common.unset')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case 'bool':
      return (
        <select
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
        >
          <option value="">{t('common.unset')}</option>
          <option value="yes">{t('common.yes')}</option>
          <option value="no">{t('common.no')}</option>
        </select>
      );
    case 'region': {
      const region = (value && typeof value === 'object' ? value : {}) as Record<string, string | undefined>;
      return (
        <div className="raf-region">
          {REGION_PARTS.map((part) => (
            <input
              key={part}
              type="text"
              value={region[part] ?? ''}
              placeholder={t(`options.region.${part}`)}
              aria-label={`${ariaLabel ?? t(meta.labelKey)} – ${t(`options.region.${part}`)}`}
              disabled={disabled}
              onChange={(e) => onChange({ ...region, [part]: e.target.value })}
            />
          ))}
        </div>
      );
    }
    case 'list':
      return <ListInput value={value} onChange={onChange} ariaLabel={ariaLabel} />;
    case 'text':
    default:
      return <input type="text" value={asString(value)} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />;
  }
}
