// The tracker inside the profile export: one file, and the desktop extension still reads it.
import { describe, expect, it } from 'vitest';
import { decryptExport } from '../../../../mobile/app/src/data/exportCrypto';
import { buildExport, readImport, unlockImport } from '../../../../mobile/app/src/data/transfer';
import { ApplicationRecordSchema, defaultAppState, type AppState } from '../../../../mobile/app/src/store/appStateStore';
import { TRACKER_FORMAT, TRACKER_KEY, readTracker, withTracker } from '../../../../mobile/app/src/tracker/model/trackerTransfer';
import { exportProfile, parseProfileJson } from '../../../../src/editor';
import { CURRENT_SCHEMA_VERSION, ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const profile: Profile = ProfileSchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  resumes: [
    ResumeSchema.parse({
      id: 'r1',
      title: '我的中文简历',
      locale: 'zh-CN',
      createdAt: 1,
      updatedAt: 1,
      basics: { familyName: '张', givenName: '三' },
      contact: { email: 'zhangsan@example.com' },
      education: [{ school: '示例大学' }],
    }),
  ],
  activeResumeId: 'r1',
});

const record = ApplicationRecordSchema.parse({
  id: 'a1',
  url: 'https://jobs.example.com/apply/1',
  host: 'jobs.example.com',
  company: '示例科技',
  companyGuessed: false,
  position: '产品经理',
  status: 'filling',
  statusAt: 5,
  deadline: { date: '2026-11-20', time: '18:00' },
  remind: true,
  notes: '北京',
  createdAt: 1,
  openedAt: 5,
  updatedAt: 5,
  history: [{ at: 4, resumeId: 'r1', locale: 'zh-CN', filled: 12, attention: 3, skipped: 5 }],
});

const tracked: AppState = defaultAppState({
  applications: [record],
  reminders: { time: '20:00', dayBefore: false, dayOf: true, defaultOn: true },
  clipboard: { offer: false, lastStamp: 9, dismissed: ['a'.repeat(32)] },
});

const NOW = new Date(2026, 10, 15, 10, 30).getTime();

describe('tracker transfer', () => {
  it("the extension's own parseProfileJson reads an export that carries the tracker and returns the same profile", () => {
    const text = withTracker(exportProfile(profile), tracked);
    const parsed = parseProfileJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile).toEqual(profile);
    expect(JSON.parse(text)[TRACKER_KEY]).toEqual({
      format: TRACKER_FORMAT,
      version: 1,
      applications: [record],
      reminders: tracked.reminders,
    });
  });

  it('the tracker key comes after the profile keys and the clipboard is never exported', () => {
    const text = withTracker(exportProfile(profile), tracked);
    const keys = Object.keys(JSON.parse(text));
    expect(keys.at(-1)).toBe(TRACKER_KEY);
    expect(keys.slice(0, -1)).toEqual(Object.keys(JSON.parse(exportProfile(profile))));
    expect(text).not.toContain('dismissed');
    expect(text.startsWith(exportProfile(profile).slice(0, -2))).toBe(true);
  });

  it('an export without records is byte-identical to exportProfile', async () => {
    const plain = exportProfile(profile);
    expect((await buildExport(profile, { now: NOW, tracker: defaultAppState() })).text).toBe(plain);
    expect((await buildExport(profile, { now: NOW })).text).toBe(plain);
    expect((await buildExport(profile, { now: NOW, tracker: tracked })).text).toBe(withTracker(plain, tracked));
  });

  it('readTracker: none, ok, invalid', () => {
    expect(readTracker(exportProfile(profile))).toEqual({ kind: 'none' });
    expect(readTracker(withTracker(exportProfile(profile), tracked))).toEqual({
      kind: 'ok',
      applications: [record],
      reminders: tracked.reminders,
    });
    const bad = { ...JSON.parse(exportProfile(profile)), [TRACKER_KEY]: { format: TRACKER_FORMAT, version: 1, applications: [{ id: 'x', url: 'javascript:alert(1)' }] } };
    expect(readTracker(JSON.stringify(bad))).toEqual({ kind: 'invalid' });
    const other = { ...JSON.parse(exportProfile(profile)), [TRACKER_KEY]: { format: 'something-else', version: 1, applications: [] } };
    expect(readTracker(JSON.stringify(other))).toEqual({ kind: 'invalid' });
    const newer = { ...JSON.parse(exportProfile(profile)), [TRACKER_KEY]: { format: TRACKER_FORMAT, version: 2, applications: [] } };
    expect(readTracker(JSON.stringify(newer))).toEqual({ kind: 'invalid' });
    expect(readTracker('{ nope')).toEqual({ kind: 'none' });
    expect(readTracker('[]')).toEqual({ kind: 'none' });
  });

  it('readImport carries the tracker read from the same text', () => {
    expect(readImport(withTracker(exportProfile(profile), tracked))).toEqual({
      kind: 'profile',
      profile,
      tracker: { kind: 'ok', applications: [record], reminders: tracked.reminders },
    });
    expect(readImport(exportProfile(profile))).toEqual({ kind: 'profile', profile, tracker: { kind: 'none' } });
  });

  it('a password export keeps the tracker through encrypt and decrypt', async () => {
    const file = await buildExport(profile, { now: NOW, password: 'example-pass-123', tracker: tracked });
    expect(await decryptExport(file.text, 'example-pass-123')).toBe(withTracker(exportProfile(profile), tracked));
    expect(await unlockImport(file.text, 'example-pass-123')).toEqual({
      kind: 'profile',
      profile,
      tracker: { kind: 'ok', applications: [record], reminders: tracked.reminders },
    });
  });
});
