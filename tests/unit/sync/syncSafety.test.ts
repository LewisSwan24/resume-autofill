// Regression tests for sync defects that could lose a user's resume files or accept an altered archive.
import { describe, expect, it } from 'vitest';
import { createSampleProfile } from '../../../src/schema';
import {
  RAF_PBKDF2_ITERATIONS,
  applySyncMerge,
  buildRafArchive,
  buildZip,
  deleteOrphanFiles,
  inspectSyncArchive,
  parseKnownHashes,
  parseZip,
  sha256Hex,
  unlockSyncArchive,
  type SyncStorageAdapter,
} from '../../../src/sync';

const PASS = 'sync-safety-pass-1';
const enc = (s: string) => new TextEncoder().encode(s);

function makeMemoryStorage(initial: Array<{ id: string; name: string; type: string; bytes: Uint8Array }> = []): SyncStorageAdapter & {
  items: Map<string, { id: string; name: string; type: string; bytes: Uint8Array }>;
  deleted: string[];
} {
  const items = new Map(initial.map((f) => [f.id, f]));
  const deleted: string[] = [];
  let seq = 0;
  return {
    items,
    deleted,
    async listExistingFiles() {
      return [...items.values()].map((f) => ({ id: f.id, bytes: f.bytes }));
    },
    async saveFile(input) {
      const id = `stored-${++seq}`;
      items.set(id, { id, ...input });
      return id;
    },
    async deleteFile(id) {
      deleted.push(id);
      items.delete(id);
    },
  };
}

/** Rewrite manifest.json (and optionally entries) of a `.raf` while keeping a valid ZIP (CRC recomputed). */
function rewriteArchive(
  bytes: Uint8Array,
  editManifest: (m: Record<string, any>) => void,
  editEntries?: (entries: Map<string, Uint8Array>) => void,
): Uint8Array {
  const entries = parseZip(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as Record<string, any>;
  editManifest(manifest);
  entries.set('manifest.json', enc(JSON.stringify(manifest, null, 2)));
  editEntries?.(entries);
  return buildZip([...entries.entries()].map(([name, data]) => ({ name, data })));
}

const cvBytes = enc('%PDF-1.4 the one and only CV');
const photoBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7]);

/** Receiver holds `local-cv` for resume 0; sender's resume 0 is newer and points to its own `sender-cv` with the same bytes. */
function deltaProfiles() {
  const local = createSampleProfile();
  local.resumes[0]!.updatedAt = 1000;
  local.resumes[0]!.attachments.resumeFileId = 'local-cv';
  const sender = createSampleProfile();
  sender.resumes[0]!.updatedAt = 5000;
  sender.resumes[0]!.title = 'Sender edit';
  sender.resumes[0]!.attachments.resumeFileId = 'sender-cv';
  sender.resumes[0]!.attachments.photoFileId = 'sender-photo';
  return { local, sender };
}

async function buildDelta(sender: ReturnType<typeof deltaProfiles>['sender']) {
  return buildRafArchive({
    profile: sender,
    mode: 'full',
    version: 3,
    password: PASS,
    knownAttachmentHashes: [await sha256Hex(cvBytes)],
    attachments: [
      { id: 'sender-cv', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes },
      { id: 'sender-photo', name: 'photo.png', type: 'image/png', bytes: photoBytes },
    ],
  });
}

describe('#1 delta import keeps the receiver file', () => {
  it('lists each skipped attachment in the manifest with its hash and sourceIds', async () => {
    const { sender } = deltaProfiles();
    const bytes = await buildDelta(sender);
    const cvHash = await sha256Hex(cvBytes);
    const inspected = inspectSyncArchive(bytes);
    expect(inspected.kind).toBe('raf-v3');
    if (inspected.kind !== 'raf-v3') return;
    expect(inspected.manifest.delta?.skipped).toEqual([{ hash: cvHash, sourceIds: ['sender-cv'] }]);
    const unlocked = await unlockSyncArchive(bytes, PASS);
    expect(unlocked.skipped).toEqual([{ hash: cvHash, sourceIds: ['sender-cv'] }]);
  });

  it('maps a skipped attachment to the local file with the same hash instead of dropping the slot and pruning it', async () => {
    const { local, sender } = deltaProfiles();
    const storage = makeMemoryStorage([{ id: 'local-cv', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes }]);
    const unlocked = await unlockSyncArchive(await buildDelta(sender), PASS);
    const merged = await applySyncMerge(local, unlocked, [], storage, { strategy: 'merge' });
    expect(merged.profile.resumes[0]!.title).toBe('Sender edit');
    expect(merged.profile.resumes[0]!.attachments.resumeFileId).toBe('local-cv');
    expect(storage.items.has('local-cv')).toBe(true);
    expect(merged.orphanFileIds).not.toContain('local-cv');
  });

  it('refuses the import, saving nothing, when the receiver has no file with a skipped hash', async () => {
    const { local, sender } = deltaProfiles();
    const storage = makeMemoryStorage([{ id: 'other', name: 'x.pdf', type: 'application/pdf', bytes: enc('different') }]);
    const unlocked = await unlockSyncArchive(await buildDelta(sender), PASS);
    await expect(applySyncMerge(local, unlocked, [], storage, { strategy: 'merge' })).rejects.toMatchObject({
      code: 'missing_known_file',
    });
    expect([...storage.items.keys()]).toEqual(['other']);
    expect(storage.deleted).toEqual([]);
  });
});

