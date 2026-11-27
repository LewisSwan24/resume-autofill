// pnpm capture:import, run as the user runs it, on a bundle the recorder could have handed over.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCapture } from '../../../src/capture/bundle';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let tmp = '';
let home = '';
let out = '';
let bundlePath = '';

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'raf-import-'));
  home = path.join(tmp, 'home');
  out = path.join(tmp, 'captured');
  mkdirSync(home);
  const result = buildCapture({
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
    frames: [{ url: 'https://jobs.example.com/apply', data: { html: '<html><body><form><input name="a"></form></body></html>', css: '', crossOriginSheets: [] } }],
    storage: null,
    scrub: {},
  });
  if (!result.ok) throw new Error('bundle');
  bundlePath = path.join(tmp, 'personio-support.raf-capture.json');
  writeFileSync(bundlePath, JSON.stringify(result.bundle));
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/capture-import.ts', bundlePath, '--out', out, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
    timeout: 60_000,
  });

describe('pnpm capture:import', () => {
  it('writes the sample where the command line would, and says so', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(readdirSync(path.join(out, 'personio', 'support')).sort()).toEqual(['meta.json', 'page.har', 'page.html']);
    expect(r.stdout).toContain('imported personio/support: 1 request(s), 1 page(s), audit clean');
  });

  it('writes nothing when a term from scrub-terms.txt is left in, and says where', () => {
    mkdirSync(path.join(home, '.raf-capture'));
    writeFileSync(path.join(home, '.raf-capture', 'scrub-terms.txt'), 'Morgan Vale\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/term\s+page\.har: entry 0 body/);
    expect(existsSync(path.join(out, 'personio'))).toBe(false);
  });

  it('keeps a sample already there unless told to replace it', () => {
    const dir = path.join(out, 'personio', 'support');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'expected.json'), '{}');
    const refused = run();
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('already has a sample');
    expect(readdirSync(dir)).toEqual(['expected.json']);
    expect(run('--force').status).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['meta.json', 'page.har', 'page.html']);
  });

  it('takes another name, and the expected.json of a sample of the same page', () => {
    const twin = path.join(tmp, 'twin');
    mkdirSync(twin);
    writeFileSync(path.join(twin, 'expected.json'), '{"fields":{}}\n');
    const r = run('--name', 'support-chrome', '--expected-from', twin);
    expect(r.status).toBe(0);
    const dir = path.join(out, 'personio', 'support-chrome');
    expect(readFileSync(path.join(dir, 'expected.json'), 'utf8')).toBe('{"fields":{}}\n');
    expect(JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')).name).toBe('support-chrome');
  });

});
