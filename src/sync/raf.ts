// Chunked encrypted `.raf` v2 container (STORED ZIP + PBKDF2-SHA256 + per-chunk AES-256-GCM + SHA-256 deduped attachments).
import { z } from 'zod';
import { ATTACHMENT_SLOTS } from '../editor';
import { migrateProfile, type Profile } from '../schema';
import { ApplicationRecordSchema, type ApplicationRecord } from '../tracker/schema';
import { buildZip, isZipArchive, parseZip } from './zip';

export const RAF_FORMAT = 'resume-autofill-raf';
export const RAF_VERSION = 2 as const;
export const RAF_V3_VERSION = 3 as const;
export const RAF_PBKDF2_ITERATIONS = 600_000;
/** Manifest PBKDF2 bounds: never weaker than the default, never so slow that opening a file hangs the device. */
export const RAF_MIN_ITERATIONS = RAF_PBKDF2_ITERATIONS;
export const RAF_MAX_ITERATIONS = 2_000_000;
/** Legacy v1 envelopes keep their original accepted range. */
const V1_MIN_ITERATIONS = 100_000;
const V1_MAX_ITERATIONS = 5_000_000;
/** Marks a manifest whose canonical SHA-256 is bound into the core chunk's AAD. */
export const RAF_INTEGRITY = 'manifest-sha256-v1' as const;
const KEY_CHECK_ENTRY = 'check.enc';
const KEY_CHECK_PLAINTEXT = 'resume-autofill-raf key check';
export const RAF_MIN_PASSWORD_LENGTH = 8;

const V1_FORMAT = 'resume-autofill-encrypted';

export type SyncMode = 'light' | 'full';

export type RafErrorCode =
  | 'wrong_password'
  | 'bad_archive'
  | 'unsupported_version'
  | 'invalid_core'
  /** The archive (manifest or any encrypted chunk) was altered or is damaged. */
  | 'tampered'
  /** Written before manifest authentication; the sender must export again. */
  | 'outdated_archive';

export class RafError extends Error {
  readonly code: RafErrorCode;
  constructor(code: RafErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RafError';
    this.code = code;
  }
}

export interface SyncAttachmentInput {
  /** Original attachment id referenced by resumes (`resume.attachments[slot]`). */
  id: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface SyncAttachmentMeta {
  hash: string;
  name: string;
  type: string;
  size: number;
  iv: string;
  /** Original attachment ids across resumes that point to this deduplicated SHA-256 payload. */
  sourceIds: string[];
}

/** An attachment left out of a v3 delta because the receiver already holds the same bytes. */
export interface SkippedAttachmentMeta {
  hash: string;
  /** Sender-side attachment ids that the receiver must map to its own file with this hash. */
  sourceIds: string[];
}

export interface RafDeltaMeta {
  sinceUpdatedAt?: number;
  skippedHashes: string[];
  skipped: SkippedAttachmentMeta[];
  totalAttachmentCount: number;
}

export interface RafManifest {
  format: typeof RAF_FORMAT;
  version: typeof RAF_VERSION | typeof RAF_V3_VERSION;
  integrity: typeof RAF_INTEGRITY;
  mode: SyncMode;
  createdAt: number;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  core: {
    iv: string;
    size: number;
  };
  attachments: SyncAttachmentMeta[];
  delta?: RafDeltaMeta;
}

const ManifestSchema = z.object({
  format: z.literal(RAF_FORMAT),
  version: z.number().int(),
  integrity: z.literal(RAF_INTEGRITY).optional(),
  mode: z.enum(['light', 'full']),
  createdAt: z.number().int().nonnegative(),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    hash: z.literal('SHA-256'),
    iterations: z.number().int().min(RAF_MIN_ITERATIONS).max(RAF_MAX_ITERATIONS),
    salt: z.string().min(16),
  }),
  core: z.object({
    iv: z.string().min(12),
    size: z.number().int().nonnegative(),
  }),
  attachments: z.array(
    z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      name: z.string().min(1).max(255),
      type: z.string().max(128),
      size: z.number().int().nonnegative(),
      iv: z.string().min(12),
      sourceIds: z.array(z.string().min(1)).min(1),
    }),
  ),
  delta: z
    .object({
      sinceUpdatedAt: z.number().int().nonnegative().optional(),
      skippedHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(500),
      skipped: z
        .array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), sourceIds: z.array(z.string().min(1)).min(1) }))
        .max(500),
      totalAttachmentCount: z.number().int().nonnegative(),
    })
    .optional(),
});

