// Attachment fingerprints (SHA-256) a receiver shares so a sender can build a `.raf` v3 delta without those files.
import { sha256Hex } from './raf';

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Split the "files the receiver already has" box; keep valid SHA-256 hex (case-insensitive), report everything else. */
export function parseKnownHashes(text: string): { hashes: string[]; invalid: string[] } {
  const hashes: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    if (!SHA256_HEX.test(lower)) invalid.push(token);
    else if (!hashes.includes(lower)) hashes.push(lower);
  }
  return { hashes, invalid };
}

/** This device's attachment fingerprints, one per line, deduplicated, for the sender to paste. */
export async function localFingerprintText(files: readonly { bytes: Uint8Array }[]): Promise<string> {
  const hashes = new Set<string>();
  for (const f of files) hashes.add(await sha256Hex(f.bytes));
  return [...hashes].join('\n');
}
