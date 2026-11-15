// App state's `keyboard` settings: 「在输入法里显示简历」 and the groups hidden from the
// keyboard. Version stays 2; older states load with the defaults; the setting belongs to this phone, so it is never
// exported.
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../../../mobile/app/src/data/transfer';
import { migrateAppState } from '../../../../mobile/app/src/store/appStateMigrate';
import {
  ApplicationRecordSchema,
  AppStateSchema,
  createMemoryAppStateStore,
  createVaultAppStateStore,
  defaultAppState,
  KeyboardSettingsSchema,
  type AppStateVaultPlugin,
} from '../../../../mobile/app/src/store/appStateStore';
import { SAMPLE_RESUME_ZH } from '../../../../mobile/app/src/browser/model/sampleResume';
import { emptyProfile } from '../../../../mobile/app/src/store/profileStore';

function fakeVault(): AppStateVaultPlugin & { data: string | null } {
  const vault = {
    data: null as string | null,
    async readState() {
      return { data: vault.data };
    },
    async writeState({ data }: { data: string }) {
      vault.data = data;
    },
    async clearState() {
      vault.data = null;
    },
  };
  return vault;
}

describe('app state keyboard settings', () => {
  it('a v2 state without keyboard loads with show on and nothing hidden', async () => {
    expect(defaultAppState().keyboard).toEqual({ show: true, hidden: [] });
    expect((await createMemoryAppStateStore({ version: 2, onboardingDone: true }).load())!.keyboard).toEqual({ show: true, hidden: [] });
    expect(defaultAppState().version).toBe(2);
  });

  it('an unknown group id in hidden falls back to nothing hidden', () => {
    expect(AppStateSchema.parse({ version: 2, keyboard: { show: false, hidden: ['education', 'diversity'] } }).keyboard).toEqual({
      show: false,
      hidden: [],
    });
    expect(KeyboardSettingsSchema.parse({ hidden: 'basics' })).toEqual({ show: true, hidden: [] });
    expect(KeyboardSettingsSchema.parse({ hidden: ['education', 'skills'] })).toEqual({ show: true, hidden: ['education', 'skills'] });
  });

  it('the vault store round-trips keyboard', async () => {
    const vault = fakeVault();
    const store = createVaultAppStateStore(vault);
    const state = defaultAppState({ keyboard: { show: false, hidden: ['other', 'about'] } });
    await store.save(state);
    expect(JSON.parse(vault.data!).keyboard).toEqual({ show: false, hidden: ['other', 'about'] });
    expect((await store.load())!.keyboard).toEqual({ show: false, hidden: ['other', 'about'] });
  });

  it('the migration from v1 still yields the defaults', () => {
    expect(migrateAppState({ version: 1 }).keyboard).toEqual({ show: true, hidden: [] });
  });

  it('the export never carries keyboard', async () => {
    const record = ApplicationRecordSchema.parse({
      id: 'p1', url: 'https://jobs.example.com/apply', host: 'jobs.example.com', statusAt: 1, createdAt: 1, openedAt: 1, updatedAt: 1,
    });
    const tracker = defaultAppState({ applications: [record], keyboard: { show: false, hidden: ['education'] } });
    const file = await buildExport({ ...emptyProfile(), resumes: [SAMPLE_RESUME_ZH], activeResumeId: SAMPLE_RESUME_ZH.id }, { now: Date.UTC(2026, 10, 15), tracker });
    expect(file.text).not.toContain('"keyboard"');
    expect(file.text).toContain('jobs.example.com');
  });
});
