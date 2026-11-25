// Fictional sample resumes (same person, zh-CN + en-AU). Fixture tests derive expected values from these.
import { CURRENT_SCHEMA_VERSION, ResumeSchema, type Profile, type Resume, type ResumeInput } from './resume';

const SAMPLE_TIME = Date.UTC(2026, 0, 1);
const stamps = { createdAt: SAMPLE_TIME, updatedAt: SAMPLE_TIME };

const zhInput: ResumeInput = {
  id: 'sample-zh',
  title: '林知远（中文简历）',
  locale: 'zh-CN',
  linkedResumeId: 'sample-en',
  ...stamps,
  basics: {
    familyName: '林',
    givenName: '知远',
    gender: 'male',
    birthDate: '2002-03-15',
    ethnicity: '汉族',
    politicalStatus: 'league_member',
    idType: 'id_card',
    idNumber: '110101200203150019',
    maritalStatus: 'single',
    nativePlace: { province: '浙江省', city: '杭州市' },
    studentOrigin: { province: '浙江省', city: '杭州市', district: '西湖区' },
    household: { province: '浙江省', city: '杭州市', district: '西湖区' },
    currentLocation: { province: '广东省', city: '深圳市', district: '南山区' },
  },
  contact: {
    phoneCountryCode: '+86',
    phone: '13800138000',
    email: 'zhiyuan.lin@example.com',
    wechat: 'lzy_2002',
    qq: '',
  },
  jobIntention: {
    positions: ['后端开发工程师'],
    cities: ['深圳', '杭州'],
    employmentType: 'full_time',
    acceptAdjustment: true,
    acceptRelocation: true,
    availableFrom: '2026-07',
  },
  questions: {
    canTravel: true,
    shiftWork: false,
    overtime: true,
    earlyInternship: true,
    internshipDaysPerWeek: 5,
    internshipMonths: 6,
    offerCount: 1,
    offerSalaryRange: '15-20k',
    relativesAtCompany: false,
    workedHereBefore: false,
    campusAmbassador: false,
    graduateStatus: 'fresh_graduate',
    furtherStudyPlan: false,
    driversLicence: true,
    englishWorkingLanguage: true,
    yearsExperience: 0,
  },
  education: [
    {
      school: '浙江大学', degree: 'bachelor', educationType: 'full_time', major: '计算机科学与技术',
      startDate: '2020-09', endDate: '2024-06', current: false, gpa: '3.8', gpaScale: '4.0', ranking: '5/120',
    },
    {
      school: '澳大利亚国立大学', schoolEn: 'The Australian National University', degree: 'master', major: '计算机科学',
      startDate: '2024-07', endDate: '2026-06', current: false,
    },
  ],
  work: [
    {
      kind: 'internship', company: '腾讯', position: '后端开发实习生', city: '深圳',
      startDate: '2023-06', endDate: '2023-09', current: false,
      description: '参与内部服务的接口开发与性能优化，编写单元测试并跟进线上问题。',
    },
    {
      kind: 'internship', company: '字节跳动', position: '数据分析实习生',
      startDate: '2025-11', endDate: null, current: true,
      description: '负责业务指标的数据清洗与分析，搭建日常监控看板。',
    },
  ],
  projects: [
    {
      name: '校园二手交易平台', role: '负责人', startDate: '2022-03', endDate: '2022-06',
      description: '带领四人小组完成校园二手物品交易平台，负责后端接口设计与数据库建模，上线后覆盖三千余名学生。',
    },
    {
      name: '简历自动填写工具', role: '开发者', startDate: '2025-03', endDate: '2025-08',
      description: '开发浏览器扩展，在各类网申表单中一键填写个人简历，并逐项校验填写结果。',
    },
  ],
  awards: [{ name: '国家奖学金', date: '2022-10', level: 'national' }],
  languages: [{ language: '英语', proficiency: 'fluent', certificate: 'CET-6', score: '580', tests: [{ test: 'cet6', score: '580' }] }],
  certificates: [{ name: '全国计算机等级考试二级', date: '2021-09' }],
  skills: [{ name: 'Python' }, { name: 'TypeScript' }, { name: 'SQL' }],
  family: [
    {
      name: '林建国', relationship: 'father', employer: '浙江某机械有限公司', position: '工程师',
      phone: '13900139000', politicalStatus: 'masses',
    },
    { name: '王丽', relationship: 'mother', employer: '杭州市某小学', position: '教师' },
  ],
  emergencyContact: { name: '王丽', relationship: 'mother', phone: '13700137000' },
  selfIntroduction:
    '我是一名计算机专业的研究生，热爱后端开发与数据分析，有多段互联网大厂实习经历。' +
    '具备扎实的工程实践能力和良好的团队协作精神，乐于学习新技术并快速落地。',
  attachments: { resumeFileId: 'sample-resume-zh', photoFileId: 'sample-photo' },
};

