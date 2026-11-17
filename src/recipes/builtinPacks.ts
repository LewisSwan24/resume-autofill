// Built-in curated declarative SiteRecipe packs for popular CN & Global ATS portals.
import type { SiteRecipe } from '../schema';

const BUILTIN_UPDATED_AT = Date.UTC(2026, 10, 1);

export const BUILTIN_SITE_RECIPES: readonly SiteRecipe[] = [
  {
    id: 'builtin-bytedance-campus',
    name: '字节跳动校招 / 飞书招聘常用字段',
    hostPattern: '*.bytedance.com',
    pathPattern: '/*apply*',
    enabled: true,
    updatedAt: BUILTIN_UPDATED_AT,
    rules: [
      {
        id: 'bd-graduation-date',
        fingerprint: { tag: 'input', labelTokens: ['预计毕业时间', '毕业年月', 'graduation'] },
        fieldKey: 'education.endDate',
        transformPreset: 'date_ym',
      },
      {
        id: 'bd-available-date',
        fingerprint: { tag: 'input', labelTokens: ['最快到岗时间', '可到岗日期', '到岗时间'] },
        fieldKey: 'jobIntention.availableFrom',
        transformPreset: 'date_ymd',
      },
    ],
  },
  {
    id: 'builtin-nowcoder',
    name: '牛客网投递表单常见映射',
    hostPattern: '*.nowcoder.com',
    pathPattern: '/jobs/*',
    enabled: true,
    updatedAt: BUILTIN_UPDATED_AT,
    rules: [
      {
        id: 'nc-expected-city',
        fingerprint: { tag: 'input', labelTokens: ['期望工作城市', '意向城市', '城市'] },
        fieldKey: 'jobIntention.cities',
        transformPreset: 'trim',
      },
      {
        id: 'nc-referral-source',
        fingerprint: { tag: 'input', labelTokens: ['投递渠道', '了解渠道', '信息来源'] },
        fieldKey: 'jobIntention.howDidYouHear',
        transformPreset: 'trim',
      },
    ],
  },
  {
    id: 'builtin-boss-zhipin',
    name: 'Boss 直聘在线简历补充项',
    hostPattern: '*.zhipin.com',
    enabled: true,
    updatedAt: BUILTIN_UPDATED_AT,
    rules: [
      {
        id: 'boss-wechat',
        fingerprint: { tag: 'input', labelTokens: ['微信号', 'wechat'] },
        fieldKey: 'contact.wechat',
        transformPreset: 'trim',
      },
    ],
  },
  {
    id: 'builtin-ashby',
    name: 'Ashby Common Custom Prompts',
    hostPattern: '*.ashbyhq.com',
    enabled: true,
    updatedAt: BUILTIN_UPDATED_AT,
    rules: [
      {
        id: 'ashby-linkedin',
        fingerprint: { tag: 'input', labelTokens: ['linkedin', 'profile'] },
        fieldKey: 'contact.linkedin',
        transformPreset: 'trim',
      },
      {
        id: 'ashby-github',
        fingerprint: { tag: 'input', labelTokens: ['github', 'portfolio'] },
        fieldKey: 'contact.github',
        transformPreset: 'trim',
      },
    ],
  },
];
