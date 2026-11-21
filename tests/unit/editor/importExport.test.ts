import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileSchema, createSampleProfile } from '../../../src/schema';
import { createAutosaver, exportProfile, issuesForResume, parseProfileJson, validateProfile } from '../../../src/editor';

describe('import / export', () => {
  it('round-trips the sample profile', () => {
    const profile = createSampleProfile();
    const result = parseProfileJson(exportProfile(profile));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile).toEqual(profile);
  });

  it('exports the test-score list of a language and reads it back; an older file gains the list on import', () => {
    const profile = createSampleProfile();
    const text = exportProfile(profile);
    expect(JSON.parse(text).resumes[0].languages[0].tests).toEqual([{ test: 'cet6', score: '580', date: '' }]);
    const older = JSON.parse(text);
    delete older.resumes[0].languages[0].tests;
    const result = parseProfileJson(JSON.stringify(older));
    expect(result.ok && result.profile.resumes[0]!.languages[0]!.tests).toEqual([{ test: 'cet6', score: '580', date: '' }]);
  });

  it('export contains no file bytes, only attachment ids', () => {
    const text = exportProfile(createSampleProfile());
    expect(text).not.toMatch(/data:|base64/i);
    expect(text).toContain('sample-resume-zh');
  });

  it('rejects text that is not JSON', () => {
    const result = parseProfileJson('{ not json');
    expect(result).toMatchObject({ ok: false, code: 'invalid_json' });
  });

  it('rejects JSON that is not a valid profile', () => {
    expect(parseProfileJson('[]')).toMatchObject({ ok: false, code: 'invalid_profile' });
    expect(parseProfileJson('{"schemaVersion":99,"resumes":[]}')).toMatchObject({ ok: false, code: 'invalid_profile' });
    const bad = JSON.stringify({ schemaVersion: 1, resumes: [{ id: 'x', title: 't', locale: 'fr-FR' }] });
    expect(parseProfileJson(bad)).toMatchObject({ ok: false, code: 'invalid_profile' });
  });

  it('migrates an un-versioned profile', () => {
    const result = parseProfileJson(JSON.stringify({ resumes: [{ id: 'x', title: 't', locale: 'en-AU' }] }));
    expect(result.ok && result.profile.activeResumeId).toBe('x');
  });
});

describe('validation', () => {
  it('reports no issues for a valid profile', () => {
    expect(validateProfile(createSampleProfile())).toEqual([]);
  });

  it('maps issues to per-resume paths', () => {
    const profile = createSampleProfile();
    profile.resumes[1]!.education.push({ ...profile.resumes[1]!.education[0]!, startDate: '2020/09' });
    const issues = validateProfile(profile);
    expect(issues.length).toBeGreaterThan(0);
    const forResume = issuesForResume(issues, 1);
    const path = `education.${profile.resumes[1]!.education.length - 1}.startDate`;
    expect(forResume.has(path)).toBe(true);
    expect(issuesForResume(issues, 0).size).toBe(0);
    expect(ProfileSchema.safeParse(profile).success).toBe(false);
  });
});

describe('autosave debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves only the latest value, 500 ms after the last edit', async () => {
    const save = vi.fn();
    const saver = createAutosaver<number>(save);
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(400);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(save).not.toHaveBeenCalled();
    expect(saver.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(2);
    expect(saver.pending).toBe(false);
  });

  it('flush saves immediately and cancel drops the pending value', async () => {
    const save = vi.fn();
    const saver = createAutosaver<string>(save);
    saver.schedule('a');
    await saver.flush();
    expect(save).toHaveBeenCalledWith('a');
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule('b');
    saver.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
