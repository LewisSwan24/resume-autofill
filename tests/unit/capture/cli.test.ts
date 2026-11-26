// @vitest-environment node
// The capture command's argument checks, run as the user runs it. Each case stops before a browser starts.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// An empty home, so no scrub-terms file of the user's own is read and the run stops at the terms check.
const HOME = mkdtempSync(path.join(tmpdir(), 'raf-capture-home-'));
const OUTSIDE = mkdtempSync(path.join(tmpdir(), 'raf-capture-profile-'));

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

function capture(profileDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/capture-page.ts', '--ats', 'test', '--name', 'cli', '--url', 'http://127.0.0.1:9/', '--profile-dir', profileDir],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME, USERPROFILE: HOME }, timeout: 60_000 },
  );
}

describe('pnpm capture --open', () => {
  it('refuses an empty selector before a browser starts', () => {
    const run = spawnSync(
      process.execPath,
      ['scripts/capture-page.ts', '--ats', 'test', '--name', 'cli', '--url', 'http://127.0.0.1:9/', '--open', ' '],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME, USERPROFILE: HOME }, timeout: 60_000 },
    );
    expect(run.stderr).toContain('--open needs the selector');
    expect(run.status).toBe(2);
  });
});

describe('pnpm capture --profile-dir', () => {
  it.each([
    ['the repository itself', ROOT],
    ['a folder in it', path.join(ROOT, 'profiles')],
    ['a nested folder in it', path.join(ROOT, 'fixtures', 'profiles')],
    ['a folder in it whose name starts with two dots', path.join(ROOT, '..profiles')],
  ])('refuses %s', (_label, dir) => {
    const run = capture(dir);
    expect(run.stderr).toContain('--profile-dir must be outside the repository');
    expect(run.status).toBe(2);
  });

  it('accepts a folder outside the repository and goes on to the terms check', () => {
    const run = capture(OUTSIDE);
    expect(run.stderr).not.toContain('--profile-dir must be outside');
    expect(run.stderr).toContain('logged-in capture needs terms');
    expect(run.status).toBe(2);
  });
});
