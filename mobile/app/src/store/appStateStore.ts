// App state of the mobile app: whether onboarding is done, the default fill language and the recent application
// pages. Not resume content, but it says where the person applies, so on the device it is encrypted like the
// profile (files/state.enc through the ProfileVault plugin). One contract, three backends: vault, localStorage
// (desktop browser preview) and memory (tests).
import { z } from 'zod';

export const RECENT_PAGES_MAX = 30;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export const RecentPageSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().max(2048).refine(isHttpUrl),
  host: z.string().min(1).max(253),
  title: z.string().max(80).optional(),
  addedAt: z.number().int().nonnegative(),
});

export const AppStateSchema = z.object({
  version: z.literal(1),
  onboardingDone: z.boolean().default(false),
  fillLanguage: z.enum(['active', 'zh', 'en']).default('active'),
  recentPages: z.array(RecentPageSchema).max(RECENT_PAGES_MAX).default([]),
});

export type RecentPage = z.infer<typeof RecentPageSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
export type FillLanguage = AppState['fillLanguage'];

export function defaultAppState(overrides?: Partial<AppState>): AppState {
  return AppStateSchema.parse({ version: 1, ...overrides });
}

export interface AppStateStore {
  /** Null when nothing is stored. Throws on corrupt data (bad JSON, schema mismatch, decryption failure). */
  load(): Promise<AppState | null>;
  /** Validate and store; throws (writing nothing) when invalid. Resolves to what was stored. */
  save(state: AppState): Promise<AppState>;
  /** Remove the stored state (load then returns null). */
  clear(): Promise<void>;
}

/** The native side (see ProfileVaultPlugin.java): files/state.enc, same key and sealed format as the profile. */
export interface AppStateVaultPlugin {
  readState(): Promise<{ data: string | null }>;
  writeState(options: { data: string }): Promise<void>;
  clearState(): Promise<void>;
}

/** A store over raw string reads and writes. Every call runs one at a time, in call order. */
function createSerializedAppStateStore(
  read: () => Promise<string | null>,
  write: (data: string) => Promise<void>,
  remove: () => Promise<void>,
): AppStateStore {
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    load: () =>
      exclusive(async () => {
        const data = await read();
        return data === null ? null : AppStateSchema.parse(JSON.parse(data));
      }),
    save: (state) =>
      exclusive(async () => {
        const parsed = AppStateSchema.parse(state);
        await write(JSON.stringify(parsed));
        return parsed;
      }),
    clear: () => exclusive(remove),
  };
}

export function createVaultAppStateStore(vault: AppStateVaultPlugin): AppStateStore {
  return createSerializedAppStateStore(
    async () => (await vault.readState()).data ?? null,
    (data) => vault.writeState({ data }),
    () => vault.clearState(),
  );
}

export const APP_STATE_KEY = 'raf.appState';

export function createLocalStorageAppStateStore(storage: Storage, key: string = APP_STATE_KEY): AppStateStore {
  return createSerializedAppStateStore(
    async () => storage.getItem(key),
    async (data) => storage.setItem(key, data),
    async () => storage.removeItem(key),
  );
}

/** In-memory store, optionally seeded with a raw (unvalidated) state. */
export function createMemoryAppStateStore(initial?: unknown): AppStateStore {
  let data: string | null = initial === undefined ? null : JSON.stringify(initial);
  return createSerializedAppStateStore(
    async () => data,
    async (next) => {
      data = next;
    },
    async () => {
      data = null;
    },
  );
}
