// The application questions a form asks beyond the resume itself: every answer starts empty, and old profiles gain
// the section empty too.
import { describe, expect, it } from 'vitest';
import {
  APPLICATION_QUESTIONS,
  CURRENT_SCHEMA_VERSION,
  ResumeSchema,
  migrateProfile,
} from '../../../src/schema';
import { getFieldKeyDef } from '../../../src/schema/fieldKeys';

describe('the questions section', () => {
  const blank = ResumeSchema.parse({ id: 'r', title: 'R', locale: 'zh-CN' });

  it('holds every question, each answer empty', () => {
    expect(Object.keys(blank.questions).sort()).toEqual(APPLICATION_QUESTIONS.map((q) => q.key).sort());
    for (const value of Object.values(blank.questions)) expect(value === null || value === '').toBe(true);
  });

  it('keeps one fixed answer type per question, and a field key of that type', () => {
    const typeOf = { bool: 'bool', number: 'number', text: 'text', enum: 'enum' } as const;
    for (const q of APPLICATION_QUESTIONS) {
      const def = getFieldKeyDef(`questions.${q.key}`);
      expect(def, q.key).toBeDefined();
      expect(def!.type).toBe(typeOf[q.type]);
      if (q.type === 'bool') expect(def!.enumDomain).toBe('yesNo');
    }
  });

  it('puts each question in one of five groups', () => {
    const groups = new Set(APPLICATION_QUESTIONS.map((q) => q.group));
    expect([...groups].sort()).toEqual(['arrangements', 'identity', 'offers', 'relations', 'screening']);
  });

  it('takes answers of the right type and refuses others', () => {
    const r = ResumeSchema.parse({
      id: 'r', title: 'R', locale: 'en-AU',
      questions: { canTravel: true, offerCount: 2, workArrangement: 'hybrid', referrerName: 'A. Example' },
    });
    expect(r.questions).toMatchObject({ canTravel: true, offerCount: 2, workArrangement: 'hybrid', referrerName: 'A. Example' });
    expect(() => ResumeSchema.parse({ id: 'r', title: 'R', locale: 'en-AU', questions: { offerCount: -1 } })).toThrow();
    expect(() => ResumeSchema.parse({ id: 'r', title: 'R', locale: 'en-AU', questions: { workArrangement: 'moon' } })).toThrow();
  });
});

describe('migration to version 3', () => {
  it('is the current version', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });

  it('gives a version 2 profile the questions section, every answer empty, and keeps the rest', () => {
    const p = migrateProfile({
      schemaVersion: 2,
      resumes: [{ id: 'a', title: 'A', locale: 'zh-CN', jobIntention: { acceptAdjustment: true } }],
      activeResumeId: 'a',
    });
    expect(p.schemaVersion).toBe(3);
    expect(p.resumes[0]!.jobIntention.acceptAdjustment).toBe(true);
    expect(Object.values(p.resumes[0]!.questions).every((v) => v === null || v === '')).toBe(true);
  });
});
