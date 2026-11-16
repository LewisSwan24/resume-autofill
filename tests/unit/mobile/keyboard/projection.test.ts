// The keyboard projection: profile + app state → KeyboardData. Same language rules as the fill
// browser (resolveValue, entryFieldText, optionLabel, resolveFillResume); labels in the UI language, values in the
// resume's. Neutral sample data only (sampleResume.ts plus small inline edits).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RESUME_EN, SAMPLE_RESUME_ZH } from '../../../../mobile/app/src/browser/model/sampleResume';
import { KB_LIMITS, KeyboardDataSchema, type KbItem, type KeyboardData } from '../../../../mobile/app/src/keyboard/keyboardData';
import { buildKeyboardData, counterpartOf, keyboardResumeId as kid, zhOrdinal } from '../../../../mobile/app/src/keyboard/projection';
import { emptyProfile } from '../../../../mobile/app/src/store/profileStore';
import { ResumeSchema, type Profile, type Resume } from '../../../../src/schema';

const FIXTURE = resolve(__dirname, '../fixtures/keyboard/projection-v1.json');

const resume = (id: string, locale: 'zh-CN' | 'en-AU', extra: Record<string, unknown> = {}): Resume =>
  ResumeSchema.parse({ id, title: '', locale, createdAt: 1700000000123, updatedAt: 1700000000456, ...extra });
const zhR = (id: string, extra: Record<string, unknown> = {}) => resume(id, 'zh-CN', { basics: { familyName: '张', givenName: '三' }, ...extra });
const enR = (id: string, extra: Record<string, unknown> = {}) => resume(id, 'en-AU', { basics: { familyName: 'Zhang', givenName: 'San' }, ...extra });
const profileOf = (resumes: Resume[], active: string | null = resumes[0]?.id ?? null): Profile => ({ ...emptyProfile(), resumes, activeResumeId: active });
const withSample = (edit: Partial<Resume> = {}): Resume => ({ ...SAMPLE_RESUME_ZH, ...edit });

const build = (p: Profile, o: Partial<Parameters<typeof buildKeyboardData>[1]> = {}) =>
  buildKeyboardData(p, { language: 'zh', fillLanguage: 'active', hidden: [], ...o });
const must = (d: KeyboardData | null): KeyboardData => {
  expect(d).not.toBeNull();
  expect(KeyboardDataSchema.safeParse(d).success).toBe(true);
  return d!;
};
const itemsOf = (d: KeyboardData, r = 0): KbItem[] => d.resumes[r]!.groups.flatMap((g) => g.sections.flatMap((s) => s.items));
const item = (d: KeyboardData, id: string, r = 0): KbItem | undefined => itemsOf(d, r).find((i) => i.id === id);
const groupIds = (d: KeyboardData, r = 0) => d.resumes[r]!.groups.map((g) => g.id);

describe('zhOrdinal', () => {
  it('1..10 → 一..十, otherwise the number', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(zhOrdinal)).toEqual(['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']);
    expect(zhOrdinal(11)).toBe('11');
    expect(zhOrdinal(0)).toBe('0');
  });
});

