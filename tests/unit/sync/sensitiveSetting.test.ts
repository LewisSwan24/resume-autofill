import { describe, expect, it } from 'vitest';
import { createSampleProfile, type Profile, type Settings } from '../../../src/schema';
import { applySyncMerge, type SyncStorageAdapter, type UnlockedSyncPayload } from '../../../src/sync';

const storage: SyncStorageAdapter = {
  listExistingFiles: async () => [],
  saveFile: async () => 'unused',
  deleteFile: async () => undefined,
};

function withSettings(settings: Partial<Settings>): Profile {
  const p = createSampleProfile();
  return { ...p, settings: { ...p.settings, ...settings } };
}

const incoming = (profile: Profile): UnlockedSyncPayload => ({ format: 'plain-json', mode: 'light', profile, tracker: [], attachments: [] });

async function merged(local: Profile, other: Profile): Promise<Settings> {
  return (await applySyncMerge(local, incoming(other), [], storage, { strategy: 'merge' })).profile.settings;
}

describe('the sensitive-field setting travels with sync', () => {
  it('takes the other device’s choice when it was made later', async () => {
    const local = withSettings({ sensitiveFields: 'remind', sensitiveFieldsUpdatedAt: 1000, uiLanguage: 'zh' });
    const other = withSettings({ sensitiveFields: 'fill', sensitiveFieldsUpdatedAt: 2000, uiLanguage: 'en' });
    const settings = await merged(local, other);
    expect(settings).toMatchObject({ sensitiveFields: 'fill', sensitiveFieldsUpdatedAt: 2000 });
    // The rest of the settings stay this device's own.
    expect(settings.uiLanguage).toBe('zh');
  });

  it('keeps this device’s choice when it is the newer one, or the other device never made one', async () => {
    const local = withSettings({ sensitiveFields: 'fill', sensitiveFieldsUpdatedAt: 3000 });
    expect(await merged(local, withSettings({ sensitiveFields: 'remind', sensitiveFieldsUpdatedAt: 2000 }))).toMatchObject({
      sensitiveFields: 'fill',
      sensitiveFieldsUpdatedAt: 3000,
    });
    expect(await merged(local, withSettings({ sensitiveFields: 'remind' }))).toMatchObject({ sensitiveFields: 'fill' });
  });

  it('takes a choice into a device that never made one', async () => {
    const settings = await merged(withSettings({}), withSettings({ sensitiveFields: 'fill', sensitiveFieldsUpdatedAt: 5 }));
    expect(settings).toMatchObject({ sensitiveFields: 'fill', sensitiveFieldsUpdatedAt: 5 });
  });
});
