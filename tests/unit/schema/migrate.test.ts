import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, ProfileMigrationError, createSampleProfile, migrateProfile } from '../../../src/schema';

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
    expect(p.settings).toEqual({ uiLanguage: 'auto', previewBeforeFill: false });
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

