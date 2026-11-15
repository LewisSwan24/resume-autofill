// AppState v1 (recent pages) → v2 (application records).
import { describe, expect, it } from 'vitest';
import { AppStateTooNewError, migrateAppState } from '../../../../mobile/app/src/store/appStateMigrate';
import { createMemoryAppStateStore, defaultAppState } from '../../../../mobile/app/src/store/appStateStore';
import { isUntouched } from '../../../../mobile/app/src/tracker/model/records';

const v1 = {
  version: 1,
  onboardingDone: true,
  fillLanguage: 'en',
  recentPages: [
    { id: 'p2', url: 'https://jobs.example.com/apply/2#step', host: 'jobs.example.com', title: '示例科技校园招聘', addedAt: 200 },
    { id: 'p1', url: 'http://careers.example.com/1', host: 'careers.example.com', addedAt: 100 },
  ],
};

describe('migrateAppState', () => {
  it('v1 recent pages become records with the same ids, order, urls and titles', () => {
    const s = migrateAppState(v1);
    expect(s.version).toBe(2);
    expect(s.applications.map((r) => [r.id, r.url, r.host, r.title])).toEqual([
      ['p2', 'https://jobs.example.com/apply/2#step', 'jobs.example.com', '示例科技校园招聘'],
      ['p1', 'http://careers.example.com/1', 'careers.example.com', undefined],
    ]);
    expect(s.applications[0]!.company).toBe('示例科技');
    expect(s.applications[1]!.company).toBe('example');
    expect(s.applications[0]).toMatchObject({ createdAt: 200, openedAt: 200, updatedAt: 200, statusAt: 200 });
  });

  it('migrated records are 想投, untouched, without history or reminder', () => {
    for (const r of migrateAppState(v1).applications) {
      expect(r).toMatchObject({ status: 'wish', companyGuessed: true, position: '', notes: '', remind: false, history: [] });
      expect(r.deadline).toBeUndefined();
      expect(isUntouched(r)).toBe(true);
    }
  });

  it('v1 settings carry over', () => {
    const s = migrateAppState(v1);
    expect(s.onboardingDone).toBe(true);
    expect(s.fillLanguage).toBe('en');
    expect(s.reminders).toEqual({ time: '09:00', dayBefore: true, dayOf: true, defaultOn: false });
    expect(s.clipboard).toEqual({ offer: true, lastStamp: null, dismissed: [] });
    expect(migrateAppState({ version: 1 })).toEqual(defaultAppState());
  });

  it('v2 is returned as is', () => {
    const state = defaultAppState({ onboardingDone: true, fillLanguage: 'zh' });
    expect(migrateAppState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => migrateAppState({ version: 2, applications: 'x' })).toThrow();
  });

  it('version 3 throws AppStateTooNewError', () => {
    expect(() => migrateAppState({ version: 3, anything: true })).toThrow(AppStateTooNewError);
  });

  it('garbage throws a plain error', () => {
    for (const raw of [null, 'x', 4, [], {}, { version: 0 }, { version: 1.5 }, { version: '2' }, { version: 1, recentPages: 'x' }]) {
      let error: unknown;
      try {
        migrateAppState(raw);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppStateTooNewError);
    }
  });

  it('a memory store seeded with v1 loads v2 and saves version 2', async () => {
    const store = createMemoryAppStateStore(v1);
    const loaded = await store.load();
    expect(loaded?.version).toBe(2);
    expect(loaded?.applications.map((r) => r.id)).toEqual(['p2', 'p1']);
    const saved = await store.save(loaded!);
    expect(saved.version).toBe(2);
    expect(await store.load()).toEqual(loaded);
  });

  it('a store holding a newer version throws AppStateTooNewError on load', async () => {
    await expect(createMemoryAppStateStore({ version: 3 }).load()).rejects.toBeInstanceOf(AppStateTooNewError);
  });
});
