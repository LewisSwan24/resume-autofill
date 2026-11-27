// What the recorder hands over: one file holding the HAR, the frames as static HTML, the tab's session storage and the
// meta a sample keeps, all sanitised, and refused outright while the audit finds anything.
import { describe, expect, it } from 'vitest';
import { auditCapture, buildCapture, termsFrom, type CaptureInput } from '../../../src/capture/bundle';
import type { HarFile } from '../../../src/capture/sanitize';
import { createSampleProfile } from '../../../src/schema/samples';

const entry = (url: string, text: string, mimeType = 'text/html') => ({
  request: { method: 'GET', url, headers: [{ name: 'Cookie', value: 'sid=abc' }], cookies: [], queryString: [] },
  response: { status: 200, headers: [], cookies: [], content: { mimeType, text } },
});

function input(over: Partial<CaptureInput> = {}): CaptureInput {
  const har: HarFile = {
    log: {
      entries: [
        entry('https://jobs.example.com/apply', '<p>Write to jane@corp.example</p>'),
        entry('https://cdn.example.net/site.css', '.x{display:none}', 'text/css'),
      ],
    },
  };
  return {
    meta: { ats: 'personio', name: 'support', url: 'https://jobs.example.com/apply', locale: 'en-AU' },
    capturedAt: '2026-11-27T00:00:00.000Z',
    har,
    frames: [
      { url: 'https://jobs.example.com/apply', data: { html: '<!doctype html><html><body><p>jane@corp.example</p><script>1</script></body></html>', css: 'p{}', crossOriginSheets: ['https://cdn.example.net/site.css'] } },
      { url: 'https://forms.example.com/frame', data: { html: '<html><body><input value="Jane"></body></html>', css: '', crossOriginSheets: [] } },
    ],
    storage: { origin: 'https://jobs.example.com', sessionStorage: { refreshToken: 'abc', draft: '{"email":"jane@corp.example"}' } },
    scrub: { terms: ['Jane'] },
    ...over,
  };
}

describe('buildCapture', () => {
  it('sanitises every part into one bundle the audit passes', () => {
    const result = buildCapture(input());
    if (!result.ok) throw new Error(JSON.stringify(result.findings));
    const { bundle } = result;
    expect(bundle.format).toBe('raf-capture');
    expect(bundle.version).toBe(1);
    const text = JSON.stringify(bundle);
    expect(text).not.toMatch(/jane@corp|Jane|refreshToken|sid=abc|<script/);
    expect(bundle.pages.map((p) => p.file)).toEqual(['page.html', 'frame-1.html']);
    // The sheet another origin served is inlined from the recording, so hidden things stay hidden offline.
    expect(bundle.pages[0]!.html).toContain('.x{display:none}');
    expect(bundle.storage).toEqual({ origin: 'https://jobs.example.com', sessionStorage: { draft: expect.stringContaining('redacted-') } });
    expect(bundle.meta).toEqual({
      ats: 'personio',
      name: 'support',
      url: 'https://jobs.example.com/apply',
      capturedAt: '2026-11-27T00:00:00.000Z',
      recordedWith: 'chrome',
      device: 'desktop',
      locale: 'en-AU',
      frames: [
        { url: 'https://jobs.example.com/apply', file: 'page.html' },
        { url: 'https://forms.example.com/frame', file: 'frame-1.html' },
      ],
      screenshots: [],
      harEntries: 2,
      auditFindings: 0,
    });
    expect(auditCapture(bundle, { terms: ['Jane'] })).toEqual([]);
  });

  it('leaves storage out when the tab kept nothing', () => {
    const result = buildCapture(input({ storage: { origin: 'https://jobs.example.com', sessionStorage: {} } }));
    expect(result.ok && result.bundle.storage).toBeUndefined();
  });

  it('refuses to hand over anything while the audit finds something', () => {
    const result = buildCapture(input(), () => [{ kind: 'email', where: 'page.html: html', sample: 'j***' }]);
    expect(result).toEqual({ ok: false, findings: [{ kind: 'email', where: 'page.html: html', sample: 'j***' }] });
  });
});

describe('auditCapture', () => {
  it('parses the pages with the DOM it is handed, as the command line hands it jsdom', () => {
    const result = buildCapture(input());
    if (!result.ok) throw new Error('not ok');
    const parsed: string[] = [];
    const dom = {
      parse: (html: string) => {
        parsed.push(html);
        return new DOMParser().parseFromString(html, 'text/html');
      },
      serialize: (doc: Document) => doc.documentElement.outerHTML,
    };
    expect(auditCapture(result.bundle, { terms: ['Jane'], dom })).toEqual([]);
    expect(parsed).toHaveLength(result.bundle.pages.length);
  });

  it('finds what was left in any part, and says where', () => {
    const raw = input();
    const findings = auditCapture(
      {
        format: 'raf-capture',
        version: 1,
        meta: { ...raw.meta, capturedAt: raw.capturedAt, recordedWith: 'chrome', device: 'desktop', locale: 'en-AU', frames: [], screenshots: [], harEntries: 2, auditFindings: 0 },
        har: raw.har,
        pages: [{ file: 'page.html', html: raw.frames[0]!.data.html }],
        storage: raw.storage!,
      },
      raw.scrub,
    );
    const where = findings.map((f) => f.where.split(':')[0]);
    expect(where).toEqual(expect.arrayContaining(['page.har', 'page.html', 'storage.json']));
  });
});

describe('termsFrom', () => {
  it("takes the identifying values of every resume kept, not only the one in use", () => {
    const [a, b] = createSampleProfile().resumes;
    const terms = termsFrom([a, b]);
    expect(terms.length).toBeGreaterThan(termsFrom([a]).length);
    expect(terms).toEqual(expect.arrayContaining(termsFrom([b])));
    expect(new Set(terms).size).toBe(terms.length);
  });
});