export interface UnlockedAttachment {
  hash: string;
  name: string;
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
  sourceIds: string[];
}

export interface UnlockedSyncPayload {
  format: 'raf-v3' | 'raf-v2' | 'v1-encrypted' | 'plain-json';
  mode: SyncMode;
  profile: Profile;
  tracker: ApplicationRecord[];
  attachments: UnlockedAttachment[];
  skippedHashes?: string[];
  /** v3 delta: attachments the receiver must already hold, matched by SHA-256. */
  skipped?: SkippedAttachmentMeta[];
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', own(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

async function deriveAesKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    own(enc.encode(password.normalize('NFC'))),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptChunk(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<{ iv: string; cipher: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(12);
  const sealed = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: own(enc.encode(aad)), tagLength: 128 },
    key,
    own(plaintext),
  );
  return { iv: toBase64(iv), cipher: new Uint8Array(sealed) };
}

async function decryptChunk(
  key: CryptoKey,
  cipher: Uint8Array,
  ivB64: string,
  aad: string,
  failure: RafErrorCode = 'wrong_password',
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = fromBase64(ivB64);
  if (!iv || iv.byteLength !== 12) throw new RafError(failure === 'wrong_password' ? 'bad_archive' : failure, 'Invalid IV');
  try {
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: own(enc.encode(aad)), tagLength: 128 },
      key,
      own(cipher),
    );
    return own(new Uint8Array(plain));
  } catch {
    throw new RafError(failure);
  }
}

/** Deterministic JSON: object keys sorted at every level, arrays kept in order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the canonical manifest without `core.iv`, the only value produced after the core is encrypted. */
async function manifestDigest(manifest: unknown): Promise<string> {
  const copy = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  const core = copy.core;
  if (core && typeof core === 'object' && !Array.isArray(core)) delete (core as Record<string, unknown>).iv;
  return sha256Hex(enc.encode(canonicalJson(copy)));
}

const coreAad = (ver: number, digest: string) => `${RAF_FORMAT}/${ver}/core.enc/manifest-sha256:${digest}`;
const keyCheckAad = (ver: number) => `${RAF_FORMAT}/${ver}/${KEY_CHECK_ENTRY}`;

export interface BuildRafInput {
  profile: Profile;
  tracker?: readonly ApplicationRecord[];
  attachments?: readonly SyncAttachmentInput[];
  mode: SyncMode;
  password: string;
  now?: number;
  iterations?: number;
  /** Target container version: v3 supports incremental attachment skipping via `knownAttachmentHashes`. */
  version?: 2 | 3;
  knownAttachmentHashes?: readonly string[];
  sinceUpdatedAt?: number;
}

