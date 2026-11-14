// Password-protected export: the plain export text sealed with AES-256-GCM under a key derived from the password
// with PBKDF2-HMAC-SHA256. WebCrypto only, fresh salt and IV per export. The envelope is JSON:
//   { format, version: 1, kdf: { name, hash, iterations, salt }, cipher: { name, iv, tagLength }, data }
// Nothing here ever puts the password or the plaintext into an error message.

export const ENCRYPTED_FORMAT = 'resume-autofill-encrypted';
export const EXPORT_PBKDF2_ITERATIONS = 600_000;
export const MIN_IMPORT_ITERATIONS = 100_000;
export const MAX_IMPORT_ITERATIONS = 5_000_000;

const VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BITS = 128;
const AAD = `${ENCRYPTED_FORMAT}/${VERSION}`;

export type ExportCryptoErrorCode = 'wrong_password' | 'bad_envelope' | 'unsupported_version';

export class ExportCryptoError extends Error {
  readonly code: ExportCryptoErrorCode;
  constructor(code: ExportCryptoErrorCode) {
    super(
      code === 'wrong_password'
        ? 'Wrong password, or the file is damaged'
        : code === 'unsupported_version'
          ? 'This encrypted file is from a newer version'
          : 'Not a valid encrypted export',
    );
    this.name = 'ExportCryptoError';
    this.code = code;
  }
}

interface Envelope {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; tagLength: 128 };
  data: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A copy in this realm: WebCrypto under jsdom can reject typed arrays made by another realm's TextEncoder. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

const utf8 = (text: string) => own(new TextEncoder().encode(text));

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Strict base64 to bytes; null when it is not base64. */
function fromBase64(text: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Whether the text is one of our encrypted envelopes (by its format marker; not validated further). */
export function isEncryptedExport(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) && raw.format === ENCRYPTED_FORMAT;
  } catch {
    return false;
  }
}

export async function encryptExport(plain: string, password: string, options?: { iterations?: number }): Promise<string> {
  const iterations = options?.iterations ?? EXPORT_PBKDF2_ITERATIONS;
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, iterations);
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_BITS, additionalData: utf8(AAD) },
    key,
    utf8(plain),
  );
  const envelope: Envelope = {
    format: ENCRYPTED_FORMAT,
    version: VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv), tagLength: TAG_BITS },
    data: toBase64(new Uint8Array(sealed)),
  };
  return JSON.stringify(envelope, null, 2);
}

/** The checked parts of an envelope; throws bad_envelope / unsupported_version before any key derivation. */
function readEnvelope(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ExportCryptoError('bad_envelope');
  }
  if (!isRecord(raw) || raw.format !== ENCRYPTED_FORMAT) throw new ExportCryptoError('bad_envelope');
  if (raw.version !== VERSION) {
    throw new ExportCryptoError(typeof raw.version === 'number' ? 'unsupported_version' : 'bad_envelope');
  }
  const { kdf, cipher } = raw;
  if (!isRecord(kdf) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw new ExportCryptoError('bad_envelope');
  const iterations = kdf.iterations;
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < MIN_IMPORT_ITERATIONS ||
    iterations > MAX_IMPORT_ITERATIONS
  ) {
    throw new ExportCryptoError('bad_envelope');
  }
  if (!isRecord(cipher) || cipher.name !== 'AES-GCM' || cipher.tagLength !== TAG_BITS) {
    throw new ExportCryptoError('bad_envelope');
  }
  const salt = fromBase64(kdf.salt);
  const iv = fromBase64(cipher.iv);
  const data = fromBase64(raw.data);
  if (!salt || salt.length !== SALT_BYTES || !iv || iv.length !== IV_BYTES || !data || data.length < TAG_BITS / 8) {
    throw new ExportCryptoError('bad_envelope');
  }
  return { iterations, salt, iv, data };
}

export async function decryptExport(envelope: string, password: string): Promise<string> {
  const { iterations, salt, iv, data } = readEnvelope(envelope);
  const key = await deriveKey(password, salt, iterations);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BITS, additionalData: utf8(AAD) },
      key,
      data,
    );
  } catch {
    throw new ExportCryptoError('wrong_password');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new ExportCryptoError('bad_envelope');
  }
}
