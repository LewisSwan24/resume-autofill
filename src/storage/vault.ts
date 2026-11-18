// Zero-trust encryption at rest for browser.storage.local['profile'].
// Uses a two-layer key envelope: PBKDF2-SHA256 KEK wraps a random 256-bit AES-GCM DEK.
// Unlocked DEK stays only in MV3 session storage (`chrome.storage.session`) with lazy idle timeout.
import { browser } from 'wxt/browser';

export const VAULT_META_KEY = 'vault_meta';
export const VAULT_SESSION_KEY = 'vault_session';
export const VAULT_DEFAULT_ITERATIONS = 600_000;
export const VAULT_MIN_ITERATIONS = 100_000;
export const VAULT_MIN_PASSWORD_LENGTH = 8;
export const VAULT_DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface VaultMeta {
  version: 1;
  kdfSalt: string;
  iterations: number;
  wrappedDekIv: string;
  wrappedDekCt: string;
  idleTimeoutMs: number;
  updatedAt: number;
}

export interface VaultSession {
  dekB64: string;
  unlockedAt: number;
  lastActiveAt: number;
}

export interface EncryptedVaultBlob {
  __rafVault: 1;
  iv: string;
  ct: string;
}

export interface VaultStatus {
  enabled: boolean;
  unlocked: boolean;
  idleTimeoutMs: number;
  lastActiveAt: number | null;
}

export class VaultLockedError extends Error {
  override readonly name = 'VaultLockedError';
  readonly reason: 'locked' | 'locked_idle';
  constructor(reason: 'locked' | 'locked_idle' = 'locked') {
    super(reason === 'locked_idle' ? 'Vault locked due to inactivity' : 'Vault is locked');
    this.reason = reason;
  }
}

export class VaultPasswordError extends Error {
  override readonly name = 'VaultPasswordError';
  constructor(message = 'Incorrect or invalid vault passphrase') {
    super(message);
  }
}

const memorySessionFallback = new Map<string, unknown>();

interface SessionAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function getSessionArea(): SessionAreaLike {
  const storage = browser.storage as unknown as { session?: SessionAreaLike };
  if (storage.session && typeof storage.session.get === 'function') {
    return storage.session;
  }
  return {
    async get(key) {
      return key in memorySessionFallback ? { [key]: memorySessionFallback.get(key) } : {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) memorySessionFallback.set(k, v);
    },
    async remove(key) {
      memorySessionFallback.delete(key);
    },
  };
}

export function resetVaultMemorySessionForTests(): void {
  memorySessionFallback.clear();
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const buf = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  buf.set(encoded);
  return buf;
}

async function deriveKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', utf8Encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importDek(rawDek: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>): Promise<{ iv: string; ct: string }> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ctBuf)),
  };
}

