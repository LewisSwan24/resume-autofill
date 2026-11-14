import { describe, expect, it } from 'vitest';
import { ownSite, siteHost } from '../../../../mobile/app/src/browser/model/frameSites';

describe('ownSite', () => {
  const page = 'https://jobs.example.com';

  it('is the page host itself, with or without www and on any port', () => {
    expect(ownSite(page, 'https://jobs.example.com')).toBe(true);
    expect(ownSite('https://www.example.com', 'https://example.com:8443')).toBe(true);
    expect(ownSite('https://example.com', 'https://www.example.com')).toBe(true);
  });

  it('includes subdomains of the page host, which the page host controls', () => {
    expect(ownSite(page, 'https://forms.jobs.example.com')).toBe(true);
    expect(ownSite(page, 'https://a.b.jobs.example.com')).toBe(true);
  });

  it('leaves out parents and siblings: their shared suffix may be public (com.cn, github.io, a cloud bucket)', () => {
    expect(ownSite(page, 'https://example.com')).toBe(false);
    expect(ownSite(page, 'https://apply.example.com')).toBe(false);
    expect(ownSite('https://a.github.io', 'https://b.github.io')).toBe(false);
    expect(ownSite('https://jobs.example.com.cn', 'https://other.com.cn')).toBe(false);
    expect(ownSite('https://x.oss-cn-beijing.aliyuncs.com', 'https://y.oss-cn-beijing.aliyuncs.com')).toBe(false);
  });

  it('does not match on a bare suffix of the name', () => {
    expect(ownSite(page, 'https://evil-jobs.example.com')).toBe(false);
    expect(ownSite(page, 'https://jobs.example.com.evil.net')).toBe(false);
  });

  it('is false for an IP or host that differs, and for anything that is not a web origin', () => {
    expect(ownSite('https://10.0.2.2:8443', 'https://10.0.2.2')).toBe(true);
    expect(ownSite('https://10.0.2.2', 'https://2.2')).toBe(false);
    expect(ownSite(page, 'null')).toBe(false);
    expect(ownSite('null', page)).toBe(false);
    expect(ownSite(page, 'file:///x')).toBe(false);
    expect(ownSite(page, 'not a url')).toBe(false);
  });

  it('siteHost is the host to show: lower case, no www, no port', () => {
    expect(siteHost('https://WWW.Forms.Example.net:444')).toBe('forms.example.net');
    expect(siteHost('null')).toBe('');
  });
});
