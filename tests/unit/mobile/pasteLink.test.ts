// Home's paste box: a pasted link (or share text holding one) becomes a checked http(s) URL, its host and a title.
import { describe, expect, it } from 'vitest';
import { parseApplicationLink, parseApplicationLinks, type ParsedLink } from '../../../mobile/app/src/home/pasteLink';
import { RecentPageSchema } from '../../../mobile/app/src/store/appStateStore';

const ok = (r: ParsedLink) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r;
};
const code = (input: string) => {
  const r = parseApplicationLink(input);
  return r.ok ? 'ok' : r.code;
};

describe('parseApplicationLink', () => {
  it('accepts an https link and names its host', () => {
    const r = ok(parseApplicationLink('https://jobs.example.com/apply/123'));
    expect(r.url).toBe('https://jobs.example.com/apply/123');
    expect(r.host).toBe('jobs.example.com');
    expect(r.insecure).toBe(false);
    expect(r.title).toBeUndefined();
  });

  it('drops www. from the host only, and marks http as insecure', () => {
    const r = ok(parseApplicationLink('  http://www.example.com/jobs  '));
    expect(r.host).toBe('example.com');
    expect(r.url).toBe('http://www.example.com/jobs');
    expect(r.insecure).toBe(true);
  });

  it('takes the link and a title out of share text', () => {
    const r = ok(parseApplicationLink('【示例科技】2026 校招后端开发 https://jobs.example.com/a?b=1。'));
    expect(r.url).toBe('https://jobs.example.com/a?b=1');
    expect(r.title).toBe('示例科技 2026 校招后端开发');
  });

  it('cuts trailing separators from the title and keeps it to 80 code points', () => {
    expect(ok(parseApplicationLink('示例岗位 - https://example.com/x')).title).toBe('示例岗位');
    expect(ok(parseApplicationLink('网申入口：https://example.com/x')).title).toBe('网申入口');
    const long = ok(parseApplicationLink(`${'岗'.repeat(100)} https://example.com/x`)).title!;
    expect([...long]).toHaveLength(80);
  });

  it('adds https:// to a bare domain', () => {
    const r = ok(parseApplicationLink('jobs.example.com/apply'));
    expect(r.url).toBe('https://jobs.example.com/apply');
    expect(r.insecure).toBe(false);
  });

  it('refuses other schemes', () => {
    for (const input of ['javascript:alert(1)', 'file:///sdcard/x', 'intent://x#Intent;end', 'weixin://dl', 'data:text/html,hi']) {
      expect(code(input)).toBe('unsupported_scheme');
    }
  });

  it('says why other input fails', () => {
    expect(code('')).toBe('empty');
    expect(code('   ')).toBe('empty');
    expect(code('投递链接在群里')).toBe('no_link');
    expect(code('https://localhost/x')).toBe('invalid');
    expect(code('https://')).toBe('invalid');
    expect(code(`https://example.com/${'a'.repeat(3000)}`)).toBe('too_long');
    expect(code('x'.repeat(5000))).toBe('too_long');
  });

  it('removes credentials from the URL', () => {
    const r = ok(parseApplicationLink('https://user:pw@jobs.example.com/'));
    expect(r.url).not.toContain('user');
    expect(r.url).not.toContain('pw');
    expect(r.host).toBe('jobs.example.com');
  });

  it('shows an internationalised host in punycode', () => {
    expect(ok(parseApplicationLink('https://例子.example.com/')).host.startsWith('xn--')).toBe(true);
  });

  it('strips trailing ) and , and keeps the #fragment', () => {
    expect(ok(parseApplicationLink('(see https://example.com/apply),')).url).toBe('https://example.com/apply');
    expect(ok(parseApplicationLink('https://example.com/app#/job/7')).url).toBe('https://example.com/app#/job/7');
  });

  it('a long share title with emoji still fits the stored title limit (80 UTF-16 units), not cut mid-emoji', () => {
    const lead = `🔥【示例科技】${'招聘'.repeat(40)}🚀 结尾`;
    const parsed = ok(parseApplicationLink(`${lead} https://jobs.example.com/apply/1`));
    expect(parsed.title!.length).toBeLessThanOrEqual(80);
    expect(parsed.title!.startsWith('🔥')).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(parsed.title!)).toBe(false);
    expect(() =>
      RecentPageSchema.parse({ id: 'a', url: parsed.url, host: parsed.host, title: parsed.title, addedAt: 1 }),
    ).not.toThrow();
  });
});

describe('parseApplicationLinks', () => {
  const urls = (text: string, max?: number) => parseApplicationLinks(text, max).map((l) => l.url);

  it('parseApplicationLinks finds 0, 1 and many links', () => {
    expect(parseApplicationLinks('明天下午面试')).toEqual([]);
    expect(parseApplicationLinks('')).toEqual([]);
    const one = parseApplicationLinks('【示例科技校园招聘】网申入口 https://jobs.example.com/campus');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ ok: true, url: 'https://jobs.example.com/campus', host: 'jobs.example.com', insecure: false });
    expect(urls('先看 https://a.example.com/1 再看 http://b.example.com/2\n还有 https://c.example.com')).toEqual([
      'https://a.example.com/1',
      'http://b.example.com/2',
      'https://c.example.com/',
    ]);
    expect(parseApplicationLinks('看 http://b.example.com/2')[0]!.insecure).toBe(true);
  });

  it('duplicates by fragment are dropped; at most 20', () => {
    expect(urls('https://a.example.com/x#one https://a.example.com/x#two https://a.example.com/y')).toEqual([
      'https://a.example.com/x#one',
      'https://a.example.com/y',
    ]);
    const many = Array.from({ length: 25 }, (_, i) => `https://jobs.example.com/${i}`).join(' ');
    expect(urls(many)).toHaveLength(20);
    expect(urls(many, 3)).toEqual(['https://jobs.example.com/0', 'https://jobs.example.com/1', 'https://jobs.example.com/2']);
  });

  it('each link takes the text before it on its line as title', () => {
    const links = parseApplicationLinks('示例科技校园招聘：https://a.example.com 示例银行 - https://b.example.com\nhttps://c.example.com');
    expect(links.map((l) => l.title)).toEqual(['示例科技校园招聘', '示例银行', undefined]);
  });

  it('javascript:, file:, content: and intent: are not links', () => {
    expect(parseApplicationLinks('javascript:alert(1) file:///sdcard/a.html content://x/y intent://scan#Intent;end')).toEqual([]);
    expect(urls('javascript:alert(1) 然后 https://jobs.example.com')).toEqual(['https://jobs.example.com/']);
  });

  it('full-width punctuation ends a link', () => {
    expect(urls('入口https://a.example.com/x，备用https://b.example.com/y。')).toEqual([
      'https://a.example.com/x',
      'https://b.example.com/y',
    ]);
    expect(urls('（https://a.example.com/x）')).toEqual(['https://a.example.com/x']);
  });
});
