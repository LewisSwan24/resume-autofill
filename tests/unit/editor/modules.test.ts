import { describe, expect, it } from 'vitest';
import { ResumeSchema } from '../../../src/schema';
import { DICTIONARIES } from '../../../src/i18n';
import { ARRAY_MODULES, MODULES, getModule, newEntry, newSubItem, type FieldMeta } from '../../../src/editor';
import { enumLabel, enumOptions } from '../../../src/editor';
import { ENUM_VALUES, SETTING_ENUM_VALUES } from '../../../src/schema';

const empty = ResumeSchema.parse({ id: 'x', title: 't', locale: 'en-AU' });
const REGION_KEYS = new Set(['nativePlace', 'studentOrigin', 'household', 'currentLocation']);

/** Leaf paths an editor must cover for a plain object (regions and arrays of strings are leaves). */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return REGION_KEYS.has(k) ? [path] : leafPaths(v, path);
  });
}

describe('module metadata', () => {
  it('covers every schema module exactly once', () => {
    const names = MODULES.map((m) => m.module);
    expect(new Set(names).size).toBe(names.length);
    const covered = new Set<string>(names);
    const skipped = new Set(['id', 'title', 'locale', 'linkedResumeId', 'createdAt', 'updatedAt']);
    for (const key of Object.keys(empty)) {
      if (skipped.has(key)) continue;
      const viaAbout = key === 'selfIntroduction' || key === 'hobbies';
      expect(covered.has(key) || viaAbout, `module for ${key}`).toBe(true);
    }
  });

  it('lists every field of every module (object, root and array modules)', () => {
    for (const meta of MODULES) {
      if (meta.container === 'attachments') continue;
      let expected: string[];
      if (meta.container === 'array') {
        expected = leafPaths(newEntry(meta.module as never)).filter((p) => p !== 'current');
      } else if (meta.container === 'root') {
        expected = ['selfIntroduction', 'hobbies'];
      } else {
        expected = leafPaths((empty as unknown as Record<string, unknown>)[meta.module]);
      }
      // A list inside each entry is edited as a whole (its items have fields of their own, checked below).
      const keys = [...meta.fields.map((f) => f.key), ...(meta.subLists ?? []).map((sub) => sub.key)];
      expect(keys.sort(), meta.module).toEqual(expected.sort());
    }
  });

  it('edits every field of a test in a language entry, with labels in both dictionaries', () => {
    const [tests] = getModule('languages').subLists ?? [];
    expect(tests?.key).toBe('tests');
    expect(tests!.fields.map((f) => f.key).sort()).toEqual(Object.keys(newSubItem(tests!)).sort());
    const keys = [tests!.labelKey, tests!.helpKey, tests!.itemLabelKey, tests!.addLabelKey, tests!.removeLabelKey, ...tests!.fields.map((f) => f.labelKey)];
    for (const lang of ['zh', 'en'] as const) {
      const dict = DICTIONARIES[lang] as Record<string, string>;
      for (const key of keys) expect(dict[key], `${lang}:${key}`).toBeTruthy();
    }
    expect(enumOptions('languageTest', 'en').map((o) => o.label)).toEqual(expect.arrayContaining(['CET-4', 'CET-6', 'IELTS', 'TOEIC', 'Other']));
    expect(enumLabel('languageTest', 'cet6', 'zh')).toBe('CET-6（英语六级）');
  });

  it('repeatable flag matches array modules, with a fresh entry for each', () => {
    for (const meta of MODULES) {
      expect(meta.repeatable).toBe(meta.container === 'array');
      expect(Array.isArray((empty as unknown as Record<string, unknown>)[meta.module])).toBe(meta.repeatable);
    }
    expect(ARRAY_MODULES).toContain('education');
    expect(newEntry('education').current).toBe(false);
    expect(newEntry('work').kind).toBe('full_time');
  });

  it('every label key exists in both dictionaries', () => {
    const keys: string[] = [];
    for (const meta of MODULES) {
      keys.push(meta.labelKey);
      keys.push(...meta.fields.map((f) => f.labelKey));
    }
    for (const lang of ['zh', 'en'] as const) {
      const dict = DICTIONARIES[lang] as Record<string, string>;
      for (const key of keys) expect(dict[key], `${lang}:${key}`).toBeTruthy();
    }
  });

  it('selects declare a known enum domain; end dates declare the current flag', () => {
    const fields: FieldMeta[] = MODULES.flatMap((m) => m.fields);
    for (const field of fields.filter((f) => f.input === 'select')) {
      expect({ ...ENUM_VALUES, ...SETTING_ENUM_VALUES }[field.enumDomain!], field.key).toBeDefined();
    }
    for (const field of fields.filter((f) => f.currentKey)) expect(field.key).toBe('endDate');
    expect(getModule('education').fields.find((f) => f.key === 'endDate')?.currentKey).toBe('current');
  });

  it('region fields exist on basics and edit province/city/district', () => {
    expect(getModule('basics').fields.filter((f) => f.input === 'region').map((f) => f.key)).toEqual([...REGION_KEYS]);
  });
});

describe('enum labels', () => {
  it('uses the first Chinese / English synonym', () => {
    expect(enumLabel('gender', 'male', 'zh')).toBe('男');
    expect(enumLabel('gender', 'male', 'en')).toBe('Male');
    expect(enumLabel('degree', 'master', 'zh')).toBe('硕士');
    expect(enumLabel('degree', 'master', 'en')).toBe('Master');
  });
  it('falls back to the code for unknown entries', () => {
    expect(enumLabel('gender', 'zzz', 'en')).toBe('zzz');
    expect(enumLabel('nope', 'a', 'en')).toBe('a');
  });
  it('offers every schema code of each domain used by the editor, in schema order', () => {
    for (const meta of MODULES) {
      for (const f of meta.fields.filter((x) => x.input === 'select')) {
        for (const lang of ['zh', 'en'] as const) {
          const options = enumOptions(f.enumDomain!, lang);
          expect(options.map((o) => o.value)).toEqual([...{ ...ENUM_VALUES, ...SETTING_ENUM_VALUES }[f.enumDomain!]!]);
          for (const o of options) expect(o.label.trim(), `${f.enumDomain}:${o.value}`).not.toBe('');
        }
      }
    }
  });
});
