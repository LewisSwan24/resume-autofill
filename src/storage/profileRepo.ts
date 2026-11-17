// Profile persistence in `browser.storage.local` (key `profile`).
// Read-modify-write operations are serialised inside one JS context. Cross-context races
// (e.g. options page vs. service worker) are last-writer-wins, which is fine for a single user.
import { browser } from 'wxt/browser';
import {
  CURRENT_SCHEMA_VERSION,
  ProfileSchema,
  ResumeSchema,
  materializeResume,
  migrateProfile,
  type Profile,
  type Resume,
  type ResumeInput,
} from '../schema';
import {
  VAULT_META_KEY,
  changeVaultPassphrase,
  createVaultMetaAndSession,
  decryptProfileWithVault,
  encryptProfileWithVault,
  getVaultMeta,
  getVaultStatus,
  isEncryptedVaultBlob,
  lockVault,
  unlockVaultWithPassphrase,
  type VaultEnableOptions,
  type VaultStatus,
} from './vault';

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

async function readProfile(options?: { touchSession?: boolean }): Promise<Profile> {
  const stored = await browser.storage.local.get(PROFILE_STORAGE_KEY);
  const raw: unknown = stored[PROFILE_STORAGE_KEY];
  if (raw === undefined) return emptyProfile();
  if (isEncryptedVaultBlob(raw)) {
    const decrypted = await decryptProfileWithVault(raw, { touchSession: options?.touchSession ?? true });
    return migrateProfile(decrypted);
  }
  return migrateProfile(raw);
}

async function writeProfile(input: Profile, rawDekOverride?: Uint8Array<ArrayBuffer>): Promise<Profile> {
  const parsed = ProfileSchema.parse(input);
  // Invariant: `activeResumeId` points at an existing resume, and is null only when there are none.
  if (!parsed.resumes.some((r) => r.id === parsed.activeResumeId)) {
    parsed.activeResumeId = parsed.resumes[0]?.id ?? null;
  }
  const vaultMeta = await getVaultMeta();
  // When vault is enabled and locked (unless rawDekOverride is supplied during initialization),
  // refuse writes cleanly with VaultLockedError instead of silently overwriting ciphertext.
  const previous = vaultMeta && !rawDekOverride
    ? await readProfile()
    : await readProfile().catch(() => emptyProfile());
  const before = new Map(previous.resumes.map((r) => [r.id, r]));
  const now = Date.now();
  parsed.resumes = parsed.resumes.map((r) => {
    const old = before.get(r.id);
    return old && sameContent(old, r) ? { ...r, updatedAt: old.updatedAt } : { ...r, updatedAt: now };
  });
  if (vaultMeta || rawDekOverride) {
    const blob = await encryptProfileWithVault(JSON.stringify(parsed), rawDekOverride);
    await browser.storage.local.set({ [PROFILE_STORAGE_KEY]: blob });
  } else {
    await browser.storage.local.set({ [PROFILE_STORAGE_KEY]: parsed });
  }
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

// ------------------------------------------------------------------ one-click switches

/** The interface language a resume reads in: any `zh*` locale is Chinese, everything else English. */
export function resumeLanguage(locale: Resume['locale']): 'zh' | 'en' {
  return locale.startsWith('zh') ? 'zh' : 'en';
}

/**
 * The resume a one-click language switch moves to: the active resume's linked resume when that one is in
 * the other language, otherwise the first resume in the other language. Null when there is none.
 */
export function counterpartResume(profile: Profile): Resume | null {
  const active = profile.resumes.find((r) => r.id === profile.activeResumeId);
  if (!active) return null;
  const language = resumeLanguage(active.locale);
  const other = (r: Resume) => r.id !== active.id && resumeLanguage(r.locale) !== language;
  const linked = profile.resumes.find((r) => r.id === active.linkedResumeId);
  return linked && other(linked) ? linked : (profile.resumes.find(other) ?? null);
}

/** Make `counterpartResume` active. Resolves to it, or to null (nothing written) when there is none. */
export function switchResumeLanguage(): Promise<Resume | null> {
  return exclusive(async () => {
    const p = await readProfile();
    const target = counterpartResume(p);
    if (target) await writeProfile({ ...p, activeResumeId: target.id });
    return target;
  });
}

/** Pin the interface language (replaces "follow the browser"); every surface follows through `watchProfile`. */
export function setUiLanguage(language: 'zh' | 'en'): Promise<void> {
  return exclusive(async () => {
    const p = await readProfile();
    if (p.settings.uiLanguage === language) return;
    await writeProfile({ ...p, settings: { ...p.settings, uiLanguage: language } });
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
        let updated = r;
        if (updated.variantOf === id) {
          // Promote child variant to standalone resume before unlinking parent so no inherited fields are lost.
          const materialized = materializeResume(updated, p.resumes);
          const { variantOf: _v, ...restVariant } = materialized;
          updated = restVariant;
        }
        if (updated.linkedResumeId === id) {
          const { linkedResumeId: _removed, ...rest } = updated;
          updated = rest;
        }
        return updated;
      });
    await writeProfile({ ...p, resumes, activeResumeId: p.activeResumeId === id ? null : p.activeResumeId });
    return true;
  });
}