/** Package profile, tracker records, and optional SHA-256 deduped (or v3 delta-skipped) attachments into `.raf`. */
export async function buildRafArchive(input: BuildRafInput): Promise<Uint8Array<ArrayBuffer>> {
  const iterations = input.iterations ?? RAF_PBKDF2_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < RAF_MIN_ITERATIONS || iterations > RAF_MAX_ITERATIONS) {
    throw new RangeError(`PBKDF2 iterations must be between ${RAF_MIN_ITERATIONS} and ${RAF_MAX_ITERATIONS}`);
  }
  const now = input.now ?? Date.now();
  const isDelta = input.version === 3 || input.knownAttachmentHashes !== undefined || input.sinceUpdatedAt !== undefined;
  const targetVersion = isDelta ? RAF_V3_VERSION : RAF_VERSION;
  const salt = randomBytes(16);
  const key = await deriveAesKey(input.password, salt, iterations);

  const resumesForPayload =
    isDelta && typeof input.sinceUpdatedAt === 'number'
      ? input.profile.resumes.filter((r) => r.updatedAt > input.sinceUpdatedAt!)
      : input.profile.resumes;

  const trackerRecords = [...(input.tracker ?? [])];
  const corePayload = {
    ...input.profile,
    resumes: resumesForPayload,
    ...(trackerRecords.length > 0
      ? {
          mobileTracker: {
            format: 'resume-autofill-mobile-tracker',
            version: 1,
            applications: trackerRecords,
          },
        }
      : {}),
  };
  const coreBytes = own(enc.encode(JSON.stringify(corePayload)));

  const zipEntries: { name: string; data: Uint8Array }[] = [];
  const attachmentMetas: SyncAttachmentMeta[] = [];
  const knownSet = new Set(input.knownAttachmentHashes ?? []);
  const skippedHashes: string[] = [];
  const skipped: SkippedAttachmentMeta[] = [];
  let totalAttachmentCount = 0;

  if (input.mode === 'full' && input.attachments && input.attachments.length > 0) {
    // Deduplicate identical attachment payloads by SHA-256 and remember every referenced sourceId.
    const referencedIds = new Set<string>();
    for (const r of input.profile.resumes) {
      for (const slot of ATTACHMENT_SLOTS) {
        const id = r.attachments[slot];
        if (id) referencedIds.add(id);
      }
    }

    const byHash = new Map<string, { item: SyncAttachmentInput; sourceIds: string[] }>();
    for (const item of input.attachments) {
      if (referencedIds.size > 0 && !referencedIds.has(item.id)) continue;
      const hash = await sha256Hex(item.bytes);
      const existing = byHash.get(hash);
      if (existing) {
        if (!existing.sourceIds.includes(item.id)) existing.sourceIds.push(item.id);
      } else {
        byHash.set(hash, { item, sourceIds: [item.id] });
      }
    }

    totalAttachmentCount = byHash.size;
    for (const [hash, { item, sourceIds }] of byHash.entries()) {
      if (isDelta && knownSet.has(hash)) {
        skippedHashes.push(hash);
        skipped.push({ hash, sourceIds: [...sourceIds] });
        continue;
      }
      const aad = `${RAF_FORMAT}/${targetVersion}/attachments/${hash}`;
      const encrypted = await encryptChunk(key, item.bytes, aad);
      zipEntries.push({ name: `attachments/${hash}.enc`, data: encrypted.cipher });
      attachmentMetas.push({
        hash,
        name: item.name,
        type: item.type,
        size: item.bytes.byteLength,
        iv: encrypted.iv,
        sourceIds,
      });
    }
  }

  const manifest: RafManifest = {
    format: RAF_FORMAT,
    version: targetVersion,
    integrity: RAF_INTEGRITY,
    mode: input.mode,
    createdAt: now,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: toBase64(salt),
    },
    core: {
      iv: '',
      size: coreBytes.byteLength,
    },
    attachments: attachmentMetas,
    ...(isDelta
      ? {
          delta: {
            ...(typeof input.sinceUpdatedAt === 'number' ? { sinceUpdatedAt: input.sinceUpdatedAt } : {}),
            skippedHashes,
            skipped,
            totalAttachmentCount,
          },
        }
      : {}),
  };

  // Bind every manifest field into the core chunk: any later edit to the manifest fails to unlock.
  const digest = await manifestDigest(manifest);
  const coreEncrypted = await encryptChunk(key, coreBytes, coreAad(targetVersion, digest));
  manifest.core.iv = coreEncrypted.iv;
  // A manifest-independent key check tells a wrong password apart from an altered manifest.
  const keyCheck = await encryptChunk(key, enc.encode(KEY_CHECK_PLAINTEXT), keyCheckAad(targetVersion));
  const keyCheckIv = fromBase64(keyCheck.iv)!;
  const keyCheckBytes = new Uint8Array(keyCheckIv.byteLength + keyCheck.cipher.byteLength);
  keyCheckBytes.set(keyCheckIv);
  keyCheckBytes.set(keyCheck.cipher, keyCheckIv.byteLength);

  return buildZip([
    { name: 'manifest.json', data: own(enc.encode(JSON.stringify(manifest, null, 2))) },
    { name: KEY_CHECK_ENTRY, data: keyCheckBytes },
    { name: 'core.enc', data: coreEncrypted.cipher },
    ...zipEntries,
  ]);
}

