// Home's progress summary: which key sections are filled, which key details are missing and where each one lives,
// and which resume is used for filling.
import { describe, expect, it } from 'vitest';
import {
  KEY_ITEMS,
  KEY_MODULES,
  isModuleFilled,
  resolveFillResume,
  summarizeResume,
} from '../../../mobile/app/src/home/summary';
import { MODULES, getModule } from '../../../src/editor';
import { EducationSchema, ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../src/schema';

const blank = (over: Partial<Resume> = {}, id = 'r1', locale: 'zh-CN' | 'en-AU' = 'zh-CN'): Resume =>
  ResumeSchema.parse({ id, title: '示例简历', locale, ...over });
const edu = (over: Record<string, unknown> = {}) => EducationSchema.parse(over);

function profileOf(resumes: Resume[], activeResumeId: string | null = resumes[0]?.id ?? null): Profile {
  return ProfileSchema.parse({ schemaVersion: 1, resumes, activeResumeId, settings: { uiLanguage: 'zh' } });
}

describe('summarizeResume', () => {
  it('a blank resume: 0 of 7 key sections, all 8 items missing in order', () => {
    const s = summarizeResume(blank());
    expect(s.total).toBe(7);
    expect(s.filledCount).toBe(0);
    expect(s.modules.map((m) => m.module)).toEqual([...KEY_MODULES]);
    expect(s.missing.map((i) => i.id)).toEqual(['name', 'phone', 'email', 'school', 'degree', 'major', 'positions', 'resumePdf']);
    expect(KEY_ITEMS.map((i) => i.id)).toEqual(s.missing.map((i) => i.id));
  });

  it('filled basics, contact and one education entry count as sections; their items drop out', () => {
    const r = blank({
      basics: { ...blank().basics, familyName: '张', givenName: '三' },
      contact: { ...blank().contact, phone: '13800000000', email: 'zhangsan@example.com' },
      education: [edu({ school: '示例大学', degree: 'bachelor', major: '计算机科学' })],
    });
    const s = summarizeResume(r);
    expect(s.filledCount).toBe(3);
    expect(s.modules.filter((m) => m.filled).map((m) => m.module)).toEqual(['basics', 'contact', 'education']);
    expect(s.missing.map((i) => i.id)).toEqual(['positions', 'resumePdf']);
    expect(s.missing[0]!.target).toEqual({ module: 'jobIntention', field: 'positions' });
    expect(s.missing[1]!.target).toEqual({ module: 'attachments', field: 'resumeFileId' });
  });

  it('name is missing while either part is blank, and targets the first blank part', () => {
    const onlyGiven = summarizeResume(blank({ basics: { ...blank().basics, givenName: '三' } }));
    expect(onlyGiven.missing[0]).toMatchObject({ id: 'name', labelKey: 'm.home.item.name', target: { module: 'basics', field: 'familyName' } });
    const onlyFamily = summarizeResume(blank({ basics: { ...blank().basics, familyName: '张' } }));
    expect(onlyFamily.missing[0]!.target).toEqual({ module: 'basics', field: 'givenName' });
    const phoneOnly = summarizeResume(blank({ contact: { ...blank().contact, phone: '13800000000' } }));
    expect(phoneOnly.missing.map((i) => i.id)).not.toContain('phone');
    expect(phoneOnly.missing.find((i) => i.id === 'email')!.target).toEqual({ module: 'contact', field: 'email' });
  });

  it('school missing with no education entries targets the module with no entry; with entries, the first blank one', () => {
    const none = summarizeResume(blank()).missing.find((i) => i.id === 'school')!;
    expect(none.target.module).toBe('education');
    expect(none.target.entry).toBeUndefined();
    expect(none.target.field).toBe('school');

    const two = summarizeResume(blank({ education: [edu({ major: '数学' }), edu({ major: '物理' })] }));
    expect(two.missing.find((i) => i.id === 'school')!.target).toEqual({ module: 'education', entry: 0, field: 'school' });
    expect(two.missing.map((i) => i.id)).not.toContain('major');

    const second = summarizeResume(blank({ education: [edu({ school: '示例大学' }), edu({})] }));
    expect(second.missing.map((i) => i.id)).not.toContain('school');
    expect(second.missing.find((i) => i.id === 'degree')!.target).toEqual({ module: 'education', entry: 0, field: 'degree' });
  });
});

describe('isModuleFilled', () => {
  it('matches the module list captions: blank defaults never count as filled', () => {
    const r = blank({}, 'r1', 'zh-CN');
    for (const meta of MODULES) expect([meta.module, isModuleFilled(meta, r)]).toEqual([meta.module, false]);
    const e = blank({}, 'r2', 'en-AU');
    for (const meta of MODULES) expect([meta.module, isModuleFilled(meta, e)]).toEqual([meta.module, false]);
  });

  it('counts an object field, a list entry, a root field and an attachment', () => {
    expect(isModuleFilled(getModule('contact'), blank({ contact: { ...blank().contact, email: 'a@example.com' } }))).toBe(true);
    expect(isModuleFilled(getModule('education'), blank({ education: [edu({})] }))).toBe(true);
    expect(isModuleFilled(getModule('about'), blank({ selfIntroduction: '你好' } as Partial<Resume>))).toBe(true);
    expect(isModuleFilled(getModule('attachments'), blank({ attachments: { photoFileId: 'f1' } } as Partial<Resume>))).toBe(true);
    expect(isModuleFilled(getModule('jobIntention'), blank({ jobIntention: { ...blank().jobIntention, positions: ['后端开发'] } }))).toBe(true);
  });
});

describe('resolveFillResume', () => {
  const zh1 = blank({ title: '中文一' }, 'zh1', 'zh-CN');
  const zh2 = blank({ title: '中文二' }, 'zh2', 'zh-CN');
  const en1 = blank({ title: 'English' }, 'en1', 'en-AU');

  it('no resumes → null', () => {
    expect(resolveFillResume(profileOf([]), 'active')).toBeNull();
    expect(resolveFillResume(profileOf([]), 'zh')).toBeNull();
  });

  it('active → the active resume', () => {
    expect(resolveFillResume(profileOf([zh1, en1], 'en1'), 'active')).toEqual({ resume: en1, fallback: false });
  });

  it('zh with an active zh resume → that one', () => {
    expect(resolveFillResume(profileOf([zh1, zh2], 'zh2'), 'zh')).toEqual({ resume: zh2, fallback: false });
  });

  it('zh with the active en linked to a zh → the linked one', () => {
    const linked = { ...en1, linkedResumeId: 'zh2' };
    expect(resolveFillResume(profileOf([zh1, zh2, linked], 'en1'), 'zh')).toEqual({ resume: zh2, fallback: false });
  });

  it('zh with no link → the first zh resume', () => {
    expect(resolveFillResume(profileOf([en1, zh1, zh2], 'en1'), 'zh')).toEqual({ resume: zh1, fallback: false });
  });

  it('zh with no zh resume at all → the active one, marked as a fallback', () => {
    expect(resolveFillResume(profileOf([en1], 'en1'), 'zh')).toEqual({ resume: en1, fallback: true });
  });

  it('en with the active zh linked to an en → the linked one', () => {
    const linked = { ...zh1, linkedResumeId: 'en1' };
    expect(resolveFillResume(profileOf([linked, en1], 'zh1'), 'en')).toEqual({ resume: en1, fallback: false });
  });
});
