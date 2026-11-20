import { describe, expect, it } from 'vitest';
import {
  ALL_FIELD_KEYS,
  ATTACHMENT_KEYS,
  FIELD_DEPS,
  emptyNeeds,
  expandFieldKeys,
  isEmptyNeeds,
  parseFrameNeeds,
  sectionModule,
} from '../../../src/engine/fieldDeps';
import { getFieldKeyDef } from '../../../src/schema/fieldKeys';

describe('FIELD_DEPS', () => {
  it('lists the sources of every derived key (mirror of derived() in engine/values.ts)', () => {
    expect(FIELD_DEPS['basics.fullName']).toEqual(['basics.familyName', 'basics.givenName']);
    expect(FIELD_DEPS['basics.age']).toEqual(['basics.birthDate']);
    expect(FIELD_DEPS['basics.isAdult']).toEqual(['basics.birthDate']);
    expect(FIELD_DEPS['workRights.citizenOrResident']).toEqual(['workRights.status', 'basics.nationality']);
    expect(FIELD_DEPS['contact.phoneFull']).toEqual(['contact.phone', 'contact.phoneCountryCode']);
    expect([...FIELD_DEPS['contact.addressFull']!].sort()).toEqual(
      ['contact.addressCity', 'contact.addressCountry', 'contact.addressDistrict', 'contact.addressProvince',
        'contact.addressStreet', 'contact.postcode'].sort(),
    );
  });

  it('every derived catalogue key has an entry, and every entry points at catalogued keys', () => {
    for (const def of ALL_FIELD_KEYS.map((k) => getFieldKeyDef(k)!)) {
      if (def.derived) expect(FIELD_DEPS[def.key], def.key).toBeDefined();
    }
    for (const [key, deps] of Object.entries(FIELD_DEPS)) {
      expect(getFieldKeyDef(key), key).toBeDefined();
      for (const d of deps) expect(getFieldKeyDef(d), `${key} → ${d}`).toBeDefined();
    }
  });

  it('expandFieldKeys adds the sources and keeps the keys', () => {
    expect([...expandFieldKeys(['basics.age', 'contact.email'])].sort()).toEqual(['basics.age', 'basics.birthDate', 'contact.email']);
  });
});

describe('sectionModule', () => {
  it('maps internship to the work module and rejects non-repeated sections', () => {
    expect(sectionModule('internship')).toBe('work');
    expect(sectionModule('education')).toBe('education');
    expect(sectionModule('basics')).toBeNull();
    expect(sectionModule('emergencyContact')).toBeNull();
  });
});

describe('parseFrameNeeds', () => {
  it('accepts a well-formed answer and drops unknown entries', () => {
    expect(
      parseFrameNeeds({
        fieldKeys: ['contact.email', 'contact.email', 'bogus.key', 'attachments.photo'],
        repeatSections: ['education', 'basics', 'nope'],
        attachmentKeys: ['attachments.resume', 'attachments.nope'],
      }),
    ).toEqual({
      fieldKeys: ['contact.email'],
      repeatSections: ['education'],
      attachmentKeys: ['attachments.resume', 'attachments.photo'],
    });
  });

  it('rejects anything that is not the right shape', () => {
    for (const bad of [
      undefined, null, 5, 'x', [], {}, { fieldKeys: [] },
      { fieldKeys: [], repeatSections: [], attachmentKeys: 'x' },
      { fieldKeys: [1], repeatSections: [], attachmentKeys: [] },
      { fieldKeys: new Array(1000).fill('contact.email'), repeatSections: [], attachmentKeys: [] },
    ]) {
      expect(parseFrameNeeds(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('empty needs are detected', () => {
    expect(isEmptyNeeds(emptyNeeds())).toBe(true);
    expect(isEmptyNeeds({ ...emptyNeeds(), attachmentKeys: [ATTACHMENT_KEYS[0]!] })).toBe(false);
    expect(isEmptyNeeds({ ...emptyNeeds(), repeatSections: ['skills'] })).toBe(false);
  });
});