/** Extract tracker records from either mobile's `{ applications }` wrapper or extension's raw array. */
export function extractTrackerFromParsed(raw: unknown): ApplicationRecord[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;
  const rawTracker = obj.mobileTracker;
  const candidateList: unknown[] = Array.isArray(rawTracker)
    ? rawTracker
    : typeof rawTracker === 'object' && rawTracker !== null && Array.isArray((rawTracker as Record<string, unknown>).applications)
      ? ((rawTracker as Record<string, unknown>).applications as unknown[])
      : [];
  const out: ApplicationRecord[] = [];
  for (const item of candidateList) {
    const parsed = ApplicationRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Inspect an incoming sync archive without requiring a password yet. */
export function inspectSyncArchive(bytes: Uint8Array):
  | { kind: 'raf-v2' | 'raf-v3'; manifest: RafManifest }
  | { kind: 'v1-encrypted'; envelopeText: string }
  | { kind: 'plain-json'; text: string }
  | { kind: 'invalid' } {
  if (isZipArchive(bytes)) {
    try {
      const entries = parseZip(bytes);
      const manifestRaw = entries.get('manifest.json');
      if (!manifestRaw || !entries.has('core.enc')) return { kind: 'invalid' };
      const parsed = ManifestSchema.safeParse(JSON.parse(dec.decode(manifestRaw)));
      if (!parsed.success) return { kind: 'invalid' };
      if (parsed.data.version !== RAF_VERSION && parsed.data.version !== RAF_V3_VERSION) {
        return { kind: 'invalid' };
      }
      return {
        kind: parsed.data.version === RAF_V3_VERSION ? 'raf-v3' : 'raf-v2',
        manifest: parsed.data as RafManifest,
      };
    } catch {
      return { kind: 'invalid' };
    }
  }
  try {
    const text = dec.decode(bytes);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && parsed.format === V1_FORMAT) {
      return { kind: 'v1-encrypted', envelopeText: text };
    }
    return { kind: 'plain-json', text };
  } catch {
    return { kind: 'invalid' };
  }
}

async function decryptV1Envelope(text: string, password: string): Promise<UnlockedSyncPayload> {
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new RafError('bad_archive');
  }
  if (env.format !== V1_FORMAT) throw new RafError('bad_archive');
  if (env.version !== 1) throw new RafError('unsupported_version');
  const kdf = env.kdf as Record<string, unknown> | undefined;
  const cipher = env.cipher as Record<string, unknown> | undefined;
  if (!kdf || !cipher || typeof kdf.salt !== 'string' || typeof kdf.iterations !== 'number' || typeof cipher.iv !== 'string' || typeof env.data !== 'string') {
    throw new RafError('bad_archive');
  }
  if (kdf.iterations < V1_MIN_ITERATIONS || kdf.iterations > V1_MAX_ITERATIONS) throw new RafError('bad_archive');
  const salt = fromBase64(kdf.salt);
  const cipherBytes = fromBase64(env.data);
  if (!salt || !cipherBytes) throw new RafError('bad_archive');

  const key = await deriveAesKey(password, salt, kdf.iterations);
  const plainBytes = await decryptChunk(key, cipherBytes, cipher.iv, `${V1_FORMAT}/1`);
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(dec.decode(plainBytes));
  } catch {
    throw new RafError('invalid_core');
  }
  try {
    const profile = migrateProfile(rawJson);
    const tracker = extractTrackerFromParsed(rawJson);
    return { format: 'v1-encrypted', mode: 'light', profile, tracker, attachments: [] };
  } catch {
    throw new RafError('invalid_core');
  }
}

