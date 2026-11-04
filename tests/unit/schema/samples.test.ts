import { describe, expect, it } from 'vitest';
import { ProfileSchema, createSampleProfile } from '../../../src/schema';

describe('createSampleProfile', () => {
  const profile = createSampleProfile();
  const zh = profile.resumes.find((r) => r.id === 'sample-zh')!;
  const en = profile.resumes.find((r) => r.id === 'sample-en')!;

  it('validates against ProfileSchema and is deterministic', () => {
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(createSampleProfile()).toEqual(profile);
    expect(profile.activeResumeId).toBe('sample-zh');
    expect(profile.resumes.map((r) => r.id)).toEqual(['sample-zh', 'sample-en']);
  });

  it('returns a fresh object each call', () => {
    const a = createSampleProfile();
    a.resumes[0]!.basics.familyName = 'changed';
    expect(createSampleProfile().resumes[0]!.basics.familyName).toBe('林');
  });

  it('links the two resumes', () => {
    expect(zh.linkedResumeId).toBe('sample-en');
    expect(en.linkedResumeId).toBe('sample-zh');
    expect(zh.locale).toBe('zh-CN');
    expect(en.locale).toBe('en-AU');
  });

  it('zh sample: basics, contact, regions', () => {
    expect(zh.basics).toMatchObject({
      familyName: '林',
      givenName: '知远',
      gender: 'male',
      birthDate: '2002-03-15',
      ethnicity: '汉族',
      politicalStatus: 'league_member',
      idType: 'id_card',
      idNumber: '110101200203150019',
      maritalStatus: 'single',
    });
    expect(zh.basics.nativePlace).toEqual({ province: '浙江省', city: '杭州市' });
    expect(zh.basics.studentOrigin).toEqual({ province: '浙江省', city: '杭州市', district: '西湖区' });
    expect(zh.basics.household).toEqual({ province: '浙江省', city: '杭州市', district: '西湖区' });
    expect(zh.basics.currentLocation).toEqual({ province: '广东省', city: '深圳市', district: '南山区' });
    expect(zh.contact).toMatchObject({
      phone: '13800138000',
      phoneCountryCode: '+86',
      email: 'zhiyuan.lin@example.com',
      wechat: 'lzy_2002',
      qq: '',
    });
  });

  it('zh sample: education, work, projects', () => {
    expect(zh.education).toHaveLength(2);
    expect(zh.education[0]).toMatchObject({
      school: '浙江大学', degree: 'bachelor', educationType: 'full_time', major: '计算机科学与技术',
      startDate: '2020-09', endDate: '2024-06', current: false, gpa: '3.8', gpaScale: '4.0', ranking: '5/120',
    });
    expect(zh.education[1]).toMatchObject({
      school: '昆士兰大学', schoolEn: 'The University of Queensland', degree: 'master', major: '计算机科学',
      startDate: '2024-07', endDate: '2026-06',
    });
    expect(zh.work).toHaveLength(2);
    expect(zh.work[0]).toMatchObject({
      kind: 'internship', company: '腾讯', position: '后端开发实习生', city: '深圳',
      startDate: '2023-06', endDate: '2023-09', current: false,
    });
    expect(zh.work[1]).toMatchObject({
      kind: 'internship', company: '字节跳动', position: '数据分析实习生',
      startDate: '2025-11', endDate: null, current: true,
    });
    expect(zh.projects.map((p) => p.name)).toEqual(['校园二手交易平台', '简历自动填写工具']);
    expect(zh.projects[0]).toMatchObject({ role: '负责人', startDate: '2022-03', endDate: '2022-06' });
    expect(zh.projects[0]!.description.length).toBeGreaterThan(10);
    expect(zh.projects[1]).toMatchObject({ role: '开发者', startDate: '2025-03', endDate: '2025-08' });
  });

  it('zh sample: awards, languages, certificates, skills, family, emergency, intention, attachments', () => {
    expect(zh.awards).toEqual([expect.objectContaining({ name: '国家奖学金', date: '2022-10', level: 'national' })]);
    expect(zh.languages).toEqual([
      expect.objectContaining({ language: '英语', proficiency: 'fluent', certificate: 'CET-6', score: '580' }),
    ]);
    expect(zh.certificates).toEqual([expect.objectContaining({ name: '全国计算机等级考试二级', date: '2021-09' })]);
    expect(zh.skills.map((s) => s.name)).toEqual(['Python', 'TypeScript', 'SQL']);
    expect(zh.family).toHaveLength(2);
    expect(zh.family[0]).toMatchObject({
      name: '林建国', relationship: 'father', employer: '浙江某机械有限公司', position: '工程师',
      phone: '13900139000', politicalStatus: 'masses',
    });
    expect(zh.family[1]).toMatchObject({
      name: '王丽', relationship: 'mother', employer: '杭州市某小学', position: '教师',
    });
    expect(zh.emergencyContact).toMatchObject({ name: '王丽', relationship: 'mother', phone: '13700137000' });
    expect(zh.jobIntention).toMatchObject({
      positions: ['后端开发工程师'], cities: ['深圳', '杭州'], employmentType: 'full_time',
      acceptAdjustment: true, acceptRelocation: true, availableFrom: '2026-07',
    });
    expect(zh.selfIntroduction).toMatch(/[\u4e00-\u9fff]/);
    expect(zh.attachments).toEqual({ resumeFileId: 'sample-resume-zh', photoFileId: 'sample-photo' });
  });

  it('en sample: basics, contact, work rights', () => {
    expect(en.basics).toMatchObject({ givenName: 'Zhiyuan', familyName: 'Lin', preferredName: 'Leo', pronouns: 'he/him' });
    expect(en.contact).toMatchObject({
      phone: '0412345678', phoneCountryCode: '+61', email: 'zhiyuan.lin@example.com',
      linkedin: 'https://www.linkedin.com/in/zhiyuan-lin-example',
      github: 'https://github.com/zhiyuan-lin-example',
    });
    expect(en.contact.address).toMatchObject({ street: '1 Example St', province: 'QLD', city: 'Brisbane', postcode: '4000' });
    expect(en.workRights).toMatchObject({
      status: 'graduate_visa', visaType: 'Subclass 485', visaExpiry: '2028-08-31',
      requiresSponsorship: false, hasFullWorkRights: true,
    });
  });

  it('en sample: education/work ordered most recent first, referees, intention', () => {
    expect(en.education.map((e) => e.school)).toEqual(['The University of Queensland', 'Zhejiang University']);
    expect(en.education[0]).toMatchObject({
      degree: 'master', major: 'Master of Computer Science', startDate: '2024-07', endDate: '2026-06',
    });
    expect(en.education[1]).toMatchObject({
      degree: 'bachelor', major: 'Computer Science and Technology', startDate: '2020-09', endDate: '2024-06',
    });
    expect(en.work).toHaveLength(2);
    expect(en.work[0]).toMatchObject({
      position: 'Data Analyst Intern', company: 'ByteDance', startDate: '2025-11', endDate: null, current: true,
    });
    expect(en.work[1]).toMatchObject({
      position: 'Backend Developer Intern', company: 'Tencent', city: 'Shenzhen', startDate: '2023-06', endDate: '2023-09',
    });
    expect(en.referees).toHaveLength(2);
    for (const ref of en.referees) {
      expect(ref.name).not.toBe('');
      expect(ref.email).toMatch(/@example\.com$/);
    }
    expect(en.jobIntention).toMatchObject({
      cities: ['Brisbane'], positions: ['Graduate Software Engineer'], employmentType: 'graduate_program',
      availableFrom: '2026-07', noticePeriod: '2 weeks', howDidYouHear: 'LinkedIn',
    });
    expect(en.diversity).toEqual({
      indigenous: 'prefer_not_to_say', disability: 'prefer_not_to_say',
      genderIdentity: 'prefer_not_to_say', veteran: 'prefer_not_to_say',
      genderAnswer: 'prefer_not_to_say',
    });
    expect(en.selfIntroduction).toMatch(/[A-Za-z]/);
    expect(en.attachments).toEqual({ resumeFileId: 'sample-resume-en' });
  });
});

