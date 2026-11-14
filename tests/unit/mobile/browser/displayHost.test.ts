import { describe, expect, it } from 'vitest';
import { displayHost } from '../../../../mobile/app/src/browser/model/displayHost';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';

describe('displayHost', () => {
  it('drops www. and marks https secure', () => {
    expect(displayHost('https://www.example.com/a')).toEqual({ host: 'example.com', punycode: false, kind: 'secure' });
  });
  it('keeps a non-default port and marks http insecure', () => {
    expect(displayHost('http://jobs.example.com:8080/')).toEqual({ host: 'jobs.example.com:8080', punycode: false, kind: 'insecure' });
  });
  it('shows an IDN as punycode', () => {
    expect(displayHost('https://例子.com/')).toEqual({ host: 'xn--fsqu00a.com', punycode: true, kind: 'secure' });
  });
  it('shows a homograph host in its xn-- form', () => {
    const h = displayHost('https://аррӏе.com/');
    expect(h.host.startsWith('xn--')).toBe(true);
    expect(h.punycode).toBe(true);
  });
  it('keeps IP hosts and ports', () => {
    expect(displayHost('http://127.0.0.1:4180/').host).toBe('127.0.0.1:4180');
    expect(displayHost('http://[::1]:4180/').host).toBe('[::1]:4180');
  });
  it('marks the demo', () => {
    expect(displayHost(DEMO_URL).kind).toBe('demo');
  });
  it('does not throw on garbage', () => {
    expect(displayHost('not a url')).toEqual({ host: '', punycode: false, kind: 'insecure' });
  });
});
