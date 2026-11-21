// English tests a resume lists, read into the test-score list of one English entry for the applicant to check.
import { describe, expect, it } from 'vitest';
import { draftToResume } from '../../../src/import/draft';
import type { TextLine } from '../../../src/import/extract/types';
import { parseResume, type Draft } from '../../../src/import/parse';

const line = (text: string): TextLine => ({ text, cells: [text], page: 1, fontSize: 0 });
const languageFields = (d: Draft) => d.fields.filter((f) => f.path.startsWith('languages.'));
const value = (d: Draft, p: string): string | undefined => d.fields.find((f) => f.path === p)?.value;

const zhResume = (...skills: string[]) =>
  parseResume([line('示例同学'), line('手机：13800000000'), line('邮箱：sample@example.com'), line('技能证书'), ...skills.map(line)]);

describe('reading English tests from a resume', () => {
  it('reads each test with its score into one English entry, every one to be checked', () => {
    const d = zhResume('英语六级 520 分', 'CET4：560', '雅思 7.0');
    expect(value(d, 'languages.0.language')).toBe('英语');
    expect(value(d, 'languages.0.tests.0.test')).toBe('cet6');
    expect(value(d, 'languages.0.tests.0.score')).toBe('520');
    expect(value(d, 'languages.0.tests.1.test')).toBe('cet4');
    expect(value(d, 'languages.0.tests.1.score')).toBe('560');
    expect(value(d, 'languages.0.tests.2.test')).toBe('ielts');
    expect(value(d, 'languages.0.tests.2.score')).toBe('7.0');
    for (const f of languageFields(d)) expect(f.certainty, f.path).toBe('check');
  });

  it('keeps two tests on one line apart, each with its own score', () => {
    const d = zhResume('英语：CET-4 580，CET-6 530');
    expect(value(d, 'languages.0.tests.0.score')).toBe('580');
    expect(value(d, 'languages.0.tests.1.score')).toBe('530');
  });

  it('takes no year or out-of-range number for a score', () => {
    const d = zhResume('2023年06月 通过大学英语六级', '托福 2022');
    expect(value(d, 'languages.0.tests.0.test')).toBe('cet6');
    expect(value(d, 'languages.0.tests.0.score')).toBeUndefined();
    expect(value(d, 'languages.0.tests.1.test')).toBe('toefl');
    expect(value(d, 'languages.0.tests.1.score')).toBeUndefined();
  });

  it('reads nothing from the work a resume describes', () => {
    const d = parseResume([
      line('示例同学'), line('邮箱：sample@example.com'), line('实习经历'),
      line('示例教育科技有限公司 2024.07-2024.09'), line('负责英语六级备考课程 120 节的教研'),
    ]);
    expect(languageFields(d)).toEqual([]);
  });

  it('turns the checked tests into the list of the English entry', () => {
    const resume = draftToResume(zhResume('英语六级 520 分', 'CET4：560'), { id: 'r', title: 'r' });
    expect(resume.languages).toHaveLength(1);
    expect(resume.languages[0]).toMatchObject({
      language: '英语',
      tests: [{ test: 'cet6', score: '520', date: '' }, { test: 'cet4', score: '560', date: '' }],
    });
  });
});
