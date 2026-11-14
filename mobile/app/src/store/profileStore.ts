// Profile storage for the mobile app. One contract (load / save), three backends:
//  - vault: the native ProfileVault plugin (AES-GCM file in the app's private folder, key in Android Keystore);
//  - localStorage: previewing the page in a desktop browser;
//  - memory: tests.
// The save-time rules mirror the extension's src/storage/profileRepo.ts, which cannot be imported here because it
// reads `browser.storage`. P1 ("ProfileStore" extraction) folds the two into one shared module.
import {
  CURRENT_SCHEMA_VERSION,
  ProfileSchema,
  migrateProfile,
  type Profile,
  type Resume,
} from '../../../../src/schema';

export interface ProfileStore {
  /** The stored profile, migrated and validated; an empty profile when nothing is stored. Throws on corrupt data. */
  load(): Promise<Profile>;
  /** Validate and store. Throws (writing nothing) when invalid. Resolves to what was stored. */
  save(profile: Profile): Promise<Profile>;
}

/** The native side of the vault store (see mobile/android ProfileVaultPlugin.java). */
export interface VaultPlugin {
  read(): Promise<{ data: string | null }>;
  write(options: { data: string }): Promise<void>;
}

export function emptyProfile(): Profile {
  return ProfileSchema.parse({ schemaVersion: CURRENT_SCHEMA_VERSION });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const sameContent = (a: Resume, b: Resume) => deepEqual({ ...a, updatedAt: 0 }, { ...b, updatedAt: 0 });

/**
 * The profile as it should be written: validated, `activeResumeId` pointing at an existing resume (null only when
 * there are none), and `updatedAt` kept for unchanged resumes and set to `now` for new or changed ones.
 */
export function prepareForSave(next: Profile, previous: Profile | null, now: number): Profile {
  const parsed = ProfileSchema.parse(next);
  if (!parsed.resumes.some((r) => r.id === parsed.activeResumeId)) {
    parsed.activeResumeId = parsed.resumes[0]?.id ?? null;
  }
  const before = new Map((previous?.resumes ?? []).map((r) => [r.id, r]));
  parsed.resumes = parsed.resumes.map((r) => {
    const old = before.get(r.id);
    return old && sameContent(old, r) ? { ...r, updatedAt: old.updatedAt } : { ...r, updatedAt: now };
  });
  return parsed;
}

/** A store over raw string reads and writes. Saves run one at a time, in call order. */
function createSerializedStore(read: () => Promise<string | null>, write: (data: string) => Promise<void>): ProfileStore {
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  const load = async (): Promise<Profile> => {
    const data = await read();
    return data === null ? emptyProfile() : migrateProfile(JSON.parse(data));
  };
  return {
    load: () => exclusive(load),
    save: (profile) =>
      exclusive(async () => {
        // A corrupt stored profile must not stop the person from saving a good one.
        const previous = await load().catch(() => null);
        const prepared = prepareForSave(profile, previous, Date.now());
        await write(JSON.stringify(prepared));
        return prepared;
      }),
  };
}

export function createVaultStore(vault: VaultPlugin): ProfileStore {
  return createSerializedStore(
    async () => (await vault.read()).data ?? null,
    (data) => vault.write({ data }),
  );
}

export const LOCAL_STORAGE_KEY = 'raf.profile';

export function createLocalStorageStore(storage: Storage, key: string = LOCAL_STORAGE_KEY): ProfileStore {
  return createSerializedStore(
    async () => storage.getItem(key),
    async (data) => storage.setItem(key, data),
  );
}

/** In-memory store, optionally seeded with a raw (unvalidated) profile. */
export function createMemoryStore(initial?: unknown): ProfileStore {
  let data: string | null = initial === undefined ? null : JSON.stringify(initial);
  return createSerializedStore(
    async () => data,
    async (next) => {
      data = next;
    },
  );
}
