import { describe, expect, it } from 'vitest';
import { ATTACHMENT_SLOTS, MODULES, targetOfField } from '../../../src/editor';
import { FIELD_KEYS } from '../../../src/schema/fieldKeys';

describe('targetOfField – where the profile page should jump for a field', () => {
  it('a plain field goes to its module and its own input', () => {
    expect(targetOfField('contact.email')).toEqual({ module: 'contact', field: 'email' });
    expect(targetOfField('jobIntention.cities')).toEqual({ module: 'jobIntention', field: 'cities' });
    expect(targetOfField('basics.nativePlace')).toEqual({ module: 'basics', field: 'nativePlace' });
  });

  it('address parts go to the nested address inputs', () => {
    expect(targetOfField('contact.addressCity')).toEqual({ module: 'contact', field: 'address.city' });
    expect(targetOfField('contact.postcode')).toEqual({ module: 'contact', field: 'address.postcode' });
  });

  it('a field worked out from others goes to where it comes from', () => {
    expect(targetOfField('basics.fullName')).toEqual({ module: 'basics', field: 'familyName' });
    expect(targetOfField('basics.age')).toEqual({ module: 'basics', field: 'birthDate' });
    expect(targetOfField('basics.isAdult')).toEqual({ module: 'basics', field: 'birthDate' });
    expect(targetOfField('workRights.citizenOrResident')).toEqual({ module: 'workRights', field: 'status' });
    expect(targetOfField('contact.phoneFull')).toEqual({ module: 'contact', field: 'phone' });
    expect(targetOfField('contact.addressFull')).toEqual({ module: 'contact', field: 'address.country' });
    expect(targetOfField('work.period')).toEqual({ module: 'work', entry: 0, field: 'startDate' });
    expect(targetOfField('education.classYear')).toEqual({ module: 'education', entry: 0, field: 'endDate' });
    // "Present" is the checkbox under the end date.
    expect(targetOfField('projects.current')).toEqual({ module: 'projects', entry: 0, field: 'endDate' });
  });

  it('self introduction and hobbies live in the About module', () => {
    expect(targetOfField('misc.selfIntroduction')).toEqual({ module: 'about', field: 'selfIntroduction' });
  });

  it('attachments go to their upload slot', () => {
    expect(targetOfField('attachments.transcript')).toEqual({ module: 'attachments', field: 'transcriptFileId' });
  });

  it('an entry of a list module takes the index from the source, else the first entry', () => {
    expect(targetOfField('education.school', 'education[1].school')).toEqual({ module: 'education', entry: 1, field: 'school' });
    expect(targetOfField('education.school')).toEqual({ module: 'education', entry: 0, field: 'school' });
    // A source in another module says nothing about this one.
    expect(targetOfField('work.company', 'education[2].school')).toEqual({ module: 'work', entry: 0, field: 'company' });
  });

  it('returns null for a key it does not know', () => {
    expect(targetOfField('nope.thing')).toBeNull();
    expect(targetOfField('')).toBeNull();
  });

  it('every key in the catalogue lands on a real module and a real input', () => {
    for (const { key } of FIELD_KEYS) {
      const target = targetOfField(key);
      expect(target, key).not.toBeNull();
      const meta = MODULES.find((m) => m.module === target!.module);
      expect(meta, key).toBeTruthy();
      const fields: readonly string[] =
        meta!.container === 'attachments' ? ATTACHMENT_SLOTS : meta!.fields.map((f) => f.key);
      expect(fields, key).toContain(target!.field);
      if (meta!.repeatable) expect(target!.entry, key).toBe(0);
      else expect(target!.entry, key).toBeUndefined();
    }
  });
});