describe('buildKeyboardData: groups and items', () => {
  it('a resume with only basics gives only the basics group; empty modules never appear', () => {
    const d = must(build(profileOf([zhR('a', { contact: { phone: '13800000000' } })])));
    expect(groupIds(d)).toEqual(['basics']);
    expect(d.resumes[0]!.groups[0]!.sections).toHaveLength(1);
    expect(d.resumes[0]!.groups[0]!.sections[0]!.title).toBeNull();
    expect(d.resumes[0]!.groups[0]!.sections[0]!.a11y).toBeNull();
  });

  it('basics starts 姓名, 手机号码; 姓名 = 张三; the en sample gives San Zhang', () => {
    const d = must(build(profileOf([withSample()])));
    const basics = d.resumes[0]!.groups[0]!;
    expect(basics.id).toBe('basics');
    expect(basics.label).toBe('基本信息');
    const labels = basics.sections[0]!.items.map((i) => i.label);
    expect(labels.slice(0, 2)).toEqual(['姓名', '手机号码']);
    expect(basics.sections[0]!.items[0]).toEqual({ id: 'basics.0.fullName', label: '姓名', value: '张三', kinds: ['name'] });
    expect(item(d, 'basics.0.phoneFull')).toMatchObject({ label: '手机（带区号）', value: '+86 13800000000', kinds: ['phone'] });
    expect(item(d, 'basics.0.phoneCountryCode')?.value).toBe('+86');
    const en = must(build(profileOf([SAMPLE_RESUME_EN])));
    expect(item(en, 'basics.0.fullName')?.value).toBe('San Zhang');
  });

  it('follows the fixed order of the groups', () => {
    const r = withSample({
      projects: [{ name: '示例项目', role: '', startDate: null, endDate: null, current: false, description: '', link: 'https://example.com/p' }],
      campus: [{ organization: '学生会', role: '', startDate: null, endDate: null, current: false, description: '' }],
      awards: [{ name: '一等奖学金', date: null, level: null, issuer: '', description: '' }],
      contact: { ...SAMPLE_RESUME_ZH.contact, github: 'https://github.com/example' },
      customAnswers: [{ question: '为什么申请？', answer: '喜欢这份工作。' }],
      family: [{ name: '张一', relationship: 'father', employer: '', position: '', phone: '', politicalStatus: null }],
    } as unknown as Partial<Resume>);
    const d = must(build(profileOf([r])));
    expect(groupIds(d)).toEqual(['basics', 'education', 'internship', 'projects', 'campus', 'awards', 'skills', 'intention', 'links', 'about', 'other']);
    const basicsOrder = d.resumes[0]!.groups[0]!.sections[0]!.items.map((i) => i.id.split('.').slice(2).join('.'));
    expect(basicsOrder).toEqual([
      'fullName', 'phone', 'phoneFull', 'phoneCountryCode', 'email', 'familyName', 'givenName', 'englishName', 'gender', 'birthDate',
      'politicalStatus', 'currentLocation', 'addressFull', 'address.country', 'address.city',
    ]);
    const other = d.resumes[0]!.groups.find((g) => g.id === 'other')!;
    expect(other.sections.map((s) => s.title)).toEqual(['紧急联系人', '家庭成员 · 第一位']);
    expect(other.sections[1]!.a11y).toBe('家庭成员第一位');
    const about = d.resumes[0]!.groups.find((g) => g.id === 'about')!;
    expect(about.sections.map((s) => s.title)).toEqual([null, '为什么申请？']);
    expect(about.sections[1]!.a11y).toBe('问题 1');
    expect(about.sections[1]!.items[0]).toMatchObject({ label: '回答', value: '喜欢这份工作。' });
  });

  it('two education entries give two titled sections with positional ids', () => {
    const second = { ...SAMPLE_RESUME_ZH.education[0]!, school: '示例研究院', startDate: '2025-09', endDate: '2028-06', degree: 'master' as const };
    const p = profileOf([withSample({ education: [SAMPLE_RESUME_ZH.education[0]!, second] })]);
    const d = must(build(p));
    const edu = d.resumes[0]!.groups.find((g) => g.id === 'education')!;
    expect(edu.label).toBe('教育');
    expect(edu.sections.map((s) => s.title)).toEqual(['第一段 · 示例大学', '第二段 · 示例研究院']);
    expect(edu.sections.map((s) => s.a11y)).toEqual(['第一段', '第二段']);
    expect(item(d, 'education.0.school')?.value).toBe('示例大学');
    expect(item(d, 'education.1.school')?.value).toBe('示例研究院');
    const en = must(build(p, { language: 'en' }));
    const enEdu = en.resumes[0]!.groups.find((g) => g.id === 'education')!;
    expect(enEdu.sections[0]!.title).toBe('Entry 1 · 示例大学');
    expect(enEdu.sections[1]!.a11y).toBe('Entry 2');
  });

  it('an entry with no name is titled by its ordinal alone; education falls back to schoolEn, then the degree', () => {
    const p = profileOf([
      zhR('a', {
        education: [{ schoolEn: 'Example University' }, { degree: 'master', major: '数学' }],
        work: [{ kind: 'full_time', position: '工程师' }],
      }),
    ]);
    const d = must(build(p));
    expect(d.resumes[0]!.groups.find((g) => g.id === 'education')!.sections.map((s) => s.title)).toEqual([
      '第一段 · Example University',
      '第二段 · 硕士',
    ]);
    expect(d.resumes[0]!.groups.find((g) => g.id === 'work')!.sections[0]!.title).toBe('第一段');
  });

  it('an internship lands in internship, a full-time job in work', () => {
    const job = { kind: 'full_time', company: '示例软件公司', position: '工程师', startDate: '2025-07', endDate: null, current: true };
    const d = must(build(profileOf([withSample({ work: [...SAMPLE_RESUME_ZH.work, job] } as Partial<Resume>)])));
    const intern = d.resumes[0]!.groups.find((g) => g.id === 'internship')!;
    const work = d.resumes[0]!.groups.find((g) => g.id === 'work')!;
    expect(intern.label).toBe('实习');
    expect(intern.sections.map((s) => s.title)).toEqual(['第一段 · 示例科技有限公司']);
    expect(work.sections.map((s) => s.title)).toEqual(['第一段 · 示例软件公司']);
    expect(item(d, 'work.0.company')?.value).toBe('示例软件公司');
    expect(item(d, 'internship.0.company')?.value).toBe('示例科技有限公司');
    expect(item(d, 'work.0.endDate')?.value).toBe('至今');
  });

  it('enums use the resume language while labels use the UI language', () => {
    const d = must(build(profileOf([withSample()]), { language: 'en' }));
    expect(d.ui).toBe('en');
    expect(item(d, 'education.0.school')).toMatchObject({ label: 'School', value: '示例大学', kinds: ['school'] });
    expect(item(d, 'education.0.degree')?.value).toBe('本科');
    expect(item(d, 'basics.0.gender')?.value).toBe('男');
    expect(d.resumes[0]!.groups[0]!.label).toBe('Basics');
    expect(item(d, 'basics.0.fullName')?.label).toBe('Full name');
    const en = must(build(profileOf([SAMPLE_RESUME_EN]), { language: 'zh' }));
    expect(item(en, 'education.0.degree')).toMatchObject({ label: '学历', value: 'Bachelor' });
  });

  it('adds a period item; a current entry ends 至今 / Present', () => {
    const d = must(build(profileOf([zhR('a', { education: [{ school: '示例大学', startDate: '2022-09', endDate: '2026-06' }] })])));
    expect(item(d, 'education.0.period')).toMatchObject({ label: '起止时间', value: '2022.09-2026.06' });
    const cur = must(build(profileOf([zhR('a', { education: [{ school: '示例大学', startDate: '2022-09', current: true }] })])));
    expect(item(cur, 'education.0.period')?.value).toBe('2022.09-至今');
    expect(item(cur, 'education.0.endDate')?.value).toBe('至今');
    const en = must(build(profileOf([enR('b', { work: [{ kind: 'internship', company: 'Example Co.', startDate: '2022-09', current: true }] })]), { language: 'zh' }));
    expect(item(en, 'internship.0.period')).toMatchObject({ label: '起止时间', value: '2022-09 - Present' });
    expect(item(en, 'internship.0.endDate')?.value).toBe('Present');
    const noStart = must(build(profileOf([zhR('a', { education: [{ school: '示例大学', endDate: '2026-06' }] })])));
    expect(item(noStart, 'education.0.period')).toBeUndefined();
  });

  it('skills: all skills, then one item per skill with its level; languages and certificates get their own sections', () => {
    const d = must(
      build(
        profileOf([
          zhR('a', {
            skills: [{ name: 'Python', level: '熟练' }, { name: 'TypeScript' }],
            languages: [{ language: '英语', proficiency: 'fluent', certificate: 'CET-6', score: '600' }],
            certificates: [{ name: '示例证书', date: '2024-06' }],
          }),
        ]),
      ),
    );
    const skills = d.resumes[0]!.groups.find((g) => g.id === 'skills')!;
    expect(skills.sections.map((s) => s.title)).toEqual(['技能', '语言能力 · 英语', '证书 · 示例证书']);
    expect(skills.sections.map((s) => s.a11y)).toEqual(['技能', '语言能力 1', '证书 1']);
    expect(skills.sections[0]!.items.map((i) => [i.label, i.value])).toEqual([
      ['全部技能', 'Python、TypeScript'],
      ['技能 1', 'Python（熟练）'],
      ['技能 2', 'TypeScript'],
    ]);
    expect(skills.sections[1]!.items.map((i) => i.value)).toContain('600');
  });

  it('object modules: regions, lists and numbers are joined in the resume language; booleans are skipped', () => {
    const d = must(
      build(
        profileOf([
          zhR('a', {
            basics: { familyName: '张', givenName: '三', nativePlace: { province: '北京市', district: '海淀区' }, height: 175 },
            jobIntention: { positions: ['产品经理', '运营'], salaryMin: 8000, acceptRelocation: true, employmentType: 'full_time' },
            workRights: { requiresSponsorship: true, hasFullWorkRights: false },
          }),
          enR('b', { basics: { familyName: 'Zhang', givenName: 'San', nativePlace: { city: 'Beijing', country: 'China', district: 'Haidian' } }, jobIntention: { cities: ['Beijing', 'Shanghai'] } }),
        ]),
      ),
    );
    expect(item(d, 'basics.0.nativePlace')).toMatchObject({ value: '北京市海淀区', kinds: ['address'] });
    expect(item(d, 'basics.0.height')).toMatchObject({ value: '175', kinds: ['number'] });
    expect(item(d, 'intention.0.positions')).toMatchObject({ value: '产品经理、运营', kinds: ['position'] });
    expect(item(d, 'intention.0.salaryMin')?.value).toBe('8000');
    expect(item(d, 'intention.0.employmentType')?.value).toBe('全职');
    expect(itemsOf(d).some((i) => /acceptRelocation|requiresSponsorship|hasFullWorkRights/.test(i.id))).toBe(false);
    expect(d.resumes[0]!.groups.some((g) => g.id === 'other')).toBe(false); // work rights held only booleans
    expect(item(d, 'basics.0.nativePlace', 1)?.value).toBe('Haidian, Beijing, China');
    expect(item(d, 'intention.0.cities', 1)?.value).toBe('Beijing, Shanghai');
  });

  it('never carries an ID number, ID type, diversity answers, booleans, attachments, timestamps or real resume ids', () => {
    const r = withSample({
      basics: { ...SAMPLE_RESUME_ZH.basics, idType: 'passport', idNumber: '110101199001011234' },
      diversity: { indigenous: 'yes', disability: 'no', genderIdentity: 'yes', veteran: 'no', genderAnswer: 'from_resume' },
      attachments: { resumeFileId: 'file-abc', photoFileId: 'file-abc', transcriptFileId: 'file-abc' },
      workRights: { status: null, visaType: '', visaExpiry: null, requiresSponsorship: true, hasFullWorkRights: true },
      createdAt: 1700000000123,
      updatedAt: 1700000000456,
    } as unknown as Partial<Resume>);
    const text = JSON.stringify(must(build(profileOf([r]))));
    for (const banned of ['110101199001011234', 'idNumber', 'idType', '护照', 'passport', 'diversity', 'indigenous', 'disability', 'veteran', 'genderIdentity', 'file-abc', 'attachments', 'resumeFileId', 'requiresSponsorship', 'hasFullWorkRights', '1700000000123', '1700000000456', 'sample-zh', 'createdAt']) {
      expect(text).not.toContain(banned);
    }
  });

  it('hidden groups are removed; hiding everything gives null', () => {
    const p = profileOf([withSample()]);
    const d = must(build(p, { hidden: ['education'] }));
    expect(groupIds(d)).not.toContain('education');
    expect(groupIds(d)).toContain('basics');
    expect(build(p, { hidden: ['basics', 'education', 'internship', 'work', 'projects', 'campus', 'awards', 'skills', 'intention', 'links', 'about', 'other'] })).toBeNull();
  });

  it('a profile with only empty resumes, or none, gives null', () => {
    expect(build(profileOf([resume('a', 'zh-CN'), resume('b', 'en-AU')]))).toBeNull();
    expect(build(profileOf([]))).toBeNull();
    expect(build(emptyProfile())).toBeNull();
  });

  it('kinds: 邮箱 email, 手机 phone and number, links url, dates date', () => {
    const d = must(build(profileOf([withSample({ contact: { ...SAMPLE_RESUME_ZH.contact, linkedin: 'https://www.linkedin.com/in/example' } })])));
    expect(item(d, 'basics.0.email')).toMatchObject({ label: '邮箱', kinds: ['email'] });
    expect(item(d, 'basics.0.phone')).toMatchObject({ label: '手机号码', kinds: ['phone', 'number'] });
    expect(item(d, 'links.0.linkedin')?.kinds).toEqual(['url']);
    expect(item(d, 'basics.0.birthDate')?.kinds).toEqual(['date']);
    expect(item(d, 'education.0.startDate')).toMatchObject({ value: '2021-09', kinds: ['date'] });
  });

  it('cuts a 5000-character description to 2000 without splitting a surrogate pair', () => {
    const long = 'a'.repeat(4000) + '尾'.repeat(1000);
    const d = must(build(profileOf([zhR('a', { projects: [{ name: '示例项目', description: long }] })])));
    expect(item(d, 'projects.0.description')?.value).toHaveLength(KB_LIMITS.value);
    const emoji = 'a'.repeat(1999) + '😀' + 'b'.repeat(10);
    const e = must(build(profileOf([zhR('a', { projects: [{ name: '示例项目', description: emoji }] })])));
    expect(item(e, 'projects.0.description')?.value).toBe('a'.repeat(1999));
  });
});

