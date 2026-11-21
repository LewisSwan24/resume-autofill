import { describe, expect, it } from 'vitest';
import { FIELD_SYNONYMS } from '../../../src/dictionary';
import { FIELD_KEYS, ProfileSchema, SettingsSchema } from '../../../src/schema';
import { SENSITIVE_FIELD_KEYS, isSensitiveFieldKey } from '../../../src/schema/sensitive';

describe('sensitive fields', () => {
  it('counts the identity or passport number as sensitive, and nothing a form routinely asks for', () => {
    expect(SENSITIVE_FIELD_KEYS).toEqual(['basics.idNumber']);
    expect(isSensitiveFieldKey('basics.idNumber')).toBe(true);
    for (const key of ['basics.idType', 'basics.birthDate', 'contact.phone', 'family.phone', 'certificates.number']) {
      expect(isSensitiveFieldKey(key)).toBe(false);
    }
    expect(isSensitiveFieldKey(null)).toBe(false);
  });

  it('names only keys the catalogue has', () => {
    const known = new Set(FIELD_KEYS.map((d) => d.key));
    for (const key of SENSITIVE_FIELD_KEYS) expect(known.has(key)).toBe(true);
  });

  it('leaves no key the dictionary asks an identity document number for outside the list', () => {
    const ID_NUMBER = /身份证号|证件号|护照号|ID number|Passport number|Identity number/i;
    const asked = Object.entries(FIELD_SYNONYMS)
      .filter(([, syn]) => [...syn.zh, ...syn.en].some((label) => ID_NUMBER.test(label)))
      .map(([key]) => key);
    expect(asked.length).toBeGreaterThan(0);
    for (const key of asked) expect(isSensitiveFieldKey(key)).toBe(true);
  });

  it('reminds by default, and keeps a choice to fill', () => {
    expect(SettingsSchema.parse({}).sensitiveFields).toBe('remind');
    expect(SettingsSchema.parse({ sensitiveFields: 'fill' }).sensitiveFields).toBe('fill');
    expect(() => SettingsSchema.parse({ sensitiveFields: 'always' })).toThrow();
    expect(ProfileSchema.parse({ schemaVersion: 2 }).settings.sensitiveFields).toBe('remind');
  });
});