describe('#2 light import never removes local files', () => {
  async function lightFixture() {
    const local = createSampleProfile();
    local.resumes[0]!.updatedAt = 1000;
    local.resumes[0]!.attachments.resumeFileId = 'local-cv';
    const sender = createSampleProfile();
    sender.resumes[0]!.updatedAt = 5000;
    sender.resumes[0]!.title = 'Light edit';
    sender.resumes[0]!.attachments.resumeFileId = 'sender-cv';
    const storage = makeMemoryStorage([
      { id: 'local-cv', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes },
      { id: 'local-extra', name: 'extra.pdf', type: 'application/pdf', bytes: enc('extra') },
    ]);
    const unlocked = await unlockSyncArchive(await buildRafArchive({ profile: sender, mode: 'light', password: PASS }), PASS);
    return { local, storage, unlocked };
  }

  it('merge keeps the local slot value when the incoming id is unknown', async () => {
    const { local, storage, unlocked } = await lightFixture();
    const merged = await applySyncMerge(local, unlocked, [], storage, { strategy: 'merge' });
    expect(merged.profile.resumes[0]!.title).toBe('Light edit');
    expect(merged.profile.resumes[0]!.attachments.resumeFileId).toBe('local-cv');
    expect(storage.items.has('local-cv')).toBe(true);
    expect(merged.orphanFileIds).toEqual([]);
  });

  it('replace keeps local files and slot values', async () => {
    const { local, storage, unlocked } = await lightFixture();
    const merged = await applySyncMerge(local, unlocked, [], storage, { strategy: 'replace' });
    expect(merged.profile.resumes[0]!.attachments.resumeFileId).toBe('local-cv');
    expect(storage.items.has('local-cv')).toBe(true);
    expect(storage.items.has('local-extra')).toBe(true);
    expect(merged.orphanFileIds).toEqual([]);
  });
});

describe('#3 known-hash box validation', () => {
  it('accepts only 64-char lowercase hex SHA-256 entries and reports the rest', () => {
    const good = 'a'.repeat(64);
    const good2 = `${'0123456789abcdef'.repeat(4)}`;
    const parsed = parseKnownHashes(` ${good}\n${good2.toUpperCase()}, deadbeef ; ${'g'.repeat(64)}\n\n`);
    expect(parsed.hashes).toEqual([good, good2]);
    expect(parsed.invalid).toEqual(['deadbeef', 'g'.repeat(64)]);
  });
});