/** Return the active resume with non-destructive variant inheritance already resolved. */
export async function getMaterializedActiveResume(): Promise<Resume | null> {
  const p = await readProfile();
  const active = p.resumes.find((r) => r.id === p.activeResumeId);
  return active ? materializeResume(active, p.resumes) : null;
}

// ------------------------------------------------------------------ Storage Vault lifecycle

export async function enableProfileVault(passphrase: string, options?: VaultEnableOptions): Promise<VaultStatus> {
  return exclusive(async () => {
    const current = await readProfile();
    const { rawDek } = await createVaultMetaAndSession(passphrase, options);
    await writeProfile(current, rawDek);
    return getVaultStatus();
  });
}

export async function unlockProfileVault(passphrase: string): Promise<Profile> {
  return exclusive(async () => {
    await unlockVaultWithPassphrase(passphrase);
    return readProfile({ touchSession: true });
  });
}

export async function lockProfileVault(): Promise<void> {
  await lockVault();
}

export async function changeProfileVaultPassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  options?: VaultEnableOptions,
): Promise<void> {
  return exclusive(async () => {
    await changeVaultPassphrase(oldPassphrase, newPassphrase, options);
  });
}

export async function disableProfileVault(passphrase: string): Promise<Profile> {
  return exclusive(async () => {
    const rawDek = await unlockVaultWithPassphrase(passphrase);
    const stored = await browser.storage.local.get(PROFILE_STORAGE_KEY);
    const raw = stored[PROFILE_STORAGE_KEY];
    const current = isEncryptedVaultBlob(raw)
      ? migrateProfile(await decryptProfileWithVault(raw, { touchSession: false, rawDekOverride: rawDek }))
      : raw === undefined
        ? emptyProfile()
        : migrateProfile(raw);
    await browser.storage.local.set({ [PROFILE_STORAGE_KEY]: current });
    await browser.storage.local.remove(VAULT_META_KEY);
    await lockVault();
    return current;
  });
}

/**
 * Subscribe to profile changes made in any extension context. The callback receives the new
 * parsed profile (empty profile if the key was removed); unparsable values are skipped.
 * Returns an unsubscribe function.
 */
export function watchProfile(cb: (profile: Profile) => void): () => void {
  let active = true;
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (!active || area !== 'local' || !(PROFILE_STORAGE_KEY in changes)) return;
    const raw = changes[PROFILE_STORAGE_KEY]?.newValue;
    if (isEncryptedVaultBlob(raw)) {
      void decryptProfileWithVault(raw, { touchSession: false })
        .then((decrypted) => {
          if (!active) return;
          try {
            cb(migrateProfile(decrypted));
          } catch {
            // Corrupt or unsupported version: ignore cleanly.
          }
        })
        .catch(() => {
          // Locked vault: wait until unlocked.
        });
      return;
    }
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
  return () => {
    active = false;
    browser.storage.onChanged.removeListener(listener);
  };
}
