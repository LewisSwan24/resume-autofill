// Which language a resume is written in, for the new resume's default.
import { describe, expect, it } from 'vitest';
import type { TextLine } from '../../../../src/import/extract/types';
import { parseResume } from '../../../../src/import/parse';
import { detectLanguage } from '../../../../mobile/app/src/resumeImport/language';

const linesOf = (...texts: string[]): TextLine[] => texts.map((text) => ({ text, cells: [text], page: 1, fontSize: 10 }));

const ZH = linesOf(
  '张三',
  '电话：13800138000 邮箱：zhangsan.example.long.address@example.com',
  '主页：https://zhangsan.example.com/portfolio/projects www.example.com/zhangsan-resume',
  '教育经历',
  '示例大学 2016.09 - 2020.06 计算机科学与技术 本科',
  '工作经历',
  '示例科技有限公司 2020.07 - 至今 前端工程师',
  '负责前端开发，使用 TypeScript、React、Node.js 和 Webpack 搭建系统。',
  '技能 TypeScript JavaScript React',
);

const EN = linesOf(
  'Sam Example',
  'sam@example.com | +61 400 000 000 | Sydney NSW',
  'Experience',
  'Example Pty Ltd Mar 2018 - Present Developer',
  'Builds and maintains the booking website.',
  'Education',
  'Example University 2014 - 2017 Bachelor of Science',
);

const MIXED = linesOf(
  '张三 Zhang San',
  'zhangsan@example.com | 13800138000 | 北京',
  '教育经历',
  '示例大学 2016.09 - 2020.06',
  'Bachelor of Computer Science',
  '工作经历',
  '示例科技有限公司 2020.07 - 至今',
  'Frontend Engineer',
  'Built the web front end of a booking product.',
  'Wrote tests and set up the build pipeline.',
  '技能',
  'TypeScript, React',
);

describe('detectLanguage', () => {
  it('a Chinese resume full of e-mails, URLs and tech words is zh-CN, not mixed', () => {
    expect(detectLanguage(ZH, 'en-AU')).toEqual({ locale: 'zh-CN', mixed: false });
  });

  it('an English resume is en-AU', () => {
    expect(detectLanguage(EN, 'zh-CN')).toEqual({ locale: 'en-AU', mixed: false });
  });

  it('the bilingual sample is mixed', () => {
    expect(detectLanguage(MIXED, 'zh-CN').mixed).toBe(true);
  });

  it('too little text falls back to the given locale', () => {
    // Digits, e-mail addresses and links do not count as text.
    const short = linesOf('Sam', '13800138000', 'someone.with.a.long.name@example.com', 'https://www.example.com/long/path/here');
    expect(detectLanguage(short, 'zh-CN')).toEqual({ locale: 'zh-CN', mixed: false });
    expect(detectLanguage(linesOf('张三'), 'en-AU')).toEqual({ locale: 'en-AU', mixed: false });
    expect(detectLanguage([], 'en-AU')).toEqual({ locale: 'en-AU', mixed: false });
  });

  it("agrees with parseResume's locale on the Chinese and English samples", () => {
    for (const lines of [ZH, EN]) expect(detectLanguage(lines, 'zh-CN').locale).toBe(parseResume(lines).locale);
  });
});
