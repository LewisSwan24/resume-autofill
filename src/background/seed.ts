// First-run seeding: sample resumes + attachments, only when the user has nothing yet.
import type { FileData } from '../drivers/types';
import { createSampleFiles, createSampleProfile } from '../schema';
import { loadProfile, putFile, saveProfile } from '../storage';

/** `data:<type>;base64,<payload>` → Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Not a data URL');
  const [, type = '', params = '', payload = ''] = match;
  const binary = params.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0) & 0xff);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

/** Store sample files under their own ids (overwriting is harmless: same content). */
export async function putFileData(id: string, file: FileData): Promise<void> {
  await putFile({ id, name: file.name, type: file.type, blob: dataUrlToBlob(file.dataUrl) });
}

/**
 * Seed the sample profile and its files when no resume exists. Idempotent: resolves to `false`
 * (and writes nothing) when the profile already has resumes or cannot be read (corrupt data is
 * never overwritten). Files are written first so a stored profile never points at missing files.
 */
export async function seedSamplesIfEmpty(): Promise<boolean> {
  let current;
  try {
    current = await loadProfile();
  } catch {
    return false;
  }
  if (current.resumes.length > 0) return false;

  for (const [id, file] of Object.entries(createSampleFiles())) await putFileData(id, file);
  // Keep settings the user may have changed before the first resume existed.
  await saveProfile({ ...createSampleProfile(), settings: current.settings });
  return true;
}
