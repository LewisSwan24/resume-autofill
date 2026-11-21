// App state of the mobile app (version 2): onboarding, fill language, the application records (网申记录),
// reminder, clipboard and resume keyboard settings. Not resume content, but it says where the person applies, so on
// the device it is encrypted like the profile (files/state.enc through the ProfileVault plugin). One contract, three backends: vault,
// localStorage (desktop browser preview) and memory (tests). Older versions are migrated on load (appStateMigrate).
import { z } from 'zod';
import { KEYBOARD_GROUP_IDS } from '../keyboard/keyboardData';
import { migrateAppState } from './appStateMigrate';

// Legacy v1 types live with the migration (no import cycle at load time); re-exported for the legacy helpers.
export { RecentPageSchema, type RecentPage } from './appStateMigrate';

export const APPLICATIONS_MAX = 500;
export const UNTOUCHED_MAX = 30;
export const HISTORY_MAX = 20;
export const DISMISSED_MAX = 20;
/** Legacy, v1 only. */
export const RECENT_PAGES_MAX = 30;
/** Same cap as browser/model/advance.ts rememberSite. */
export const ADVANCE_SITES_MAX = 100;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** The YYYY-MM-DD string names a day that exists (no 2026-02-30). */
function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const ApplicationStatusSchema = z.enum(['wish', 'filling', 'submitted', 'interview', 'closed']);
export const ApplicationOutcomeSchema = z.enum(['pending', 'offer', 'rejected', 'withdrawn']);
export const DeadlineSchema = z.object({ date: z.string().regex(YMD).refine(isRealDate), time: z.string().regex(HHMM).optional() });
export const FillEntrySchema = z.object({
  at: z.number().int().nonnegative(),
  resumeId: z.string().min(1).max(64).optional(),
  variantId: z.string().min(1).max(64).optional(),
  variantTitle: z.string().min(1).max(120).optional(),
  locale: z.string().max(16).optional(),
  filled: z.number().int().min(0).max(10_000),
  attention: z.number().int().min(0).max(10_000),
  skipped: z.number().int().min(0).max(10_000),
  undone: z.boolean().default(false),
});
export const ApplicationRecordSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().max(2048).refine(isHttpUrl),
  host: z.string().min(1).max(253),
  title: z.string().max(80).optional(),
  company: z.string().max(80).default(''),
  companyGuessed: z.boolean().default(true),
  position: z.string().max(80).default(''),
  status: ApplicationStatusSchema.default('wish'),
  outcome: ApplicationOutcomeSchema.optional(),
  variantId: z.string().min(1).max(64).optional(),
  variantTitle: z.string().min(1).max(120).optional(),
  statusAt: z.number().int().nonnegative(),
  deadline: DeadlineSchema.optional(),
  remind: z.boolean().default(false),
  notes: z.string().max(1000).default(''),
  createdAt: z.number().int().nonnegative(),
  openedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  history: z.array(FillEntrySchema).max(HISTORY_MAX).default([]),
});
export const ReminderSettingsSchema = z.object({
  time: z.string().regex(HHMM).default('09:00'),
  dayBefore: z.boolean().default(true),
  dayOf: z.boolean().default(true),
  defaultOn: z.boolean().default(false),
});
export const ClipboardSettingsSchema = z.object({
  offer: z.boolean().default(true),
  lastStamp: z.number().int().nonnegative().nullable().default(null),
  dismissed: z.array(z.string().regex(/^[0-9a-f]{32}$/)).max(DISMISSED_MAX).default([]),
});
/** The resume keyboard: 「在输入法里显示简历」 and the groups hidden from it. Belongs to this
 *  phone, so it is never exported. An unknown group id drops the whole list (catch), never the state. */
export const KeyboardSettingsSchema = z.object({
  show: z.boolean().default(true),
  hidden: z.array(z.enum(KEYBOARD_GROUP_IDS)).max(KEYBOARD_GROUP_IDS.length).default([]).catch([]),
});
export const AppStateSchema = z.object({
  version: z.literal(2),
  onboardingDone: z.boolean().default(false),
  fillLanguage: z.enum(['active', 'zh', 'en']).default('active'),
  applications: z.array(ApplicationRecordSchema).max(APPLICATIONS_MAX).default([]),
  reminders: ReminderSettingsSchema.prefault({}),
  clipboard: ClipboardSettingsSchema.prefault({}),
  keyboard: KeyboardSettingsSchema.prefault({}),
  /** Sites (origins) where the person agreed to auto-advance in the fill browser: asked once per site. */
  advanceSites: z.array(z.string().max(2048)).max(ADVANCE_SITES_MAX).default([]).catch([]),
});

export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;
export type FillEntry = z.infer<typeof FillEntrySchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type ReminderSettings = z.infer<typeof ReminderSettingsSchema>;
export type ClipboardSettings = z.infer<typeof ClipboardSettingsSchema>;
export type KeyboardSettings = z.infer<typeof KeyboardSettingsSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
export type FillLanguage = AppState['fillLanguage'];
export type { AppStateV1 } from './appStateMigrate';

export function defaultAppState(overrides?: Partial<AppState>): AppState {
  return AppStateSchema.parse({ ...overrides, version: 2 });
}

export interface AppStateStore {
  /** Null when nothing is stored. Older versions come back migrated to v2. Throws AppStateTooNewError for a newer
   *  version and a plain error on corrupt data (bad JSON, schema mismatch, decryption failure). */
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
        return data === null ? null : migrateAppState(JSON.parse(data));
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
