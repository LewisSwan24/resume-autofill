import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ProfileSchema, ResumeSchema } from '../../../src/schema';
import { removeResume } from '../../../src/editor';
import { deleteResume, loadProfile, saveProfile } from '../../../src/storage';

beforeEach(() => {
  fakeBrowser.reset();
});

const profileWithVariant = () =>
  ProfileSchema.parse({
    schemaVersion: 2,
    activeResumeId: 'base',
    resumes: [
      ResumeSchema.parse({
        id: 'base',
        title: 'Base',
        locale: 'en-AU',
        basics: { familyName: 'Lee', givenName: 'Alex' },
        attachments: { resumeFileId: 'base-cv', photoFileId: 'base-photo' },
        work: [{ company: 'First Co' }],
      }),
      ResumeSchema.parse({
        id: 'v',
        title: 'Variant',
        locale: 'en-AU',
        variantOf: 'base',
        basics: { givenName: 'Sam' },
        attachments: { resumeFileId: 'variant-cv' },
      }),
    ],
  });

describe('deleting the base of a variant', () => {
  it("deleteResume keeps the variant's own givenName and CV, and the base's other values", async () => {
    await saveProfile(profileWithVariant());
    await deleteResume('base');
    const [promoted] = (await loadProfile()).resumes;
    expect(promoted?.id).toBe('v');
    expect(promoted?.variantOf).toBeUndefined();
    expect(promoted?.basics.givenName).toBe('Sam');
    expect(promoted?.attachments.resumeFileId).toBe('variant-cv');
    expect(promoted?.basics.familyName).toBe('Lee');
    expect(promoted?.attachments.photoFileId).toBe('base-photo');
    expect(promoted?.work.map((w) => w.company)).toEqual(['First Co']);
  });

  it('the editor removeResume (what the options page uses) promotes the same way', () => {
    const next = removeResume(profileWithVariant(), 'base');
    const [promoted] = next.resumes;
    expect(promoted?.variantOf).toBeUndefined();
    expect(promoted?.basics.givenName).toBe('Sam');
    expect(promoted?.basics.familyName).toBe('Lee');
    expect(promoted?.attachments.resumeFileId).toBe('variant-cv');
    expect(promoted?.work.map((w) => w.company)).toEqual(['First Co']);
  });
});
