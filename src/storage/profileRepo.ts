// Profile persistence in `browser.storage.local` (key `profile`).
// Read-modify-write operations are serialised inside one JS context. Cross-context races
// (e.g. options page vs. service worker) are last-writer-wins, which is fine for a single user.
import { browser } from 'wxt/browser';
import {
  CURRENT_SCHEMA_VERSION,
  ProfileSchema,
  ResumeSchema,
  migrateProfile,
  type Profile,
  type Resume,
  type ResumeInput,
} from '../schema';

export const PROFILE_STORAGE_KEY = 'profile';

// ------------------------------------------------------------------ helpers

function emptyProfile(): Profile {
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

/** Serialises read-modify-write sequences within this JS context. */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readProfile(): Promise<Profile> {
  const stored = await browser.storage.local.get(PROFILE_STORAGE_KEY);
  const raw: unknown = stored[PROFILE_STORAGE_KEY];
  return raw === undefined ? emptyProfile() : migrateProfile(raw);
}

async function writeProfile(input: Profile): Promise<Profile> {
  const parsed = ProfileSchema.parse(input);
  // Invariant: `activeResumeId` points at an existing resume, and is null only when there are none.
  if (!parsed.resumes.some((r) => r.id === parsed.activeResumeId)) {
    parsed.activeResumeId = parsed.resumes[0]?.id ?? null;
  }
  // A corrupt stored profile must not block the user from saving a good one.
  const previous = await readProfile().catch(() => emptyProfile());
  const before = new Map(previous.resumes.map((r) => [r.id, r]));
  const now = Date.now();
  parsed.resumes = parsed.resumes.map((r) => {
    const old = before.get(r.id);
    return old && sameContent(old, r) ? { ...r, updatedAt: old.updatedAt } : { ...r, updatedAt: now };
  });
  await browser.storage.local.set({ [PROFILE_STORAGE_KEY]: parsed });
  return parsed;
}

// ------------------------------------------------------------------ public API

/**
 * Read the stored profile (migrated + validated). Returns an empty valid profile when nothing is
 * stored (samples are seeded by the background, not here). Throws `ProfileMigrationError` when
 * the stored data is corrupt or newer than supported; the stored data is left untouched.
 */
export function loadProfile(): Promise<Profile> {
  return readProfile();
}

/**
 * Validate and store a profile. Throws (without writing) when invalid. Resumes that are new or
 * whose content changed get `updatedAt = now`; unchanged ones keep their stored value. A dangling
 * or null `activeResumeId` falls back to the first resume (null only when there are no resumes).
 * Resolves to the stored profile.
 */
export function saveProfile(profile: Profile): Promise<Profile> {
  return exclusive(() => writeProfile(profile));
}

export async function getActiveResume(): Promise<Resume | null> {
  const p = await readProfile();
  return p.resumes.find((r) => r.id === p.activeResumeId) ?? null;
}

/** Throws when no resume has this id. */
export function setActiveResume(id: string): Promise<void> {
  return exclusive(async () => {
    const p = await readProfile();
    if (!p.resumes.some((r) => r.id === id)) throw new Error(`Resume not found: ${id}`);
    await writeProfile({ ...p, activeResumeId: id });
  });
}

/**
 * Insert or replace (by id, keeping list position) a resume. The first resume ever stored becomes
 * active. Throws for invalid resumes. Resolves to the stored resume.
 */
export function upsertResume(resume: ResumeInput | Resume): Promise<Resume> {
  return exclusive(async () => {
    const parsed = ResumeSchema.parse(resume);
    const p = await readProfile();
    const index = p.resumes.findIndex((r) => r.id === parsed.id);
    const resumes = index < 0 ? [...p.resumes, parsed] : p.resumes.map((r, i) => (i === index ? parsed : r));
    const saved = await writeProfile({ ...p, resumes, activeResumeId: p.activeResumeId ?? parsed.id });
    return saved.resumes.find((r) => r.id === parsed.id)!;
  });
}

/**
 * Delete a resume and clear `linkedResumeId` on resumes that pointed at it. If it was active,
 * the first remaining resume becomes active. Resolves to false when the id is unknown.
 * Attachment files are not removed here (callers decide; see `deleteFile`).
 */
export function deleteResume(id: string): Promise<boolean> {
  return exclusive(async () => {
    const p = await readProfile();
    if (!p.resumes.some((r) => r.id === id)) return false;
    const resumes = p.resumes
      .filter((r) => r.id !== id)
      .map((r) => {
        if (r.linkedResumeId !== id) return r;
        const { linkedResumeId: _removed, ...rest } = r;
        return rest;
      });
    await writeProfile({ ...p, resumes, activeResumeId: p.activeResumeId === id ? null : p.activeResumeId });
    return true;
  });
}

/**
 * Subscribe to profile changes made in any extension context. The callback receives the new
 * parsed profile (empty profile if the key was removed); unparsable values are skipped.
 * Returns an unsubscribe function.
 */
export function watchProfile(cb: (profile: Profile) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(PROFILE_STORAGE_KEY in changes)) return;
    const raw = changes[PROFILE_STORAGE_KEY]?.newValue;
    let profile: Profile;
    try {
      // Removal shows up as `undefined` in Chrome and as `null` in fake-browser.
      profile = raw == null ? emptyProfile() : migrateProfile(raw);
    } catch {
      return; // Corrupt value written by someone else: nothing sensible to report.
    }
    cb(profile);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