const enInput: ResumeInput = {
  id: 'sample-en',
  title: 'Zhiyuan (Leo) Lin (English resume)',
  locale: 'en-AU',
  linkedResumeId: 'sample-zh',
  ...stamps,
  basics: {
    givenName: 'Zhiyuan',
    familyName: 'Lin',
    preferredName: 'Leo',
    pronouns: 'he/him',
    gender: 'male',
    birthDate: '2002-03-15',
  },
  contact: {
    phoneCountryCode: '+61',
    phone: '0412345678',
    email: 'zhiyuan.lin@example.com',
    address: {
      country: 'Australia', province: 'ACT', city: 'Canberra', district: 'Canberra City',
      street: '1 Example St', postcode: '2600',
    },
    linkedin: 'https://www.linkedin.com/in/zhiyuan-lin-example',
    github: 'https://github.com/zhiyuan-lin-example',
  },
  workRights: {
    status: 'graduate_visa',
    visaType: 'Subclass 485',
    visaExpiry: '2028-08-31',
    requiresSponsorship: false,
    hasFullWorkRights: true,
  },
  jobIntention: {
    positions: ['Graduate Software Engineer'],
    cities: ['Canberra'],
    employmentType: 'graduate_program',
    availableFrom: '2026-07',
    noticePeriod: '2 weeks',
    howDidYouHear: 'LinkedIn',
  },
  questions: {
    canTravel: true,
    shiftWork: false,
    overtime: true,
    canWorkOnsite: true,
    workArrangement: 'hybrid',
    offerCount: 0,
    relativesAtCompany: false,
    workedHereBefore: false,
    graduateStatus: 'fresh_graduate',
    securityClearance: 'none',
    driversLicence: true,
    englishWorkingLanguage: true,
    yearsExperience: 1,
    yearsLeading: 0,
  },
  education: [
    {
      school: 'The Australian National University', degree: 'master', major: 'Master of Computer Science',
      startDate: '2024-07', endDate: '2026-06',
    },
    {
      school: 'Zhejiang University', degree: 'bachelor', major: 'Computer Science and Technology',
      startDate: '2020-09', endDate: '2024-06',
    },
  ],
  work: [
    {
      kind: 'internship', company: 'ByteDance', position: 'Data Analyst Intern',
      startDate: '2025-11', endDate: null, current: true,
      description: 'Cleaned and analysed business metrics and built daily monitoring dashboards.',
    },
    {
      kind: 'internship', company: 'Tencent', position: 'Backend Developer Intern', city: 'Shenzhen',
      startDate: '2023-06', endDate: '2023-09', current: false,
      description: 'Developed internal service APIs, tuned performance and wrote unit tests.',
    },
  ],
  referees: [
    {
      name: 'Dr Emily Carter', title: 'Senior Lecturer', company: 'The Australian National University',
      email: 'emily.carter@example.com', phone: '+61 7 5550 0101', relationship: 'Academic supervisor',
    },
    {
      name: 'Michael Brown', title: 'Engineering Manager', company: 'ByteDance',
      email: 'michael.brown@example.com', phone: '+61 7 5550 0102', relationship: 'Internship manager',
    },
  ],
  selfIntroduction:
    'I am a Master of Computer Science student with internship experience in backend development and data analysis. ' +
    'I enjoy turning messy problems into reliable software and I am looking for a graduate software engineering role in Canberra.',
  attachments: { resumeFileId: 'sample-resume-en' },
};

/** Fresh, validated sample profile on every call (safe to mutate). Active resume: `sample-zh`. */
export function createSampleProfile(): Profile {
  const resumes: Resume[] = [ResumeSchema.parse(zhInput), ResumeSchema.parse(enInput)];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    resumes,
    activeResumeId: 'sample-zh',
    settings: { uiLanguage: 'auto', previewBeforeFill: false, sensitiveFields: 'remind' },
  };
}
