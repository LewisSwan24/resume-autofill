// Export, import, preview, replace and merge of the whole profile on the phone. The plain export must stay exactly
// what the desktop extension's 「导入 JSON」 reads.
import { describe, expect, it } from 'vitest';
import { decryptExport, ExportCryptoError } from '../../../mobile/app/src/data/exportCrypto';
import {
  IMPORT_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  buildExport,
  mergeInto,
  previewImport,
  readImport,
  replaceWith,
  unlockImport,
} from '../../../mobile/app/src/data/transfer';
import { emptyProfile, sameResumeContent } from '../../../mobile/app/src/store/profileStore';
import { encryptExport } from '../../../mobile/app/src/data/exportCrypto';
import { exportProfile, parseProfileJson } from '../../../src/editor';
import { ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../src/schema';

function resume(id: string, extra: Record<string, unknown> = {}): Resume {
  return ResumeSchema.parse({ id, title: `简历 ${id}`, locale: 'zh-CN', createdAt: 1, updatedAt: 1, ...extra });
}

function profile(resumes: Resume[], extra: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({ schemaVersion: 1, resumes, activeResumeId: resumes[0]?.id ?? null, ...extra });
}

const filled = resume('a', {
  basics: { familyName: '张', givenName: '三' },
  contact: { email: 'zhangsan@example.com', phone: '13800000000' },
  education: [{ school: '示例大学' }],
  attachments: { resumeFileId: 'file-1', photoFileId: 'file-2' },
});

const NOW = new Date(2026, 0, 5, 10, 30).getTime();
const newIds = () => {
  let n = 0;
  return () => `new${++n}`;
};

describe('export', () => {
  it('constants', () => {
    expect(IMPORT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("plain export is exactly exportProfile(), and the extension's parser reads it back equal", async () => {
    const p = profile([filled]);
    const file = await buildExport(p, { now: NOW });
    expect(file.text).toBe(exportProfile(p));
    const back = parseProfileJson(file.text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.profile).toEqual(p);
  });

  it('file names carry the local date; the encrypted one ends -encrypted.json; type application/json', async () => {
    const p = profile([filled]);
    const plain = await buildExport(p, { now: NOW });
    expect(plain.name).toBe('resume-autofill-profile-2026-01-05.json');
    expect(plain.mimeType).toBe('application/json');
    const sealed = await buildExport(p, { now: NOW, password: 'example-pass-123' });
    expect(sealed.name).toBe('resume-autofill-profile-2026-01-05-encrypted.json');
    expect(sealed.mimeType).toBe('application/json');
  });

  it('password export decrypts to the plain export text', async () => {
    const p = profile([filled]);
    const sealed = await buildExport(p, { now: NOW, password: 'example-pass-123' });
    expect(sealed.text).not.toContain('张');
    expect(sealed.text).not.toContain('example.com');
    expect(await decryptExport(sealed.text, 'example-pass-123')).toBe(exportProfile(p));
  });
});

describe('import', () => {
  it('readImport: plain profile / encrypted envelope / not JSON → invalid_json / JSON that is not a profile → invalid_profile', async () => {
    const p = profile([filled]);
    expect(readImport(exportProfile(p))).toEqual({ kind: 'profile', profile: p });
    const env = await encryptExport(exportProfile(p), 'example-pass-123', { iterations: 100_000 });
    expect(readImport(env)).toEqual({ kind: 'encrypted', envelope: env });
    expect(readImport('{ nope')).toEqual({ kind: 'error', code: 'invalid_json' });
    expect(readImport('{"hello": 1}')).toEqual({ kind: 'error', code: 'invalid_profile' });
    expect(readImport('[]')).toEqual({ kind: 'error', code: 'invalid_profile' });
  });

  it('readImport refuses text over the size limit', () => {
    expect(readImport(' '.repeat(IMPORT_MAX_BYTES + 1))).toEqual({ kind: 'error', code: 'too_large' });
  });

  it('readImport migrates an older schema', () => {
    const old = JSON.stringify({ resumes: [{ id: 'old', title: '旧简历', locale: 'zh-CN' }] });
    const read = readImport(old);
    expect(read.kind).toBe('profile');
    if (read.kind === 'profile') {
      expect(read.profile.schemaVersion).toBe(1);
      expect(read.profile.activeResumeId).toBe('old');
    }
  });

  it('unlockImport: right password → profile; wrong → throws wrong_password; envelope wrapping a non-profile → invalid_profile', async () => {
    const p = profile([filled]);
    const env = await encryptExport(exportProfile(p), 'example-pass-123', { iterations: 100_000 });
    expect(await unlockImport(env, 'example-pass-123')).toEqual({ kind: 'profile', profile: p });
    await expect(unlockImport(env, 'wrong-password')).rejects.toMatchObject({ code: 'wrong_password' });
    await expect(unlockImport(env, 'wrong-password')).rejects.toBeInstanceOf(ExportCryptoError);
    const junk = await encryptExport('{"hello":1}', 'example-pass-123', { iterations: 100_000 });
    expect(await unlockImport(junk, 'example-pass-123')).toEqual({ kind: 'error', code: 'invalid_profile' });
    const notJson = await encryptExport('nope', 'example-pass-123', { iterations: 100_000 });
    expect(await unlockImport(notJson, 'example-pass-123')).toEqual({ kind: 'error', code: 'invalid_json' });
    const v2 = JSON.stringify({ ...JSON.parse(env), version: 2 });
    expect(await unlockImport(v2, 'example-pass-123')).toEqual({ kind: 'error', code: 'unsupported_version' });
    const bad = JSON.stringify({ ...JSON.parse(env), kdf: { ...JSON.parse(env).kdf, iterations: 1 } });
    expect(await unlockImport(bad, 'example-pass-123')).toEqual({ kind: 'error', code: 'bad_envelope' });
  });
});

describe('preview, replace, merge', () => {
  it('previewImport counts resumes, filled modules, attachment ids missing on this phone, and same-id conflicts', () => {
    const blank = resume('b');
    const incoming = profile([filled, blank, resume('c', { title: '别的' })]);
    const current = profile([resume('b'), resume('c')]);
    const preview = previewImport(incoming, current, new Set(['file-1']));
    expect(preview.resumes).toEqual([
      { id: 'a', title: filled.title, locale: 'zh-CN', filledModules: 4 },
      { id: 'b', title: blank.title, locale: 'zh-CN', filledModules: 0 },
      { id: 'c', title: '别的', locale: 'zh-CN', filledModules: 0 },
    ]);
    expect(preview.missingAttachments).toBe(1);
    expect(preview.conflicts).toBe(1);
  });

  it('replaceWith keeps attachment ids present on the phone and drops missing ones', () => {
    const incoming = profile([filled], { settings: { uiLanguage: 'en', previewBeforeFill: true } });
    const result = replaceWith(incoming, new Set(['file-1']));
    expect(result.resumes[0]!.attachments).toEqual({ resumeFileId: 'file-1' });
    expect(result.settings).toEqual({ uiLanguage: 'en', previewBeforeFill: true });
    expect(result.activeResumeId).toBe('a');
  });

  it('mergeInto: new resumes appended; an identical one skipped; a changed same-id one added as a copy with a new id and the suffix', () => {
    const same = resume('s', { basics: { familyName: '张' } });
    const changedOnPhone = resume('x', { title: '北京岗位', basics: { familyName: '李' } });
    const current = profile([same, changedOnPhone]);
    const incoming = profile([
      { ...same, updatedAt: 999 },
      resume('x', { title: '北京岗位', basics: { familyName: '张' } }),
      resume('n', { title: '新的' }),
    ]);
    const { profile: merged, added, skipped } = mergeInto(current, incoming, new Set(), {
      copySuffix: '（导入）',
      newId: newIds(),
    });
    expect(added).toBe(2);
    expect(skipped).toBe(1);
    expect(merged.resumes.map((r) => [r.id, r.title])).toEqual([
      ['s', same.title],
      ['x', '北京岗位'],
      ['new1', '北京岗位（导入）'],
      ['n', '新的'],
    ]);
    expect(merged.resumes[2]!.basics.familyName).toBe('张');
    expect(merged.resumes[1]!.basics.familyName).toBe('李');
  });

  it('mergeInto remaps links between imported resumes and drops links to resumes that are nowhere', () => {
    const current = profile([resume('x', { title: '手机上的' })]);
    const incoming = profile([
      resume('x', { title: '文件里的', linkedResumeId: 'e' }),
      resume('e', { locale: 'en-AU', linkedResumeId: 'x' }),
      resume('lonely', { linkedResumeId: 'gone' }),
      resume('toPhone', { linkedResumeId: 'kept' }),
    ]);
    const phone = profile([...current.resumes, resume('kept')]);
    const { profile: merged } = mergeInto(phone, incoming, new Set(), { copySuffix: ' (imported)', newId: newIds() });
    const byId = new Map(merged.resumes.map((r) => [r.id, r]));
    expect(byId.get('new1')!.linkedResumeId).toBe('e');
    expect(byId.get('e')!.linkedResumeId).toBe('new1');
    expect(byId.get('lonely')!.linkedResumeId).toBeUndefined();
    expect(byId.get('toPhone')!.linkedResumeId).toBe('kept');
    expect(byId.get('x')!.title).toBe('手机上的');
    expect(byId.get('x')!.linkedResumeId).toBeUndefined();
  });

  it("mergeInto keeps the phone's settings and active resume; with none active, the first added one becomes active", () => {
    const current = profile([resume('p1'), resume('p2')], {
      activeResumeId: 'p2',
      settings: { uiLanguage: 'zh', previewBeforeFill: false },
    });
    const incoming = profile([resume('i1')], { settings: { uiLanguage: 'en', previewBeforeFill: true } });
    const merged = mergeInto(current, incoming, new Set(), { copySuffix: '（导入）' }).profile;
    expect(merged.activeResumeId).toBe('p2');
    expect(merged.settings).toEqual({ uiLanguage: 'zh', previewBeforeFill: false });

    const fromEmpty = mergeInto(emptyProfile(), profile([resume('i1'), resume('i2')]), new Set(), {
      copySuffix: '（导入）',
    }).profile;
    expect(fromEmpty.activeResumeId).toBe('i1');
  });

  it('mergeInto prunes attachment ids missing on the phone and uses a random id by default', () => {
    const current = profile([resume('a', { title: '不同' })]);
    const incoming = profile([filled]);
    const { profile: merged } = mergeInto(current, incoming, new Set(['file-2']), { copySuffix: '（导入）' });
    const copy = merged.resumes[1]!;
    expect(copy.id).not.toBe('a');
    expect(copy.id.length).toBeGreaterThan(0);
    expect(copy.attachments).toEqual({ photoFileId: 'file-2' });
    expect(new Set(merged.resumes.map((r) => r.id)).size).toBe(merged.resumes.length);
  });

  it('merge and replace results pass ProfileSchema', () => {
    const current = profile([resume('x'), filled]);
    const incoming = profile([resume('x', { title: '变了', linkedResumeId: 'a' }), resume('y', { linkedResumeId: 'z' })]);
    const merged = mergeInto(current, incoming, new Set(['file-1']), { copySuffix: '（导入）' }).profile;
    expect(() => ProfileSchema.parse(merged)).not.toThrow();
    expect(() => ProfileSchema.parse(replaceWith(incoming, new Set()))).not.toThrow();
  });

  it('sameResumeContent ignores updatedAt only', () => {
    expect(sameResumeContent(filled, { ...filled, updatedAt: 5 })).toBe(true);
    expect(sameResumeContent(filled, { ...filled, title: '别的' })).toBe(false);
  });
});
