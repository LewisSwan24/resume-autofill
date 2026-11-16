// The made-up resumes of the built-in demo form. Every value is a neutral placeholder (张三, 示例大学,
// 北京, example.com); nothing here belongs to a real person. pickResume (fillPlan.ts) hands them out only on
// DEMO_ORIGIN. No attachments: the sample cannot upload, so those rows report "not in your resume".
import { ResumeSchema, type Resume } from '../../../../../src/schema/resume';
import type { FillLanguage } from '../../store/appStateStore';

export const SAMPLE_RESUME_ZH: Resume = ResumeSchema.parse({
  id: 'sample-zh',
  title: '示例简历',
  locale: 'zh-CN',
  createdAt: 0,
  updatedAt: 0,
  basics: {
    familyName: '张',
    givenName: '三',
    englishName: 'Zhang San',
    gender: 'male',
    birthDate: '2003-05-01',
    politicalStatus: 'league_member',
    currentLocation: { country: '中国', city: '北京' },
  },
  contact: {
    email: 'zhangsan@example.com',
    phoneCountryCode: '+86',
    phone: '13800000000',
    address: { country: '中国', city: '北京' },
  },
  jobIntention: { positions: ['软件开发工程师'], cities: ['北京'], availableFrom: '2025-07-01' },
  education: [
    {
      school: '示例大学',
      schoolEn: 'Example University',
      city: '北京',
      degree: 'bachelor',
      major: '计算机科学与技术',
      startDate: '2021-09',
      endDate: '2025-06',
    },
  ],
  work: [
    {
      kind: 'internship',
      company: '示例科技有限公司',
      position: '软件开发实习生',
      city: '北京',
      startDate: '2024-07',
      endDate: '2024-09',
      description: '参与内部工具的前端开发和测试。',
    },
  ],
  skills: [{ name: 'Python' }, { name: 'TypeScript' }],
  emergencyContact: { name: '李四', relationship: 'other', phone: '13900000000' },
  selfIntroduction: '做事认真，喜欢动手解决问题。（这是演示用的虚构简历）',
});

export const SAMPLE_RESUME_EN: Resume = ResumeSchema.parse({
  id: 'sample-en',
  title: 'Sample resume',
  locale: 'en-AU',
  createdAt: 0,
  updatedAt: 0,
  basics: {
    familyName: 'Zhang',
    givenName: 'San',
    englishName: 'Zhang San',
    gender: 'male',
    birthDate: '2003-05-01',
    currentLocation: { country: 'China', city: 'Beijing' },
  },
  contact: {
    email: 'zhangsan@example.com',
    phoneCountryCode: '+86',
    phone: '13800000000',
    address: { country: 'China', city: 'Beijing' },
  },
  jobIntention: { positions: ['Software Engineer'], cities: ['Beijing'], availableFrom: '2025-07-01' },
  education: [
    {
      school: 'Example University',
      city: 'Beijing',
      degree: 'bachelor',
      major: 'Computer Science',
      startDate: '2021-09',
      endDate: '2025-06',
    },
  ],
  work: [
    {
      kind: 'internship',
      company: 'Example Tech Co.',
      position: 'Software Intern',
      city: 'Beijing',
      startDate: '2024-07',
      endDate: '2024-09',
      description: 'Built and tested internal front-end tools.',
    },
  ],
  skills: [{ name: 'Python' }, { name: 'TypeScript' }],
  emergencyContact: { name: 'Li Si', relationship: 'other', phone: '13900000000' },
  selfIntroduction: 'Careful and hands-on. (A made-up resume for the demo.)',
});

/** The sample in the fill language: English only when English is asked for. */
export function sampleFor(language: FillLanguage): Resume {
  return language === 'en' ? SAMPLE_RESUME_EN : SAMPLE_RESUME_ZH;
}