/** Decrypt and unpack `.raf` v2 archives (or legacy v1 encrypted / plain JSON when passed). */
export async function unlockSyncArchive(bytes: Uint8Array, password?: string): Promise<UnlockedSyncPayload> {
  const inspected = inspectSyncArchive(bytes);
  if (inspected.kind === 'invalid') throw new RafError('bad_archive');

  if (inspected.kind === 'plain-json') {
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(inspected.text);
    } catch {
      throw new RafError('bad_archive');
    }
    try {
      return {
        format: 'plain-json',
        mode: 'light',
        profile: migrateProfile(rawJson),
        tracker: extractTrackerFromParsed(rawJson),
        attachments: [],
      };
    } catch {
      throw new RafError('invalid_core');
    }
  }

  if (inspected.kind === 'v1-encrypted') {
    if (!password) throw new RafError('wrong_password');
    return decryptV1Envelope(inspected.envelopeText, password);
  }

  if (!password) throw new RafError('wrong_password');
  const entries = parseZip(bytes);
  const { manifest } = inspected;
  const ver = manifest.version;
  if (manifest.integrity !== RAF_INTEGRITY) throw new RafError('outdated_archive');
  const salt = fromBase64(manifest.kdf.salt);
  if (!salt) throw new RafError('bad_archive', 'Invalid KDF salt');
  let digest: string;
  try {
    // Hash the manifest exactly as stored, so even fields this version ignores are covered.
    digest = await manifestDigest(JSON.parse(dec.decode(entries.get('manifest.json')!)));
  } catch {
    throw new RafError('bad_archive');
  }

  const key = await deriveAesKey(password, salt, manifest.kdf.iterations);
  const keyCheck = entries.get(KEY_CHECK_ENTRY);
  if (!keyCheck || keyCheck.byteLength <= 12) throw new RafError('tampered', `Missing ${KEY_CHECK_ENTRY}`);
  await decryptChunk(key, keyCheck.subarray(12), toBase64(keyCheck.subarray(0, 12)), keyCheckAad(ver), 'wrong_password');
  const coreCipher = entries.get('core.enc');
  if (!coreCipher) throw new RafError('tampered', 'Missing core.enc');
  const corePlain = await decryptChunk(key, coreCipher, manifest.core.iv, coreAad(ver, digest), 'tampered');

  let rawJson: unknown;
  let profile: Profile;
  try {
    rawJson = JSON.parse(dec.decode(corePlain));
    profile = migrateProfile(rawJson);
  } catch {
    throw new RafError('invalid_core');
  }
  const tracker = extractTrackerFromParsed(rawJson);

  const attachments: UnlockedAttachment[] = [];
  for (const meta of manifest.attachments) {
    const chunk = entries.get(`attachments/${meta.hash}.enc`);
    if (!chunk) throw new RafError('tampered', `Missing attachment ${meta.hash}`);
    const plainBytes = await decryptChunk(key, chunk, meta.iv, `${RAF_FORMAT}/${ver}/attachments/${meta.hash}`, 'tampered');
    if ((await sha256Hex(plainBytes)) !== meta.hash) {
      throw new RafError('tampered', `Hash verification failed for ${meta.name}`);
    }
    attachments.push({
      hash: meta.hash,
      name: meta.name,
      type: meta.type,
      bytes: plainBytes,
      sourceIds: [...meta.sourceIds],
    });
  }

  return {
    format: ver === RAF_V3_VERSION ? 'raf-v3' : 'raf-v2',
    mode: manifest.mode,
    profile,
    tracker,
    attachments,
    ...(manifest.delta
      ? {
          skippedHashes: manifest.delta.skippedHashes,
          skipped: manifest.delta.skipped.map((s) => ({ hash: s.hash, sourceIds: [...s.sourceIds] })),
        }
      : {}),
  };
}
