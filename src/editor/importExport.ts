// JSON import/export of the whole profile. Attachment blobs are never part of the export.
import { migrateProfile, type Profile } from '../schema';

export type ImportErrorCode = 'invalid_json' | 'invalid_profile';
export type ImportResult =
  | { ok: true; profile: Profile }
  | { ok: false; code: ImportErrorCode; message: string };

/** Pretty-printed profile JSON (attachment ids are kept; the files themselves are not exported). */
export function exportProfile(profile: Profile): string {
  return JSON.stringify(profile, null, 2);
}

/**
 * Parse and validate an exported profile (older schema versions are migrated).
 * Never throws; `message` is the raw validation detail, `code` lets the UI pick a translated headline.
 */
export function parseProfileJson(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, code: 'invalid_json', message: error instanceof Error ? error.message : String(error) };
  }
  try {
    return { ok: true, profile: migrateProfile(raw) };
  } catch (error) {
    return { ok: false, code: 'invalid_profile', message: error instanceof Error ? error.message : String(error) };
  }
}
