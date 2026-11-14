// Delete all data. On the device one native call removes profile.enc, state.enc, every attachment file and the
// Keystore key (ProfileVaultPlugin.wipe); in the browser preview and in tests the stores are swept one by one.
import type { AppStateStore } from './appStateStore';
import { sweepFiles, type FileStore } from './fileStore';
import { emptyProfile, type ProfileStore } from './profileStore';

export interface Wiper {
  wipeAll(): Promise<void>;
}

export interface WipeVaultPlugin {
  wipe(): Promise<void>;
}

export function createVaultWiper(vault: WipeVaultPlugin): Wiper {
  return { wipeAll: () => vault.wipe() };
}

export function createStoreWiper(stores: { profile: ProfileStore; files: FileStore; appState: AppStateStore }): Wiper {
  return {
    async wipeAll() {
      await sweepFiles(stores.files, () => false);
      await stores.profile.save(emptyProfile());
      await stores.appState.clear();
    },
  };
}
