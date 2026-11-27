// A bundle handed over by the recorder becomes a sample directory laid out as the command line writes one, after the
// audit has run again with the terms only this computer knows: the recorder build keeps no real resume to scrub by.
import { describe, expect, it } from 'vitest';
import { buildCapture, type CaptureBundle, type CaptureInput } from '../../../src/capture/bundle';
import { sampleFromBundle } from '../../../src/capture/sample';

const input: CaptureInput = {
  meta: { ats: 'personio', name: 'support', url: 'https://jobs.example.com/apply', locale: 'en-AU' },
  capturedAt: '2026-11-27T00:00:00.000Z',
  har: {
    log: {
      entries: [
        {
          request: { method: 'GET', url: 'https://jobs.example.com/apply', headers: [], cookies: [], queryString: [] },
          response: { status: 200, headers: [], cookies: [], content: { mimeType: 'text/html', text: '<p>Hello Morgan Vale</p>' } },
        },
      ],
    },
  },
  frames: [
    { url: 'https://jobs.example.com/apply', data: { html: '<html><body><form><input name="a"></form></body></html>', css: '', crossOriginSheets: [] } },
    { url: 'https://jobs.example.com/f', data: { html: '<html><body><p>frame</p></body></html>', css: '', crossOriginSheets: [] } },
  ],
  storage: { origin: 'https://jobs.example.com', sessionStorage: { step: '1' } },
  scrub: {},
};

function bundle(over: Partial<CaptureInput> = {}): CaptureBundle {
  const result = buildCapture({ ...input, ...over });
  if (!result.ok) throw new Error(JSON.stringify(result.findings));
  return result.bundle;
}

describe('sampleFromBundle', () => {
  it('lays a bundle out as the command line lays out a sample', () => {
    const result = sampleFromBundle(bundle());
    if (!result.ok) throw new Error(result.problems.join('; '));
    expect(result.ats).toBe('personio');
    expect(result.name).toBe('support');
    expect(Object.keys(result.files).sort()).toEqual(['frame-1.html', 'meta.json', 'page.har', 'page.html', 'storage.json']);
    expect(JSON.parse(result.files['page.har']!).log.entries).toHaveLength(1);
    expect(JSON.parse(result.files['storage.json']!)).toEqual({ origin: 'https://jobs.example.com', sessionStorage: { step: '1' } });
    const meta = JSON.parse(result.files['meta.json']!);
    expect(meta).toMatchObject({ ats: 'personio', name: 'support', url: 'https://jobs.example.com/apply', recordedWith: 'chrome', harEntries: 1 });
    expect(result.files['meta.json']!.endsWith('}\n')).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('takes another name for the sample when asked', () => {
    const result = sampleFromBundle(bundle(), { name: 'support-chrome' });
    expect(result.ok && [result.name, JSON.parse(result.files['meta.json']!).name]).toEqual(['support-chrome', 'support-chrome']);
  });

  it('writes nothing while the audit, run again with this computer’s terms, finds something', () => {
    const result = sampleFromBundle(bundle(), { terms: ['Morgan Vale'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toEqual([expect.stringMatching(/^term page\.har: entry 0 body /)]);
  });

  it('refuses what is not a recorder bundle, or names no sample could have', () => {
    const problems = (raw: unknown) => {
      const r = sampleFromBundle(raw);
      return r.ok ? [] : r.problems;
    };
    expect(problems({ format: 'something-else' })).toEqual(['not a recorder bundle (format raf-capture, version 1)']);
    expect(problems({ ...bundle(), version: 2 })).toEqual(['not a recorder bundle (format raf-capture, version 1)']);
    expect(problems({ ...bundle(), meta: { ...bundle().meta, ats: '../x' } })).toEqual(['the platform must be a lowercase slug: ../x']);
    expect(problems({ ...bundle(), pages: [{ file: '../../evil.html', html: '' }] })).toEqual(['a page file name no sample has: ../../evil.html']);
    const r = sampleFromBundle(bundle(), { name: 'Bad Name' });
    expect(!r.ok && r.problems).toEqual(['the sample name must be a lowercase slug: Bad Name']);
  });

  it('passes on why the recording may hold no form', () => {
    const result = sampleFromBundle(
      bundle({ frames: [{ url: 'https://jobs.example.com/apply', data: { html: '<p>请完成安全验证</p>', css: '', crossOriginSheets: [] } }] }),
    );
    expect(result.ok && result.warnings).toEqual(['no-form', 'captcha']);
  });
});
