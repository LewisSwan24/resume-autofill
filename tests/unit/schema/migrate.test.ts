import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, LanguageEntrySchema, ProfileMigrationError, createSampleProfile, migrateProfile } from '../../../src/schema';

describe('migrateProfile', () => {
  it('passes a current-version profile through (validated)', () => {
    const sample = createSampleProfile();
    expect(migrateProfile(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
  });

  it('migrates an un-versioned v0 object { resumes } to v1', () => {
    const p = migrateProfile({
      resumes: [{ id: 'a', title: 'A', locale: 'zh-CN', basics: { familyName: '林' } }],
    });
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.resumes).toHaveLength(1);
    expect(p.resumes[0]!.basics.familyName).toBe('林');
    expect(p.resumes[0]!.education).toEqual([]);
    expect(p.activeResumeId).toBe('a');
    expect(p.settings).toEqual({ uiLanguage: 'auto', previewBeforeFill: false, sensitiveFields: 'remind' });
  });

  it('keeps an explicit activeResumeId when migrating v0', () => {
    const p = migrateProfile({
      resumes: [
        { id: 'a', title: 'A', locale: 'zh-CN' },
        { id: 'b', title: 'B', locale: 'en-AU' },
      ],
      activeResumeId: 'b',
    });
    expect(p.activeResumeId).toBe('b');
  });

  it('migrates an empty v0 object', () => {
    const p = migrateProfile({ resumes: [] });
    expect(p.activeResumeId).toBeNull();
  });

  it.each([null, undefined, 42, 'text', [], {}, { resumes: 'nope' }, { schemaVersion: 1, resumes: [{ id: 1 }] }])(
    'throws ProfileMigrationError on garbage %j',
    (garbage) => {
      expect(() => migrateProfile(garbage)).toThrow(ProfileMigrationError);
    },
  );

  it('throws on a version newer than this build, and on invalid versions', () => {
    expect(() => migrateProfile({ schemaVersion: 99, resumes: [] })).toThrow(ProfileMigrationError);
    expect(() => migrateProfile({ schemaVersion: 'x', resumes: [] })).toThrow(ProfileMigrationError);
    expect(() => migrateProfile({ schemaVersion: -1, resumes: [] })).toThrow(ProfileMigrationError);
  });

  describe('test scores of a language entry', () => {
    const withLanguages = (languages: object[]) =>
      migrateProfile({ schemaVersion: 2, resumes: [{ id: 'a', title: 'A', locale: 'zh-CN', languages }] }).resumes[0]!.languages;

    it('starts a new entry with an empty list', () => {
      expect(LanguageEntrySchema.parse({}).tests).toEqual([]);
    });

    it('derives the test and its score from a certificate that names exactly one test, keeping the old fields', () => {
      const [en, ja] = withLanguages([
        { language: '英语', certificate: '大学英语六级（CET-6）', score: '520' },
        { language: '日语', certificate: '日语N1', score: '150' },
      ]);
      expect(en).toMatchObject({ certificate: '大学英语六级（CET-6）', score: '520', tests: [{ test: 'cet6', score: '520', date: '' }] });
      expect(ja!.tests).toEqual([{ test: 'jlpt_n1', score: '150', date: '' }]);
    });

    it('derives nothing from two tests, a test with no score, a word that is no test, or a list already kept', () => {
      const [two, noScore, notTest, kept, otherLanguage] = withLanguages([
        { language: '英语', certificate: 'CET-4 / CET-6', score: '560' },
        { language: '英语', certificate: 'CET-6', score: '' },
        { language: '英语', certificate: '流利', score: '90' },
        { language: '英语', certificate: 'CET-6', score: '520', tests: [{ test: 'ielts', score: '7.5' }] },
        { language: '日语', certificate: 'CET-4', score: '500' },
      ]);
      expect(two!.tests).toEqual([]);
      expect(noScore!.tests).toEqual([]);
      expect(notTest!.tests).toEqual([]);
      expect(kept!.tests).toEqual([{ test: 'ielts', score: '7.5', date: '' }]);
      expect(otherLanguage!.tests).toEqual([]);
    });
  });

  it('exposes a typed error', () => {
    try {
      migrateProfile(7);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileMigrationError);
      expect(e).toBeInstanceOf(Error);
      expect((e as ProfileMigrationError).name).toBe('ProfileMigrationError');
    }
  });
});