describe('buildKeyboardData: resumes, default and counterpart', () => {
  const linked = () => profileOf([{ ...SAMPLE_RESUME_ZH, linkedResumeId: 'sample-en' }, SAMPLE_RESUME_EN], 'sample-zh');

  it('ids are fingerprints of the real ids, titles fall back to the default title, and each knows its language', () => {
    const d = must(build(profileOf([zhR('x1'), resume('empty', 'zh-CN'), enR('y2', { title: 'English resume' })])));
    expect(d.resumes.map((r) => [r.id, r.lang, r.title])).toEqual([
      [kid('x1'), 'zh', '我的中文简历'],
      [kid('y2'), 'en', 'English resume'],
    ]);
  });

  it('a resume keeps its id when another is deleted or the order changes', () => {
    const before = must(build(profileOf([zhR('a'), zhR('b'), zhR('c')])));
    const after = must(build(profileOf([zhR('c'), zhR('b')], 'b')));
    const idOf = (d: KeyboardData, n: number) => d.resumes[n]!.id;
    expect(idOf(after, 1)).toBe(idOf(before, 1));
    expect(idOf(after, 0)).toBe(idOf(before, 2));
    expect(after.resumes.map((r) => r.id)).not.toContain(idOf(before, 0));
  });

  it('ids are short, fit the schema, never hold the real id and stay distinct', () => {
    const real = ['3f2a9c1e-77b0-4c1d-9e22-5b8d1a0c4e6f', 'sample-zh', 'a'];
    for (const r of real) {
      expect(kid(r)).toMatch(/^r[0-9a-f]{8}$/);
      expect(kid(r)).not.toContain(r.length > 1 ? r : 'never');
    }
    expect(new Set(real.map(kid)).size).toBe(real.length);
    expect(kid('sample-zh')).toBe(kid('sample-zh'));
  });

  it('defaultResume follows resolveFillResume', () => {
    expect(must(build(linked(), { fillLanguage: 'en' })).defaultResume).toBe(kid('sample-en'));
    expect(must(build(linked(), { fillLanguage: 'active' })).defaultResume).toBe(kid('sample-zh'));
    expect(must(build(linked(), { fillLanguage: 'zh' })).defaultResume).toBe(kid('sample-zh'));
    expect(must(build(profileOf([zhR('a'), zhR('b')], 'b'), { fillLanguage: 'en' })).defaultResume).toBe(kid('b'));
  });

  it('defaultResume falls back to the first kept resume when the chosen one is empty', () => {
    expect(must(build(profileOf([zhR('a'), resume('b', 'zh-CN')], 'b'))).defaultResume).toBe(kid('a'));
  });

  it('counterparts point at each other for a linked pair', () => {
    const d = must(build(linked()));
    expect(d.resumes.map((r) => r.counterpart)).toEqual([kid('sample-en'), kid('sample-zh')]);
  });

  it('counterpartOf restates profileRepo counterpartResume', () => {
    const get = (resumes: Resume[], activeId: string) => {
      const p = profileOf(resumes, activeId);
      return counterpartOf(p, p.resumes.find((r) => r.id === activeId)!)?.id ?? null;
    };
    expect(get([zhR('a', { linkedResumeId: 'c' }), enR('b'), enR('c')], 'a')).toBe('c');
    expect(get([zhR('a'), zhR('x'), enR('b'), enR('c')], 'a')).toBe('b');
    expect(get([zhR('a', { linkedResumeId: 'gone' }), enR('b')], 'a')).toBe('b');
    expect(get([zhR('a', { linkedResumeId: 'x' }), zhR('x'), enR('b')], 'a')).toBe('b');
    expect(get([enR('b'), zhR('a'), zhR('x')], 'b')).toBe('a');
    expect(get([zhR('a'), zhR('x')], 'a')).toBeNull();
  });

  it('a counterpart that was dropped is replaced by the first kept resume in the other language', () => {
    const d = must(build(profileOf([zhR('a', { linkedResumeId: 'b' }), resume('b', 'en-AU'), enR('c')], 'a')));
    expect(d.resumes.map((r) => [r.id, r.counterpart])).toEqual([
      [kid('a'), kid('c')],
      [kid('c'), kid('a')],
    ]);
  });

  it('keeps at most 20 resumes: the default, its counterpart, then profile order', () => {
    const many = Array.from({ length: 24 }, (_, i) => zhR(`z${i}`, { title: `简历 ${i}` }));
    const en = enR('e', { title: 'English' });
    const d = must(build(profileOf([...many, en], 'z23'), { fillLanguage: 'active' }));
    expect(d.resumes).toHaveLength(KB_LIMITS.resumes);
    const titles = d.resumes.map((r) => r.title);
    expect(titles).toContain('简历 23');
    expect(titles).toContain('English');
    expect(titles.slice(0, 18)).toEqual(Array.from({ length: 18 }, (_, i) => `简历 ${i}`));
    expect(d.resumes.find((r) => r.id === d.defaultResume)!.title).toBe('简历 23');
  });

  it('cuts items beyond 600 from the end of other, about and skills first', () => {
    const skills = Array.from({ length: 700 }, (_, i) => ({ name: `技能${i}` }));
    const d = must(build(profileOf([zhR('a', { skills, contact: { email: 'a@example.com' } })])));
    expect(itemsOf(d)).toHaveLength(KB_LIMITS.itemsPerResume);
    expect(item(d, 'basics.0.email')).toBeDefined();
    expect(item(d, 'skills.0.allSkills')).toBeDefined();
  });

  it('30 long education entries per resume stay under the byte limit or drop to the default and its counterpart', () => {
    const edu = Array.from({ length: 30 }, (_, i) => ({ school: `示例大学${i}`, courses: '课'.repeat(1900) }));
    const p = profileOf(
      [zhR('a', { education: edu, linkedResumeId: 'b' }), enR('b', { education: edu }), zhR('c', { education: edu }), enR('d', { education: edu })],
      'a',
    );
    const d = must(build(p));
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(KB_LIMITS.jsonBytes);
    expect(d.resumes).toHaveLength(2);
    expect(d.resumes.map((r) => r.counterpart)).toEqual([kid('b'), kid('a')]);
    expect(d.defaultResume).toBe(kid('a'));
  });

  it('gives the same JSON for the same input (no timestamps)', () => {
    expect(JSON.stringify(build(linked()))).toBe(JSON.stringify(build({ ...linked(), resumes: linked().resumes.map((r) => ({ ...r, updatedAt: 1 })) })));
  });

  it('equals fixtures/keyboard/projection-v1.json for the fixture profile', () => {
    const d = must(build(linked(), { language: 'zh', fillLanguage: 'active', hidden: [] }));
    const text = `${JSON.stringify(d, null, 2)}\n`;
    if (process.env.RAF_UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, text);
    expect(existsSync(FIXTURE)).toBe(true);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(d);
    expect(d.resumes).toHaveLength(2);
    expect(d.resumes[0]!.groups[0]!.sections[0]!.items[0]).toMatchObject({ label: '姓名', value: '张三' });
  });
});
