// Export and import of the whole profile on the phone. The plain export is exactly the desktop extension's
// exportProfile() text, so its 「导入 JSON」 reads it; the password export wraps that text (exportCrypto.ts).
// Attachment files never travel: their ids are kept, and on import ids missing on this phone are dropped.
// The 网申 records can ride along under one extra key (mobileTracker) that the extension ignores.
import {
  ATTACHMENT_SLOTS,
  MODULES,
  exportProfile,
  parseProfileJson,
  pruneMissingAttachments,
} from '../../../../src/editor';
import { ProfileSchema, type Locale, type Profile, type Resume } from '../../../../src/schema';
import { isModuleFilled } from '../home/summary';
import type { AppState } from '../store/appStateStore';
import { sameResumeContent } from '../store/profileStore';
import { readTracker, withTracker, type TrackerRead } from '../tracker/model/trackerTransfer';
import { ExportCryptoError, decryptExport, encryptExport, isEncryptedExport } from './exportCrypto';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const PASSWORD_MIN_LENGTH = 8;

export interface ExportFile {
  name: string;
  mimeType: 'application/json';
  text: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** With `tracker` holding records, the plain text also carries them (withTracker); otherwise exactly exportProfile. */
export async function buildExport(profile: Profile, options: { password?: string; now: number; tracker?: AppState }): Promise<ExportFile> {
  const plain =
    options.tracker && options.tracker.applications.length > 0 ? withTracker(exportProfile(profile), options.tracker) : exportProfile(profile);
  const base = `resume-autofill-profile-${localDate(options.now)}`;
  if (options.password) {
    return { name: `${base}-encrypted.json`, mimeType: 'application/json', text: await encryptExport(plain, options.password) };
  }
  return { name: `${base}.json`, mimeType: 'application/json', text: plain };
}

export type ImportErrorCode =
  | 'too_large'
  | 'read'
  | 'invalid_json'
  | 'invalid_profile'
  | 'bad_envelope'
  | 'unsupported_version';

export type ImportRead =
  | { kind: 'profile'; profile: Profile; tracker: TrackerRead }
  | { kind: 'encrypted'; envelope: string }
  | { kind: 'error'; code: ImportErrorCode };

function tooLarge(text: string): boolean {
  if (text.length > IMPORT_MAX_BYTES) return true; // every UTF-16 unit is at least one UTF-8 byte
  if (text.length * 3 <= IMPORT_MAX_BYTES) return false;
  return new TextEncoder().encode(text).length > IMPORT_MAX_BYTES;
}

function parsePlain(text: string): ImportRead {
  const parsed = parseProfileJson(text);
  return parsed.ok ? { kind: 'profile', profile: parsed.profile, tracker: readTracker(text) } : { kind: 'error', code: parsed.code };
}

/** What a chosen file holds: a profile (migrated and validated), an encrypted envelope, or an error. */
export function readImport(text: string): ImportRead {
  if (tooLarge(text)) return { kind: 'error', code: 'too_large' };
  if (isEncryptedExport(text)) return { kind: 'encrypted', envelope: text };
  return parsePlain(text);
}

/** Decrypt and read an envelope. A wrong password throws ExportCryptoError('wrong_password') so it can be retried. */
export async function unlockImport(envelope: string, password: string): Promise<ImportRead> {
  let plain: string;
  try {
    plain = await decryptExport(envelope, password);
  } catch (error) {
    if (error instanceof ExportCryptoError && error.code !== 'wrong_password') return { kind: 'error', code: error.code };
    throw error;
  }
  // An envelope inside an envelope is not something we write.
  if (isEncryptedExport(plain)) return { kind: 'error', code: 'invalid_profile' };
  return parsePlain(plain);
}

const filledModules = (resume: Resume) => MODULES.filter((m) => isModuleFilled(m, resume)).length;

function attachmentIds(profile: Profile): Set<string> {
  const ids = new Set<string>();
  for (const r of profile.resumes) {
    for (const slot of ATTACHMENT_SLOTS) {
      const id = r.attachments[slot];
      if (id) ids.add(id);
    }
  }
  return ids;
}

export interface ImportPreview {
  resumes: { id: string; title: string; locale: Locale; filledModules: number }[];
  /** Attachment ids in the file not present in `existingFileIds`. */
  missingAttachments: number;
  /** Same id as a resume on the phone, different content. */
  conflicts: number;
}

export function previewImport(incoming: Profile, current: Profile, existingFileIds: ReadonlySet<string>): ImportPreview {
  const pruned = pruneMissingAttachments(incoming, existingFileIds);
  const onPhone = new Map(current.resumes.map((r) => [r.id, r]));
  return {
    resumes: incoming.resumes.map((r) => ({ id: r.id, title: r.title, locale: r.locale, filledModules: filledModules(r) })),
    missingAttachments: [...attachmentIds(incoming)].filter((id) => !existingFileIds.has(id)).length,
    conflicts: pruned.resumes.filter((r) => {
      const mine = onPhone.get(r.id);
      return mine !== undefined && !sameResumeContent(mine, r);
    }).length,
  };
}

/** The incoming profile, settings included, with attachment ids missing on this phone dropped. */
export function replaceWith(incoming: Profile, existingFileIds: ReadonlySet<string>): Profile {
  return ProfileSchema.parse(pruneMissingAttachments(incoming, existingFileIds));
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Add the incoming resumes to the phone's: new ids appended, identical same-id ones skipped, differing same-id ones
 * appended as a copy (new id, title + `copySuffix`). Links among appended resumes are remapped; links to a resume
 * that is neither imported nor on the phone are dropped. Settings and the active resume stay the phone's.
 */
export function mergeInto(
  current: Profile,
  incoming: Profile,
  existingFileIds: ReadonlySet<string>,
  options: { copySuffix: string; newId?: () => string },
): { profile: Profile; added: number; skipped: number } {
  const newId = options.newId ?? randomId;
  const pruned = pruneMissingAttachments(incoming, existingFileIds);
  const onPhone = new Map(current.resumes.map((r) => [r.id, r]));
  const used = new Set(onPhone.keys());
  const idMap = new Map<string, string>();
  const appended: Resume[] = [];
  let skipped = 0;

  for (const r of pruned.resumes) {
    const mine = onPhone.get(r.id);
    if (mine === undefined && !used.has(r.id)) {
      appended.push({ ...r });
      used.add(r.id);
      idMap.set(r.id, r.id);
    } else if (mine !== undefined && sameResumeContent(mine, r)) {
      skipped += 1;
      if (!idMap.has(r.id)) idMap.set(r.id, r.id);
    } else {
      let id = newId();
      while (used.has(id)) id = newId();
      used.add(id);
      appended.push({ ...r, id, title: `${r.title}${options.copySuffix}` });
      if (!idMap.has(r.id)) idMap.set(r.id, id);
    }
  }

  const linked = appended.map((r) => {
    if (r.linkedResumeId === undefined) return r;
    const target = idMap.get(r.linkedResumeId) ?? (onPhone.has(r.linkedResumeId) ? r.linkedResumeId : undefined);
    const { linkedResumeId: _dropped, ...rest } = r;
    return target === undefined || target === r.id ? rest : { ...rest, linkedResumeId: target };
  });

  const activeOnPhone = current.resumes.some((r) => r.id === current.activeResumeId) ? current.activeResumeId : null;
  const profile = ProfileSchema.parse({
    ...current,
    resumes: [...current.resumes, ...linked],
    activeResumeId: activeOnPhone ?? linked[0]?.id ?? current.resumes[0]?.id ?? null,
  });
  return { profile, added: appended.length, skipped };
}
