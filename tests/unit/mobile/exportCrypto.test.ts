// @vitest-environment node
// Password-protected export: a PBKDF2-SHA256 / AES-256-GCM envelope, WebCrypto only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENCRYPTED_FORMAT,
  EXPORT_PBKDF2_ITERATIONS,
  ExportCryptoError,
  MAX_IMPORT_ITERATIONS,
  MIN_IMPORT_ITERATIONS,
  decryptExport,
  encryptExport,
  isEncryptedExport,
} from '../../../mobile/app/src/data/exportCrypto';

const FAST = { iterations: 100_000 };
const PLAIN = JSON.stringify({ schemaVersion: 1, resumes: [{ title: '张三', email: 'zhangsan@example.com' }] }, null, 2);
const PASSWORD = 'example-pass-123';

const b64len = (s: string) => Buffer.from(s, 'base64').length;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ExportCryptoError);
    return (error as ExportCryptoError).code;
  }
  throw new Error('expected a rejection');
}

async function envelope(): Promise<Record<string, any>> {
  return JSON.parse(await encryptExport(PLAIN, PASSWORD, FAST));
}

afterEach(() => vi.restoreAllMocks());

describe('export crypto', () => {
  it('round trip: decrypts to exactly the text encrypted', async () => {
    const sealed = await encryptExport(PLAIN, PASSWORD, FAST);
    expect(await decryptExport(sealed, PASSWORD)).toBe(PLAIN);
  });

  it('envelope names PBKDF2-SHA256 and AES-GCM, with a 16-byte salt and a 12-byte IV', async () => {
    const env = await envelope();
    expect(env.format).toBe(ENCRYPTED_FORMAT);
    expect(env.format).toBe('resume-autofill-encrypted');
    expect(env.version).toBe(1);
    expect(env.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000 });
    expect(env.cipher).toMatchObject({ name: 'AES-GCM', tagLength: 128 });
    expect(b64len(env.kdf.salt)).toBe(16);
    expect(b64len(env.cipher.iv)).toBe(12);
    expect(env.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(b64len(env.data)).toBe(Buffer.byteLength(PLAIN, 'utf8') + 16);
  });

  it('the envelope carries none of the plaintext', async () => {
    const sealed = await encryptExport(PLAIN, PASSWORD, FAST);
    for (const s of ['张三', 'example.com', '"resumes"', PASSWORD]) expect(sealed).not.toContain(s);
  });

  it('two exports of the same text differ', async () => {
    const a = await envelope();
    const b = await envelope();
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('wrong password → ExportCryptoError wrong_password', async () => {
    const sealed = await encryptExport(PLAIN, PASSWORD, FAST);
    expect(await codeOf(decryptExport(sealed, 'not-the-password'))).toBe('wrong_password');
  });

  it('a changed byte in data → wrong_password', async () => {
    const env = await envelope();
    const bytes = Buffer.from(env.data, 'base64');
    bytes[3] = bytes[3]! ^ 0x01;
    env.data = bytes.toString('base64');
    expect(await codeOf(decryptExport(JSON.stringify(env), PASSWORD))).toBe('wrong_password');
  });

  it('iterations outside 100 000…5 000 000 → bad_envelope, without deriving', async () => {
    expect(MIN_IMPORT_ITERATIONS).toBe(100_000);
    expect(MAX_IMPORT_ITERATIONS).toBe(5_000_000);
    const env = await envelope();
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    for (const iterations of [99_999, 5_000_001, 1e12, -1, 1.5, '600000', null]) {
      const bad = { ...env, kdf: { ...env.kdf, iterations } };
      expect(await codeOf(decryptExport(JSON.stringify(bad), PASSWORD))).toBe('bad_envelope');
    }
    expect(deriveKey).not.toHaveBeenCalled();
    expect(deriveBits).not.toHaveBeenCalled();
  });

  it('bad salt / IV length or missing fields → bad_envelope; version 2 → unsupported_version', async () => {
    const env = await envelope();
    const variants: unknown[] = [
      { ...env, kdf: { ...env.kdf, salt: Buffer.alloc(8).toString('base64') } },
      { ...env, cipher: { ...env.cipher, iv: Buffer.alloc(16).toString('base64') } },
      { ...env, cipher: { ...env.cipher, iv: '***' } },
      { ...env, kdf: { ...env.kdf, hash: 'SHA-1' } },
      { ...env, cipher: { ...env.cipher, tagLength: 96 } },
      { ...env, data: undefined },
      { ...env, kdf: undefined },
      { format: ENCRYPTED_FORMAT, version: 1 },
    ];
    for (const v of variants) expect(await codeOf(decryptExport(JSON.stringify(v), PASSWORD))).toBe('bad_envelope');
    expect(await codeOf(decryptExport('not json', PASSWORD))).toBe('bad_envelope');
    expect(await codeOf(decryptExport(JSON.stringify({ ...env, version: 2 }), PASSWORD))).toBe('unsupported_version');
  });

  it('a password typed in another Unicode form (NFD) still opens it', async () => {
    const nfc = 'café-密码-ü'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    const sealed = await encryptExport(PLAIN, nfc, FAST);
    expect(await decryptExport(sealed, nfd)).toBe(PLAIN);
  });

  it('isEncryptedExport: true for an envelope, false for a plain export and for non-JSON', async () => {
    expect(isEncryptedExport(await encryptExport(PLAIN, PASSWORD, FAST))).toBe(true);
    expect(isEncryptedExport(PLAIN)).toBe(false);
    expect(isEncryptedExport('not json')).toBe(false);
    expect(isEncryptedExport('null')).toBe(false);
    expect(isEncryptedExport('[1]')).toBe(false);
  });

  it('the default for new exports is 600 000 iterations', () => {
    expect(EXPORT_PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('error messages carry no envelope or password content', async () => {
    const sealed = await encryptExport(PLAIN, PASSWORD, FAST);
    try {
      await decryptExport(sealed, 'wrong-张三');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('张三');
    }
  });
});