async function aesGcmDecrypt(key: CryptoKey, ivB64: string, ctB64: string): Promise<Uint8Array> {
  const iv = fromBase64(ivB64);
  const ct = fromBase64(ctB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(plainBuf);
}

export function isEncryptedVaultBlob(raw: unknown): raw is EncryptedVaultBlob {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return r.__rafVault === 1 && typeof r.iv === 'string' && typeof r.ct === 'string';
}

export async function getVaultMeta(): Promise<VaultMeta | null> {
  const stored = await browser.storage.local.get(VAULT_META_KEY);
  const raw = stored[VAULT_META_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Partial<VaultMeta>;
  if (
    m.version !== 1 ||
    typeof m.kdfSalt !== 'string' ||
    typeof m.iterations !== 'number' ||
    typeof m.wrappedDekIv !== 'string' ||
    typeof m.wrappedDekCt !== 'string'
  ) {
    return null;
  }
  return {
    version: 1,
    kdfSalt: m.kdfSalt,
    iterations: m.iterations,
    wrappedDekIv: m.wrappedDekIv,
    wrappedDekCt: m.wrappedDekCt,
    idleTimeoutMs: typeof m.idleTimeoutMs === 'number' && m.idleTimeoutMs > 0 ? m.idleTimeoutMs : VAULT_DEFAULT_IDLE_TIMEOUT_MS,
    updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
  };
}

async function getActiveSessionDek(meta: VaultMeta, touch = true): Promise<Uint8Array<ArrayBuffer>> {
  const area = getSessionArea();
  const data = await area.get(VAULT_SESSION_KEY);
  const session = data[VAULT_SESSION_KEY] as VaultSession | undefined;
  if (!session || typeof session.dekB64 !== 'string' || typeof session.lastActiveAt !== 'number') {
    throw new VaultLockedError('locked');
  }
  const now = Date.now();
  if (now - session.lastActiveAt > meta.idleTimeoutMs) {
    await area.remove(VAULT_SESSION_KEY);
    throw new VaultLockedError('locked_idle');
  }
  if (touch) {
    await area.set({
      [VAULT_SESSION_KEY]: { ...session, lastActiveAt: now },
    });
  }
  return fromBase64(session.dekB64);
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const meta = await getVaultMeta();
  if (!meta) {
    return { enabled: false, unlocked: true, idleTimeoutMs: VAULT_DEFAULT_IDLE_TIMEOUT_MS, lastActiveAt: null };
  }
  const area = getSessionArea();
  const data = await area.get(VAULT_SESSION_KEY);
  const session = data[VAULT_SESSION_KEY] as VaultSession | undefined;
  if (!session || typeof session.lastActiveAt !== 'number') {
    return { enabled: true, unlocked: false, idleTimeoutMs: meta.idleTimeoutMs, lastActiveAt: null };
  }
  if (Date.now() - session.lastActiveAt > meta.idleTimeoutMs) {
    await area.remove(VAULT_SESSION_KEY);
    return { enabled: true, unlocked: false, idleTimeoutMs: meta.idleTimeoutMs, lastActiveAt: null };
  }
  return {
    enabled: true,
    unlocked: true,
    idleTimeoutMs: meta.idleTimeoutMs,
    lastActiveAt: session.lastActiveAt,
  };
}

export interface VaultEnableOptions {
  idleTimeoutMs?: number;
  iterations?: number;
  /** Explicit test override so crypto unit tests do not block 600k iterations on CI. */
  allowFastKdfForTest?: boolean;
}

function resolveIterations(opts?: VaultEnableOptions): number {
  if (opts?.allowFastKdfForTest && typeof opts.iterations === 'number' && opts.iterations >= 1000) {
    return opts.iterations;
  }
  const requested = opts?.iterations ?? VAULT_DEFAULT_ITERATIONS;
  return Math.max(VAULT_MIN_ITERATIONS, requested);
}

export async function createVaultMetaAndSession(
  passphrase: string,
  options?: VaultEnableOptions,
): Promise<{ meta: VaultMeta; rawDek: Uint8Array<ArrayBuffer> }> {
  if (passphrase.length < VAULT_MIN_PASSWORD_LENGTH) {
    throw new VaultPasswordError(`Passphrase must be at least ${VAULT_MIN_PASSWORD_LENGTH} characters`);
  }
  const rawDek = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(rawDek);
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const iterations = resolveIterations(options);
  const kek = await deriveKek(passphrase, salt, iterations);
  const wrapped = await aesGcmEncrypt(kek, rawDek);
  const now = Date.now();
  const meta: VaultMeta = {
    version: 1,
    kdfSalt: toBase64(salt),
    iterations,
    wrappedDekIv: wrapped.iv,
    wrappedDekCt: wrapped.ct,
    idleTimeoutMs: options?.idleTimeoutMs && options.idleTimeoutMs > 0 ? options.idleTimeoutMs : VAULT_DEFAULT_IDLE_TIMEOUT_MS,
    updatedAt: now,
  };
  await browser.storage.local.set({ [VAULT_META_KEY]: meta });
  await getSessionArea().set({
    [VAULT_SESSION_KEY]: {
      dekB64: toBase64(rawDek),
      unlockedAt: now,
      lastActiveAt: now,
    } satisfies VaultSession,
  });
  return { meta, rawDek };
}

export async function unlockVaultWithPassphrase(passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const meta = await getVaultMeta();
  if (!meta) throw new VaultPasswordError('Vault is not enabled');
  try {
    const kek = await deriveKek(passphrase, fromBase64(meta.kdfSalt), meta.iterations);
    const dekBytes = await aesGcmDecrypt(kek, meta.wrappedDekIv, meta.wrappedDekCt);
    const dekCopy = new Uint8Array(new ArrayBuffer(dekBytes.byteLength));
    dekCopy.set(dekBytes);
    const now = Date.now();
    await getSessionArea().set({
      [VAULT_SESSION_KEY]: {
        dekB64: toBase64(dekCopy),
        unlockedAt: now,
        lastActiveAt: now,
      } satisfies VaultSession,
    });
    return dekCopy;
  } catch {
    throw new VaultPasswordError('Incorrect vault passphrase');
  }
}

export async function lockVault(): Promise<void> {
  await getSessionArea().remove(VAULT_SESSION_KEY);
}

export async function updateVaultIdleTimeout(idleTimeoutMs: number): Promise<void> {
  const meta = await getVaultMeta();
  if (!meta || idleTimeoutMs <= 0) return;
  await browser.storage.local.set({
    [VAULT_META_KEY]: { ...meta, idleTimeoutMs, updatedAt: Date.now() } satisfies VaultMeta,
  });
}

export async function changeVaultPassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  options?: VaultEnableOptions,
): Promise<void> {
  if (newPassphrase.length < VAULT_MIN_PASSWORD_LENGTH) {
    throw new VaultPasswordError(`Passphrase must be at least ${VAULT_MIN_PASSWORD_LENGTH} characters`);
  }
  const rawDek = await unlockVaultWithPassphrase(oldPassphrase);
  const meta = await getVaultMeta();
  if (!meta) throw new VaultPasswordError('Vault is not enabled');
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const iterations = resolveIterations(options ?? { iterations: meta.iterations, allowFastKdfForTest: true });
  const newKek = await deriveKek(newPassphrase, salt, iterations);
  const wrapped = await aesGcmEncrypt(newKek, rawDek);
  const updated: VaultMeta = {
    ...meta,
    kdfSalt: toBase64(salt),
    iterations,
    wrappedDekIv: wrapped.iv,
    wrappedDekCt: wrapped.ct,
    updatedAt: Date.now(),
  };
  await browser.storage.local.set({ [VAULT_META_KEY]: updated });
}

export async function encryptProfileWithVault(profileJson: string, rawDekOverride?: Uint8Array<ArrayBuffer>): Promise<EncryptedVaultBlob> {
  let rawDek = rawDekOverride;
  if (!rawDek) {
    const meta = await getVaultMeta();
    if (!meta) throw new VaultLockedError('locked');
    rawDek = await getActiveSessionDek(meta, true);
  }
  const dekKey = await importDek(rawDek);
  const enc = await aesGcmEncrypt(dekKey, utf8Encode(profileJson));
  return { __rafVault: 1, iv: enc.iv, ct: enc.ct };
}

export async function decryptProfileWithVault(
  blob: EncryptedVaultBlob,
  options?: { touchSession?: boolean; rawDekOverride?: Uint8Array<ArrayBuffer> },
): Promise<unknown> {
  let rawDek = options?.rawDekOverride;
  if (!rawDek) {
    const meta = await getVaultMeta();
    if (!meta) throw new VaultLockedError('locked');
    rawDek = await getActiveSessionDek(meta, options?.touchSession ?? true);
  }
  const dekKey = await importDek(rawDek);
  const plain = await aesGcmDecrypt(dekKey, blob.iv, blob.ct);
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}
