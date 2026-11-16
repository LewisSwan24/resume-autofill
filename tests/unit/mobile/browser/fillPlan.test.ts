import { describe, expect, it } from 'vitest';
import type { FrameNeeds } from '../../../../src/engine/fieldDeps';
import { ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../../src/schema';
import { DEMO_ORIGIN } from '../../../../mobile/app/src/browser/model/constants';
import { countLeaves, handedOver, pickResume, planFrames } from '../../../../mobile/app/src/browser/model/fillPlan';
import { SAMPLE_RESUME_EN, SAMPLE_RESUME_ZH } from '../../../../mobile/app/src/browser/model/sampleResume';

const needs = (over: Partial<FrameNeeds> = {}): FrameNeeds => ({ fieldKeys: [], repeatSections: [], attachmentKeys: [], ...over });

const resume: Resume = ResumeSchema.parse({
  id: 'r1',
  title: '我的简历',
  locale: 'zh-CN',
  basics: { familyName: '张', givenName: '三', idNumber: '110101200001010000' },
  contact: { email: 'zhangsan@example.com', phone: '13800000000' },
  education: [{ school: '示例大学' }, { school: '示例学院' }],
  attachments: { resumeFileId: 'f-cv', photoFileId: 'f-photo' },
});

const profile = (resumes: Resume[], active: string | null = resumes[0]?.id ?? null): Profile =>
  ProfileSchema.parse({ schemaVersion: 1, resumes, activeResumeId: active });

describe('planFrames', () => {
  it('a frame gets only the leaves it asked for; the id number never leaves', () => {
    const [plan] = planFrames(resume, new Map([[0, needs({ fieldKeys: ['basics.familyName', 'basics.givenName', 'contact.email', 'basics.idNumber'] })]]));
    expect(plan!.resume.basics.familyName).toBe('张');
    expect(plan!.resume.contact.email).toBe('zhangsan@example.com');
    expect(plan!.resume.contact.phone).toBe('');
    expect(plan!.resume.basics.idNumber).toBe('');
    expect(plan!.resume.title).toBe('');
  });

  it('plans only the requested attachment file', () => {
    const [plan] = planFrames(resume, new Map([[0, needs({ attachmentKeys: ['attachments.resume'] })]]));
    expect(plan!.fileIds).toEqual(['f-cv']);
    expect(plan!.resume.attachments.photoFileId).toBeUndefined();
  });

  it('a frame with empty needs gets no plan', () => {
    const plans = planFrames(resume, new Map([[0, needs()], [3, needs({ fieldKeys: ['contact.email'] })]]));
    expect(plans.map((p) => p.frame)).toEqual([3]);
  });

  it('two frames with different needs each get only their own leaves', () => {
    const plans = planFrames(
      resume,
      new Map([
        [0, needs({ fieldKeys: ['basics.familyName'] })],
        [1, needs({ fieldKeys: ['contact.phone'] })],
      ]),
    );
    expect(plans[0]!.resume.basics.familyName).toBe('张');
    expect(plans[0]!.resume.contact.phone).toBe('');
    expect(plans[1]!.resume.contact.phone).toBe('13800000000');
    expect(plans[1]!.resume.basics.familyName).toBe('');
  });
});

describe('countLeaves', () => {
  it('counts the union of expanded keys across frames', () => {
    expect(countLeaves([needs({ fieldKeys: ['contact.email'] }), needs({ fieldKeys: ['contact.email'] })])).toBe(1);
    expect(countLeaves([needs({ fieldKeys: ['basics.fullName'] })])).toBeGreaterThan(1);
  });
  it('is above 200 for a synthetic needs list', () => {
    const keys = Array.from({ length: 210 }, (_, i) => `synthetic.k${i}`);
    expect(countLeaves([needs({ fieldKeys: keys })])).toBeGreaterThan(200);
  });
  it('a whole repeated section counts every leaf of its module, once per entry when the resume is known', () => {
    const one = countLeaves([needs({ repeatSections: ['education'] })]);
    expect(one).toBeGreaterThan(10);
    expect(countLeaves([needs({ repeatSections: ['education'] })], resume)).toBe(one * 2);
  });
});

describe('pickResume', () => {
  const zh = resume;
  it('the sample on the demo origin with a sample choice', () => {
    expect(pickResume(DEMO_ORIGIN, { kind: 'sample' }, profile([zh]), 'active')).toEqual({ resume: SAMPLE_RESUME_ZH, sample: true, fallback: false });
    expect(pickResume(DEMO_ORIGIN, { kind: 'sample' }, null, 'en')).toMatchObject({ resume: SAMPLE_RESUME_EN, sample: true });
  });
  it('the sample is the default on the demo origin, but the person can pick their own', () => {
    expect(pickResume(DEMO_ORIGIN, { kind: 'default' }, profile([zh]), 'active')).toMatchObject({ sample: true });
    expect(pickResume(DEMO_ORIGIN, { kind: 'profile', resumeId: 'r1' }, profile([zh]), 'active')).toMatchObject({ resume: zh, sample: false });
  });
  it('never the sample on a real origin: a sample choice falls back to the profile default', () => {
    expect(pickResume('https://jobs.example.com', { kind: 'sample' }, profile([zh]), 'active')).toEqual({ resume: zh, sample: false, fallback: false });
  });
  it('an empty profile on a real origin is empty', () => {
    expect(pickResume('https://jobs.example.com', { kind: 'default' }, profile([]), 'active')).toEqual({ empty: true });
    expect(pickResume('https://jobs.example.com', { kind: 'sample' }, null, 'active')).toEqual({ empty: true });
    const blank = ResumeSchema.parse({ id: 'b', title: '', locale: 'zh-CN' });
    expect(pickResume('https://jobs.example.com', { kind: 'default' }, profile([blank]), 'active')).toEqual({ empty: true });
  });
  it('passes the fallback flag through from resolveFillResume', () => {
    expect(pickResume('https://jobs.example.com', { kind: 'default' }, profile([zh]), 'en')).toEqual({ resume: zh, sample: false, fallback: true });
  });
});

describe('handedOver', () => {
  it('lists labels per module, whole sections with their entry counts, and file names', () => {
    const plans = planFrames(
      resume,
      new Map([
        [0, needs({ fieldKeys: ['basics.familyName', 'contact.email', 'education.school'], repeatSections: ['education'], attachmentKeys: ['attachments.resume'] })],
      ]),
    );
    const files = { 'f-cv': { id: 'f-cv', name: 'cv.pdf', type: 'application/pdf', size: 10, createdAt: 0 } };
    const h = handedOver(resume, plans, files);
    expect(h.fields).toEqual(
      expect.arrayContaining([
        { moduleLabelKey: 'options.module.basics', labels: ['options.field.familyName'] },
        { moduleLabelKey: 'options.module.contact', labels: ['options.field.email'] },
      ]),
    );
    expect(h.fields.some((f) => f.moduleLabelKey === 'options.module.education')).toBe(false);
    expect(h.wholeSections).toEqual([{ section: 'education', entries: 2 }]);
    expect(h.files).toEqual(['cv.pdf']);
    expect(h.total).toBeGreaterThan(3);
  });
});
