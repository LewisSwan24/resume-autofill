import { describe, expect, it } from 'vitest';
import { ProfileSchema, RegionSchema, ResumeSchema } from '../../../src/schema';

describe('ResumeSchema defaults', () => {
  const empty = ResumeSchema.parse({ id: 'r1', title: 'Empty', locale: 'zh-CN' });

  it('yields a complete empty resume from { id, title, locale }', () => {
    expect(empty.id).toBe('r1');
    expect(empty.education).toEqual([]);
    expect(empty.work).toEqual([]);
    expect(empty.projects).toEqual([]);
    expect(empty.campus).toEqual([]);
    expect(empty.awards).toEqual([]);
    expect(empty.languages).toEqual([]);
    expect(empty.certificates).toEqual([]);
    expect(empty.skills).toEqual([]);
    expect(empty.family).toEqual([]);
    expect(empty.referees).toEqual([]);
    expect(empty.customAnswers).toEqual([]);
    expect(empty.attachments).toEqual({});
    expect(empty.selfIntroduction).toBe('');
    expect(empty.hobbies).toBe('');
    expect(empty.linkedResumeId).toBeUndefined();
    expect(typeof empty.createdAt).toBe('number');
    expect(typeof empty.updatedAt).toBe('number');
  });

  it('fills module defaults', () => {
    expect(empty.basics.familyName).toBe('');
    expect(empty.basics.gender).toBeNull();
    expect(empty.basics.height).toBeNull();
    expect(empty.basics.nativePlace).toEqual({});
    expect(empty.contact.phoneCountryCode).toBe('+86');
    expect(empty.contact.address.postcode).toBe('');
    expect(empty.workRights.requiresSponsorship).toBeNull();
    expect(empty.workRights.hasFullWorkRights).toBeNull();
    expect(empty.jobIntention.positions).toEqual([]);
    expect(empty.jobIntention.cities).toEqual([]);
    expect(empty.jobIntention.acceptAdjustment).toBeNull();
    expect(empty.diversity).toEqual({
      indigenous: 'prefer_not_to_say',
      disability: 'prefer_not_to_say',
      genderIdentity: 'prefer_not_to_say',
      veteran: 'prefer_not_to_say',
      genderAnswer: 'prefer_not_to_say',
    });
    expect(empty.emergencyContact.phone).toBe('');
  });

  it('fills entry defaults for array modules', () => {
    const r = ResumeSchema.parse({
      id: 'r',
      title: 't',
      locale: 'en-AU',
      education: [{ school: 'X' }],
      work: [{ company: 'Y' }],
    });
    expect(r.education[0]).toMatchObject({ school: 'X', endDate: null, current: false, degree: null });
    expect(r.work[0]).toMatchObject({ company: 'Y', kind: 'full_time', current: false, endDate: null });
  });

  it('rejects invalid enum codes, bad dates and bad locale', () => {
    const base = { id: 'r', title: 't', locale: 'zh-CN' };
    expect(ResumeSchema.safeParse({ ...base, basics: { gender: 'robot' } }).success).toBe(false);
    expect(ResumeSchema.safeParse({ ...base, education: [{ startDate: '2020/09' }] }).success).toBe(false);
    expect(ResumeSchema.safeParse({ ...base, education: [{ startDate: '2020-13' }] }).success).toBe(false);
    expect(ResumeSchema.safeParse({ ...base, locale: 'fr-FR' }).success).toBe(false);
    expect(ResumeSchema.safeParse({ ...base, id: '' }).success).toBe(false);
  });

  it('accepts YYYY-MM, YYYY-MM-DD and empty dates', () => {
    const base = { id: 'r', title: 't', locale: 'zh-CN' };
    const r = ResumeSchema.parse({
      ...base,
      basics: { birthDate: '2002-03-15' },
      education: [{ startDate: '2020-09', endDate: '2024-06' }, { startDate: '' }],
    });
    expect(r.basics.birthDate).toBe('2002-03-15');
    expect(r.education[1]!.startDate).toBe('');
  });

  it('keeps booleans as booleans, not strings', () => {
    const base = { id: 'r', title: 't', locale: 'en-AU' };
    expect(ResumeSchema.safeParse({ ...base, workRights: { requiresSponsorship: 'yes' } }).success).toBe(false);
    expect(ResumeSchema.parse({ ...base, workRights: { requiresSponsorship: false } }).workRights.requiresSponsorship).toBe(false);
  });
});

describe('RegionSchema', () => {
  it('accepts partial regions', () => {
    expect(RegionSchema.parse({ province: '浙江省' })).toEqual({ province: '浙江省' });
  });
});

describe('ProfileSchema', () => {
  it('parses an empty profile with defaults', () => {
    const p = ProfileSchema.parse({ schemaVersion: 1 });
    expect(p).toEqual({
      schemaVersion: 1,
      resumes: [],
      activeResumeId: null,
      settings: { uiLanguage: 'auto', previewBeforeFill: false },
    });
  });

  it('rejects a wrong schemaVersion', () => {
    expect(ProfileSchema.safeParse({ schemaVersion: 3 }).success).toBe(false);
    expect(ProfileSchema.safeParse({}).success).toBe(false);
  });
});

