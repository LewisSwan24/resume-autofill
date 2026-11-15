// KeyboardData v1: the slim projection the resume keyboard reads. The schema's rejection
// cases are the same as the Java KeyboardDataTest, so the TS writer and the Java reader agree.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KB_LIMITS,
  KEYBOARD_DATA_VERSION,
  KEYBOARD_GROUP_IDS,
  KEYBOARD_KINDS,
  KeyboardDataSchema,
  type KeyboardData,
} from '../../../../mobile/app/src/keyboard/keyboardData';

const FIXTURE = resolve(__dirname, '../fixtures/keyboard/projection-v1.json');

/** A minimal valid document: one resume, one group, one section, one item. */
function minimal(): KeyboardData {
  return {
    v: 1,
    ui: 'zh',
    defaultResume: 'r0',
    resumes: [
      {
        id: 'r0',
        title: '中文简历',
        lang: 'zh',
        counterpart: null,
        groups: [{ id: 'basics', label: '基本信息', sections: [{ title: null, a11y: null, items: [{ id: 'basics.0.fullName', label: '姓名', value: '张三', kinds: ['name'] }] }] }],
      },
    ],
  };
}

type Mutable = { v: unknown; ui: unknown; defaultResume: unknown; resumes: any[]; [k: string]: unknown };
const mutate = (fn: (d: Mutable) => void): unknown => {
  const d = minimal() as unknown as Mutable;
  fn(d);
  return d;
};
const resumeAt = (i: number) => ({ ...minimal().resumes[0]!, id: `r${i}` });

describe('KeyboardData v1 constants', () => {
  it('fixes the version, group ids, kinds and limits', () => {
    expect(KEYBOARD_DATA_VERSION).toBe(1);
    expect(KEYBOARD_GROUP_IDS).toEqual([
      'basics', 'education', 'internship', 'work', 'projects', 'campus', 'awards', 'skills', 'intention', 'links', 'about', 'other',
    ]);
    expect(KEYBOARD_KINDS).toEqual([
      'email', 'phone', 'url', 'number', 'date', 'name', 'address', 'postcode', 'school', 'major', 'company', 'position', 'wechat', 'qq',
    ]);
    expect(KB_LIMITS).toEqual({ resumes: 20, itemsPerResume: 600, value: 2000, label: 60, sectionTitle: 60, resumeTitle: 40, jsonBytes: 480 * 1024 });
  });
});

describe('KeyboardDataSchema', () => {
  it('accepts a minimal valid document', () => {
    expect(KeyboardDataSchema.safeParse(minimal()).success).toBe(true);
  });

  it('accepts two linked resumes with repeated sections and multi-line values', () => {
    const d = minimal();
    d.resumes[0]!.counterpart = 'r1';
    d.resumes[0]!.groups.push({
      id: 'education',
      label: '教育',
      sections: [{ title: '第一段 · 示例大学', a11y: '第一段', items: [{ id: 'education.0.school', label: '学校', value: '示例大学', kinds: ['school'] }] }],
    });
    d.resumes.push({ ...resumeAt(1), title: 'English resume', lang: 'en', counterpart: 'r0' });
    d.resumes[1]!.groups = [{ id: 'about', label: 'About me', sections: [{ title: null, a11y: null, items: [{ id: 'about.0.selfIntroduction', label: 'Self', value: 'Line one\nLine two', kinds: [] }] }] }];
    expect(KeyboardDataSchema.safeParse(d).success).toBe(true);
  });

  it('accepts the committed fixture written by the projection builder', () => {
    expect(existsSync(FIXTURE)).toBe(true);
    const parsed = KeyboardDataSchema.safeParse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    expect(parsed.success).toBe(true);
  });

  const rejected: [string, () => unknown][] = [
    ['v: 2', () => mutate((d) => (d.v = 2))],
    ['ui: "fr"', () => mutate((d) => (d.ui = 'fr'))],
    ['0 resumes', () => mutate((d) => (d.resumes = []))],
    ['21 resumes', () => mutate((d) => (d.resumes = Array.from({ length: 21 }, (_, i) => resumeAt(i))))],
    ['a defaultResume that names nobody', () => mutate((d) => (d.defaultResume = 'r9'))],
    ['a counterpart that names nobody', () => mutate((d) => (d.resumes[0].counterpart = 'r9'))],
    ['an unknown group id', () => mutate((d) => (d.resumes[0].groups[0].id = 'diversity'))],
    ['an empty section', () => mutate((d) => (d.resumes[0].groups[0].sections[0].items = []))],
    ['an empty value', () => mutate((d) => (d.resumes[0].groups[0].sections[0].items[0].value = ''))],
    ['a label over 60', () => mutate((d) => (d.resumes[0].groups[0].sections[0].items[0].label = 'x'.repeat(61)))],
    [
      'duplicate item ids',
      () => mutate((d) => d.resumes[0].groups[0].sections[0].items.push({ ...d.resumes[0].groups[0].sections[0].items[0], label: '姓名二' })),
    ],
    ['an unknown top-level key', () => mutate((d) => (d.extra = true))],
    ['an unknown nested key', () => mutate((d) => (d.resumes[0].groups[0].sections[0].items[0].updatedAt = 1))],
    ['a value over 2000', () => mutate((d) => (d.resumes[0].groups[0].sections[0].items[0].value = 'x'.repeat(2001)))],
    ['a resume title over 40', () => mutate((d) => (d.resumes[0].title = 'x'.repeat(41)))],
    ['a section title over 60', () => mutate((d) => (d.resumes[0].groups[0].sections[0].title = 'x'.repeat(61)))],
    ['more than 4 kinds', () => mutate((d) => (d.resumes[0].groups[0].sections[0].items[0].kinds = ['name', 'email', 'phone', 'url', 'qq']))],
    ['a resume with no groups', () => mutate((d) => (d.resumes[0].groups = []))],
    ['a non-positional resume id', () => mutate((d) => ((d.resumes[0].id = 'resume-abc'), (d.defaultResume = 'resume-abc')))],
  ];
  it.each(rejected)('rejects %s', (_name, make) => {
    expect(KeyboardDataSchema.safeParse(make()).success).toBe(false);
  });

  it('rejects more than 600 items in one resume', () => {
    const d = minimal();
    d.resumes[0]!.groups[0]!.sections[0]!.items = Array.from({ length: 601 }, (_, i) => ({ id: `basics.0.f${i}`, label: 'L', value: 'v', kinds: [] }));
    expect(KeyboardDataSchema.safeParse(d).success).toBe(false);
    d.resumes[0]!.groups[0]!.sections[0]!.items.pop();
    expect(KeyboardDataSchema.safeParse(d).success).toBe(true);
  });
});
