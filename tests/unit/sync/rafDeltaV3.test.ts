import { describe, expect, it } from 'vitest';
import { createSampleProfile } from '../../../src/schema';
import {
  buildRafArchive,
  inspectSyncArchive,
  sha256Hex,
  unlockSyncArchive,
} from '../../../src/sync/raf';

describe('Incremental Delta .raf v3 container', () => {
  it('skips attachments whose SHA-256 hash the peer already holds while remaining decryptable', async () => {
    const profile = createSampleProfile();
    profile.resumes[0]!.attachments.resumeFileId = 'att-cv-1';
    profile.resumes[0]!.attachments.photoFileId = 'att-photo-1';
    const cvBytes = new TextEncoder().encode('%PDF-1.4 resume payload v1');
    const photoBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const knownCvHash = await sha256Hex(cvBytes);
    const photoHash = await sha256Hex(photoBytes);

    const deltaBytes = await buildRafArchive({
      profile,
      mode: 'full',
      version: 3,
      password: 'delta-pass-8888',
      knownAttachmentHashes: [knownCvHash],
      attachments: [
        { id: 'att-cv-1', name: 'cv.pdf', type: 'application/pdf', bytes: cvBytes },
        { id: 'att-photo-1', name: 'photo.png', type: 'image/png', bytes: photoBytes },
      ],
    });

    const inspected = inspectSyncArchive(deltaBytes);
    expect(inspected.kind).toBe('raf-v3');
    if (inspected.kind === 'raf-v3') {
      expect(inspected.manifest.delta?.skippedHashes).toEqual([knownCvHash]);
      expect(inspected.manifest.delta?.totalAttachmentCount).toBe(2);
      expect(inspected.manifest.attachments.map((a) => a.hash)).toEqual([photoHash]);
    }

    const unlocked = await unlockSyncArchive(deltaBytes, 'delta-pass-8888');
    expect(unlocked.format).toBe('raf-v3');
    expect(unlocked.skippedHashes).toEqual([knownCvHash]);
    expect(unlocked.attachments).toHaveLength(1);
    expect(unlocked.attachments[0]?.hash).toBe(photoHash);
  });
});
