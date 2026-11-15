// A company name guessed from the page title or the host.
import { describe, expect, it } from 'vitest';
import { guessCompany } from '../../../../mobile/app/src/tracker/model/guessCompany';

describe('guessCompany', () => {
  it('示例科技校园招聘 → 示例科技', () => {
    expect(guessCompany('示例科技校园招聘', 'jobs.example.com')).toBe('示例科技');
  });

  it('示例科技2027届校园招聘 - 产品经理 → 示例科技', () => {
    expect(guessCompany('示例科技2027届校园招聘 - 产品经理', 'jobs.example.com')).toBe('示例科技');
  });

  it('Careers | Example Corp → Example Corp', () => {
    expect(guessCompany('Careers | Example Corp', 'jobs.example.com')).toBe('Example Corp');
  });

  it('产品经理 - 示例银行招聘官网 → 示例银行', () => {
    expect(guessCompany('产品经理 - 示例银行招聘官网', 'jobs.example.com')).toBe('示例银行');
  });

  it('a segment that changed wins over a plain one; otherwise the shortest non-position segment', () => {
    expect(guessCompany('首页 | 示例网申', 'jobs.example.com')).toBe('示例');
    expect(guessCompany('产品经理 · 示例传媒', 'jobs.example.com')).toBe('示例传媒');
  });

  it('a title that is only a suffix falls back to the host', () => {
    expect(guessCompany('校园招聘', 'careers.example.com')).toBe('example');
    expect(guessCompany('Careers', 'www.example.com.cn')).toBe('example');
    expect(guessCompany('  ', 'hr.example.org')).toBe('example');
  });

  it('careers.example.com without a title → example', () => {
    expect(guessCompany(undefined, 'careers.example.com')).toBe('example');
    expect(guessCompany(undefined, 'campus.example.edu.cn')).toBe('example');
    expect(guessCompany(undefined, 'example.com:8080')).toBe('example');
  });

  it('applicant-tracking hosts give no name', () => {
    for (const host of ['app.mokahr.com', 'example.zhiye.com', 'jobs.feishu.cn', 'example.wd1.myworkdayjobs.com', 'boards.greenhouse.io', 'jobs.lever.co'])
      expect(guessCompany(undefined, host)).toBe('');
    expect(guessCompany('示例科技校园招聘', 'app.mokahr.com')).toBe('示例科技');
  });

  it('IP hosts give no name', () => {
    expect(guessCompany(undefined, '127.0.0.1')).toBe('');
    expect(guessCompany(undefined, '127.0.0.1:4180')).toBe('');
    expect(guessCompany(undefined, '[::1]')).toBe('');
  });

  it('results are cut to 80', () => {
    expect(guessCompany(`${'示'.repeat(100)}公司`, 'jobs.example.com').length).toBeLessThanOrEqual(80);
  });
});
