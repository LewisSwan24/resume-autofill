import { describe, expect, it } from 'vitest';
import {
  ProfileSchema,
  ResumeSchema,
  inheritedValue,
  materializeResume,
  migrateProfile,
  promoteVariantsOf,
  type Resume,
} from '../../../src/schema';

const base = (): Resume =>
  ResumeSchema.parse({
    id: 'base',
    title: 'Base',
    locale: 'en-AU',
    basics: { familyName: 'Lee', givenName: 'Alex' },
    contact: { email: 'alex@example.com', phoneCountryCode: '+61', phone: '400000000' },
    diversity: { indigenous: 'no' },
    work: [
      { company: 'First Co', position: 'Dev' },
      { company: 'Second Co', position: 'Lead' },
    ],
    education: [{ school: 'Example University' }],
    attachments: { resumeFileId: 'base-cv', photoFileId: 'base-photo' },
    selfIntroduction: 'Base summary',
    customAnswers: [{ question: 'Q', answer: 'A' }],
  });

/** A variant exactly as TailorPanel creates it: schema defaults only, no overrides. */
const variant = (extra: Record<string, unknown> = {}): Resume =>
  ResumeSchema.parse({ id: 'v', title: 'Variant', locale: 'en-AU', variantOf: 'base', ...extra });

describe('variant override rule', () => {
  it('an empty variant (schema defaults only) inherits every base value', () => {
    const b = base();
    const view = materializeResume(variant(), [b, variant()]);
    expect(view.basics).toEqual(b.basics);
    // `+86` and `prefer_not_to_say` are schema defaults, not overrides.
    expect(view.contact.phoneCountryCode).toBe('+61');
    expect(view.diversity.indigenous).toBe('no');
    expect(view.work).toEqual(b.work);
    expect(view.attachments).toEqual(b.attachments);
    expect(view.selfIntroduction).toBe('Base summary');
    expect(view.customAnswers).toEqual(b.customAnswers);
    expect(view.id).toBe('v');
    expect(view.title).toBe('Variant');
  });

  it('a non-empty variant scalar wins; empty ones follow the base', () => {
    const v = variant({ basics: { givenName: 'Sam' }, contact: { phone: '411111111' } });
    const view = materializeResume(v, [base(), v]);
    expect(view.basics.givenName).toBe('Sam');
    expect(view.basics.familyName).toBe('Lee');
    expect(view.contact.phone).toBe('411111111');
    expect(view.contact.email).toBe('alex@example.com');
  });

  it("a section with the variant's own entries replaces the base list", () => {
    const v = variant({ work: [{ company: 'Only Co' }] });
    const view = materializeResume(v, [base(), v]);
    expect(view.work.map((w) => w.company)).toEqual(['Only Co']);
    expect(view.education.map((e) => e.school)).toEqual(['Example University']);
  });

  it('an attachment slot set on the variant wins, unset slots follow the base', () => {
    const v = variant({ attachments: { resumeFileId: 'variant-cv' } });
    const view = materializeResume(v, [base(), v]);
    expect(view.attachments).toEqual({ resumeFileId: 'variant-cv', photoFileId: 'base-photo' });
  });

  it('keeps the overlay fields working: customSummary, targetRole, customAnswers', () => {
    const v = variant({
      selfIntroduction: 'Variant own summary',
      customAnswers: [{ question: 'Why us', answer: 'Because' }],
      variantMeta: { targetRole: 'Platform Engineer' },
    });
    const view = materializeResume(v, [base(), v]);
    expect(view.selfIntroduction).toBe('Variant own summary');
    expect(view.customAnswers).toEqual([{ question: 'Why us', answer: 'Because' }]);
    expect(view.jobIntention.positions[0]).toBe('Platform Engineer');

    const withSummary = { ...v, variantMeta: { customSummary: 'Tailored' } };
    expect(materializeResume(withSummary, [base(), withSummary]).selfIntroduction).toBe('Tailored');
  });

  it('a variant of a variant stacks overrides along the chain', () => {
    const mid = variant({ basics: { givenName: 'Mid' } });
    const leaf = ResumeSchema.parse({ id: 'leaf', title: 'Leaf', locale: 'en-AU', variantOf: 'v', contact: { phone: '422' } });
    const view = materializeResume(leaf, [base(), mid, leaf]);
    expect(view.basics.givenName).toBe('Mid');
    expect(view.basics.familyName).toBe('Lee');
    expect(view.contact.phone).toBe('422');
  });

  it('inheritedValue reports the base value only where the variant has none', () => {
    const b = base();
    const v = variant({ basics: { givenName: 'Sam' } });
    expect(inheritedValue(v, [b, v], 'basics.familyName')).toBe('Lee');
    expect(inheritedValue(v, [b, v], 'basics.givenName')).toBeUndefined();
    expect(inheritedValue(v, [b, v], 'attachments.resumeFileId')).toBe('base-cv');
    expect(inheritedValue(b, [b, v], 'basics.familyName')).toBeUndefined();
  });
});

describe('hidden entries are keyed by a stable id', () => {
  it('migrates legacy hiddenIndices: hide work[0], delete it from the base, the other entry stays visible', () => {
    const migrated = migrateProfile({
      schemaVersion: 2,
      activeResumeId: 'base',
      resumes: [base(), variant({ variantMeta: { hiddenIndices: { work: [0] } } })],
    });
    let [b, v] = migrated.resumes as [Resume, Resume];
    expect(v.variantMeta?.hiddenIndices).toBeUndefined();
    expect(materializeResume(v, [b, v]).work.map((w) => w.company)).toEqual(['Second Co']);

    // The user deletes the hidden entry from the base resume.
    b = { ...b, work: b.work.slice(1) };
    expect(materializeResume(v, [b, v]).work.map((w) => w.company)).toEqual(['Second Co']);

    // Reordering the base does not change which entry is hidden either.
    b = { ...b, work: [b.work[0]!, ...migrated.resumes[0]!.work.slice(0, 1)] };
    expect(materializeResume(v, [b, v]).work.map((w) => w.company)).toEqual(['Second Co']);
    expect(ProfileSchema.safeParse({ ...migrated, resumes: [b, v] }).success).toBe(true);
  });

  it('migration is stable: reading twice gives the same ids', () => {
    const raw = {
      schemaVersion: 2,
      activeResumeId: 'base',
      resumes: [base(), variant({ variantMeta: { hiddenIndices: { work: [1] } } })],
    };
    const once = migrateProfile(raw);
    expect(migrateProfile(once)).toEqual(once);
  });
});

describe('promoting variants when their base is deleted', () => {
  it("keeps the variant's own overrides and inherits the rest", () => {
    const b = base();
    const v = variant({ basics: { givenName: 'Sam' }, attachments: { resumeFileId: 'variant-cv' } });
    const [promoted] = promoteVariantsOf([b, v], 'base').filter((r) => r.id === 'v');
    expect(promoted!.variantOf).toBeUndefined();
    expect(promoted!.basics.givenName).toBe('Sam');
    expect(promoted!.basics.familyName).toBe('Lee');
    expect(promoted!.attachments.resumeFileId).toBe('variant-cv');
    expect(promoted!.attachments.photoFileId).toBe('base-photo');
  });
});
