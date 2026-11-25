// A work's own file goes to a frame only when the frame has a works upload.
import { describe, expect, it } from 'vitest';
import { worksFileIds } from '../../../src/background/fill';
import { createSampleProfile, ResumeSchema } from '../../../src/schema';

const resume = ResumeSchema.parse({
  ...createSampleProfile().resumes[0]!,
  works: [{ title: 'A', fileId: 'f1' }, { title: 'B' }, { title: 'C', fileId: 'f3' }],
});

describe('worksFileIds', () => {
  it('lists the works’ own files for a works upload, and nothing otherwise', () => {
    expect(worksFileIds(resume, { fieldKeys: ['works.fileId'] })).toEqual(['f1', 'f3']);
    expect(worksFileIds(resume, { fieldKeys: ['works.title'] })).toEqual([]);
  });
});
