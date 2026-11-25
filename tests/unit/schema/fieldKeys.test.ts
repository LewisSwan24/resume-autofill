import { describe, expect, it } from 'vitest';
import { ENUM_DOMAINS, ENUM_VALUES, FIELD_KEYS, getFieldKeyDef } from '../../../src/schema';

const SECTIONS = [
  'basics', 'contact', 'jobIntention', 'education', 'work', 'internship', 'projects', 'works',
  'campus', 'awards', 'languages', 'certificates', 'skills', 'family',
  'emergencyContact', 'referees', 'workRights', 'diversity', 'selfIntro', 'attachments', 'other',
];

describe('FIELD_KEYS', () => {
  it('has unique keys of the form <module>.<field>', () => {
    const keys = FIELD_KEYS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
  });

  it('every enumDomain is declared in ENUM_DOMAINS, every domain is used', () => {
    const used = new Set<string>();
    for (const d of FIELD_KEYS) {
      if (d.type === 'enum' || d.type === 'bool') expect(d.enumDomain, d.key).toBeTruthy();
      if (d.enumDomain) {
        used.add(d.enumDomain);
        expect(ENUM_DOMAINS, d.key).toContain(d.enumDomain);
      }
    }
    for (const dom of ENUM_DOMAINS) expect(used.has(dom), dom).toBe(true);
  });

  it('declares the required domains and canonical values for each', () => {
    for (const dom of [
      'gender', 'idType', 'maritalStatus', 'politicalStatus', 'workRightsStatus', 'employmentType', 'degree',
      'educationType', 'workKind', 'awardLevel', 'proficiency', 'relationship', 'diversity', 'yesNo',
      'salaryCurrency', 'salaryPeriod',
    ]) {
      expect(ENUM_DOMAINS).toContain(dom);
    }
    expect(Object.keys(ENUM_VALUES).sort()).toEqual([...ENUM_DOMAINS].sort());
    expect(ENUM_VALUES.gender).toEqual(['male', 'female', 'nonbinary', 'undisclosed']);
    expect(ENUM_VALUES.degree).toContain('master');
    expect(ENUM_VALUES.politicalStatus).toContain('league_member');
  });

  it('uses valid sections, non-empty', () => {
    for (const d of FIELD_KEYS) {
      expect(d.sections.length, d.key).toBeGreaterThan(0);
      for (const s of d.sections) expect(SECTIONS, d.key).toContain(s);
    }
  });

  it('contains the contract keys with the right types', () => {
    const expected: Record<string, string> = {
      'basics.familyName': 'text',
      'basics.givenName': 'text',
      'basics.gender': 'enum',
      'basics.birthDate': 'date',
      'basics.height': 'number',
      'basics.nativePlace': 'region',
      'basics.currentLocation': 'region',
      'contact.email': 'text',
      'contact.phone': 'text',
      'contact.phoneCountryCode': 'text',
      'contact.postcode': 'text',
      'workRights.status': 'enum',
      'workRights.requiresSponsorship': 'bool',
      'jobIntention.positions': 'list',
      'jobIntention.cities': 'list',
      'jobIntention.salaryMin': 'number',
      'jobIntention.acceptRelocation': 'bool',
      'education.school': 'text',
      'education.degree': 'enum',
      'education.startDate': 'date',
      'education.current': 'bool',
      'work.company': 'text',
      'work.kind': 'enum',
      'work.description': 'longtext',
      'projects.name': 'text',
      'campus.organization': 'text',
      'awards.level': 'enum',
      'languages.proficiency': 'enum',
      'certificates.number': 'text',
      'skills.name': 'text',
      'family.relationship': 'enum',
      'emergencyContact.phone': 'text',
      'referees.email': 'text',
      'diversity.indigenous': 'enum',
      'misc.selfIntroduction': 'longtext',
      'misc.hobbies': 'longtext',
      'attachments.resume': 'file',
      'attachments.photo': 'file',
      'attachments.transcript': 'file',
      'attachments.portfolio': 'file',
    };
    for (const [key, type] of Object.entries(expected)) {
      expect(getFieldKeyDef(key)?.type, key).toBe(type);
    }
  });

  it('bool fields use yesNo; diversity uses diversity domain', () => {
    expect(getFieldKeyDef('workRights.requiresSponsorship')?.enumDomain).toBe('yesNo');
    expect(getFieldKeyDef('education.current')?.enumDomain).toBe('yesNo');
    expect(getFieldKeyDef('diversity.veteran')?.enumDomain).toBe('diversity');
  });

  it('declares derived keys', () => {
    for (const key of ['basics.fullName', 'contact.phoneFull', 'basics.age']) {
      expect(getFieldKeyDef(key)?.derived, key).toBe(true);
    }
    expect(getFieldKeyDef('basics.age')?.type).toBe('number');
    for (const key of ['basics.isAdult', 'workRights.citizenOrResident']) {
      expect(getFieldKeyDef(key)).toMatchObject({ type: 'bool', enumDomain: 'yesNo', derived: true });
    }
    expect(getFieldKeyDef('basics.familyName')?.derived).toBeFalsy();
  });

  it('places keys in their natural sections', () => {
    expect(getFieldKeyDef('education.school')?.sections).toEqual(['education']);
    expect(getFieldKeyDef('work.company')?.sections).toEqual(expect.arrayContaining(['work', 'internship']));
    expect(getFieldKeyDef('misc.selfIntroduction')?.sections).toContain('selfIntro');
    expect(getFieldKeyDef('attachments.resume')?.sections).toContain('attachments');
  });

  it('getFieldKeyDef returns undefined for unknown keys', () => {
    expect(getFieldKeyDef('nope.nothing')).toBeUndefined();
  });
});