describe('#4 the manifest is authenticated', () => {
  async function twoFileFull() {
    const profile = createSampleProfile();
    profile.resumes[0]!.attachments.resumeFileId = 'cv-id';
    profile.resumes[0]!.attachments.photoFileId = 'photo-id';
    return buildRafArchive({
      profile,
      mode: 'full',
      password: PASS,
      attachments: [
        { id: 'cv-id', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes },
        { id: 'photo-id', name: 'photo.png', type: 'image/png', bytes: photoBytes },
      ],
    });
  }

  it('round-trips intact v2 full, v3 delta and light archives', async () => {
    const full = await unlockSyncArchive(await twoFileFull(), PASS);
    expect(full.format).toBe('raf-v2');
    expect(full.attachments).toHaveLength(2);
    const delta = await unlockSyncArchive(await buildDelta(deltaProfiles().sender), PASS);
    expect(delta.format).toBe('raf-v3');
    expect(delta.attachments).toHaveLength(1);
    const light = await unlockSyncArchive(
      await buildRafArchive({ profile: createSampleProfile(), mode: 'light', password: PASS }),
      PASS,
    );
    expect(light.mode).toBe('light');
  });

  it('refuses swapped sourceIds/names, a dropped entry, a changed mode or delta list, and an added field', async () => {
    const full = await twoFileFull();
    const swaps: Array<(m: Record<string, any>) => void> = [
      (m) => {
        const [a, b] = m.attachments;
        [a.sourceIds, b.sourceIds] = [b.sourceIds, a.sourceIds];
        [a.name, b.name] = [b.name, a.name];
      },
      (m) => {
        m.attachments = m.attachments.slice(0, 1);
      },
      (m) => {
        m.mode = 'light';
      },
      (m) => {
        m.createdAt = m.createdAt + 1;
      },
      (m) => {
        m.extra = 'x';
      },
    ];
    for (const edit of swaps) {
      await expect(unlockSyncArchive(rewriteArchive(full, edit), PASS)).rejects.toMatchObject({ code: 'tampered' });
    }
    const delta = await buildDelta(deltaProfiles().sender);
    await expect(
      unlockSyncArchive(
        rewriteArchive(delta, (m) => {
          m.delta.skipped[0].sourceIds = ['someone-else'];
        }),
        PASS,
      ),
    ).rejects.toMatchObject({ code: 'tampered' });
    // A wrong password is still reported as such, not as tampering.
    await expect(unlockSyncArchive(full, 'not-the-password')).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('asks to export again for an archive written before manifest authentication', async () => {
    const full = await twoFileFull();
    const legacy = rewriteArchive(full, (m) => {
      delete m.integrity;
    });
    await expect(unlockSyncArchive(legacy, PASS)).rejects.toMatchObject({ code: 'outdated_archive' });
  });
});

describe('#5 merge never deletes files itself', () => {
  it('returns the orphan ids for the caller to delete after saving', async () => {
    const local = createSampleProfile();
    local.resumes[0]!.attachments.resumeFileId = 'local-cv';
    const storage = makeMemoryStorage([
      { id: 'local-cv', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes },
      { id: 'local-orphan', name: 'old.pdf', type: 'application/pdf', bytes: enc('orphan') },
    ]);
    const incoming = createSampleProfile();
    incoming.resumes[0]!.attachments.resumeFileId = 'remote-cv';
    const unlocked = await unlockSyncArchive(
      await buildRafArchive({
        profile: incoming,
        mode: 'full',
        password: PASS,
        attachments: [{ id: 'remote-cv', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes }],
      }),
      PASS,
    );
    const merged = await applySyncMerge(local, unlocked, [], storage, { strategy: 'replace' });
    expect(storage.deleted).toEqual([]);
    expect(storage.items.has('local-orphan')).toBe(true);
    expect(merged.orphanFileIds).toEqual(['local-orphan']);
    await deleteOrphanFiles(storage, merged.orphanFileIds);
    expect(storage.items.has('local-orphan')).toBe(false);
  });
});

describe('#6 damaged chunks and iteration bounds', () => {
  it('reports a corrupted attachment chunk as tampered, not as a wrong password', async () => {
    const profile = createSampleProfile();
    profile.resumes[0]!.attachments.resumeFileId = 'cv-id';
    const bytes = await buildRafArchive({
      profile,
      mode: 'full',
      password: PASS,
      attachments: [{ id: 'cv-id', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes }],
    });
    const hash = await sha256Hex(cvBytes);
    const corrupt = rewriteArchive(
      bytes,
      () => undefined,
      (entries) => {
        const chunk = entries.get(`attachments/${hash}.enc`)!.slice();
        chunk[0]! ^= 0xff;
        entries.set(`attachments/${hash}.enc`, chunk);
      },
    );
    await expect(unlockSyncArchive(corrupt, PASS)).rejects.toMatchObject({ code: 'tampered' });
  });

  it('refuses to build or open archives outside the PBKDF2 iteration range', async () => {
    await expect(
      buildRafArchive({ profile: createSampleProfile(), mode: 'light', password: PASS, iterations: 100_000 }),
    ).rejects.toThrow();
    const ok = await buildRafArchive({ profile: createSampleProfile(), mode: 'light', password: PASS });
    for (const iterations of [RAF_PBKDF2_ITERATIONS - 1, 2_000_001]) {
      const bad = rewriteArchive(ok, (m) => {
        m.kdf.iterations = iterations;
      });
      expect(inspectSyncArchive(bad).kind).toBe('invalid');
      await expect(unlockSyncArchive(bad, PASS)).rejects.toMatchObject({ code: 'bad_archive' });
    }
  });
});
