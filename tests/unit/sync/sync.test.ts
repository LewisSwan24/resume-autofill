import { describe, expect, it } from 'vitest';
import { createSampleProfile } from '../../../src/schema';
import {
  RAF_MIN_PASSWORD_LENGTH,
  RafError,
  applySyncMerge,
  buildRafArchive,
  buildZip,
  crc32,
  createReceiverSession,
  createSenderSession,
  decodeCompactSignal,
  encodeCompactSignal,
  encodeQrMatrix,
  inspectSyncArchive,
  parseZip,
  planSyncMerge,
  renderQrSvg,
  unlockSyncArchive,
  type DataChannelLike,
  type PeerConnectionLike,
  type SyncStorageAdapter,
} from '../../../src/sync';

const ITERATIONS = 600_000; // lowest iteration count a .raf manifest accepts

function makeMemoryStorage(initial: Array<{ id: string; name: string; type: string; bytes: Uint8Array }> = []): SyncStorageAdapter & {
  items: Map<string, { id: string; name: string; type: string; bytes: Uint8Array }>;
} {
  const items = new Map(initial.map((f) => [f.id, f]));
  let seq = 0;
  return {
    items,
    async listExistingFiles() {
      return [...items.values()].map((f) => ({ id: f.id, bytes: f.bytes }));
    },
    async saveFile(input) {
      const id = `stored-${++seq}`;
      items.set(id, { id, ...input });
      return id;
    },
    async deleteFile(id) {
      items.delete(id);
    },
  };
}

describe('sync ZIP container', () => {
  it('round-trips UTF-8 entry names and binary buffers with CRC-32 verification', () => {
    const bin = new Uint8Array(64 * 1024);
    for (let i = 0; i < bin.length; i++) bin[i] = i & 0xff;
    const raw = buildZip([
      { name: 'manifest.json', data: new TextEncoder().encode('{"ok":true}') },
      { name: 'attachments/简历.pdf', data: bin },
    ]);
    const parsed = parseZip(raw);
    expect(new TextDecoder().decode(parsed.get('manifest.json'))).toBe('{"ok":true}');
    expect(parsed.get('attachments/简历.pdf')).toEqual(bin);
    expect(crc32(new Uint8Array([1, 2, 3]))).toBeTypeOf('number');

    // Corrupt a payload byte inside the 64KB entry data -> CRC-32 mismatch
    const tampered = raw.slice();
    tampered[200]! ^= 0x55;
    expect(() => parseZip(tampered)).toThrow(/CRC-32 mismatch/);
  });
});

describe('sync `.raf` encrypted chunked archive', () => {
  it('encrypts light and full `.raf` modes, deduplicates identical attachments, and rejects wrong passwords', async () => {
    expect(RAF_MIN_PASSWORD_LENGTH).toBe(8);
    const profile = createSampleProfile();
    profile.resumes[0]!.attachments.resumeFileId = 'att-1';
    profile.resumes[1]!.attachments.resumeFileId = 'att-2';

    const sharedPdf = new TextEncoder().encode('%PDF-1.4 shared content bytes');
    const tracker = [
      {
        id: 't1',
        url: 'https://jobs.example.com/1',
        host: 'jobs.example.com',
        company: 'Example',
        companyGuessed: false,
        position: 'SWE',
        status: 'submitted' as const,
        statusAt: 1000,
        remind: false,
        notes: 'ok',
        createdAt: 1000,
        openedAt: 1000,
        updatedAt: 1000,
        history: [],
      },
    ];

    const lightBytes = await buildRafArchive({
      profile,
      tracker,
      mode: 'light',
      password: 'strong-password-1',
      iterations: ITERATIONS,
      now: 1234,
    });
    const lightInspect = inspectSyncArchive(lightBytes);
    expect(lightInspect.kind).toBe('raf-v2');
    if (lightInspect.kind === 'raf-v2') {
      expect(lightInspect.manifest.mode).toBe('light');
      expect(lightInspect.manifest.attachments).toHaveLength(0);
    }

    const fullBytes = await buildRafArchive({
      profile,
      tracker,
      mode: 'full',
      password: 'strong-password-1',
      iterations: ITERATIONS,
      attachments: [
        { id: 'att-1', name: 'cv-a.pdf', type: 'application/pdf', bytes: sharedPdf },
        { id: 'att-2', name: 'cv-b.pdf', type: 'application/pdf', bytes: sharedPdf },
      ],
    });
    const fullInspect = inspectSyncArchive(fullBytes);
    expect(fullInspect.kind).toBe('raf-v2');
    if (fullInspect.kind === 'raf-v2') {
      // Two different attachment ids with identical bytes deduplicated to 1 encrypted chunk.
      expect(fullInspect.manifest.attachments).toHaveLength(1);
      expect(fullInspect.manifest.attachments[0]!.sourceIds).toEqual(['att-1', 'att-2']);
    }

    await expect(unlockSyncArchive(fullBytes, 'wrong-password-1')).rejects.toMatchObject<Partial<RafError>>({
      code: 'wrong_password',
    });

    const unlocked = await unlockSyncArchive(fullBytes, 'strong-password-1');
    expect(unlocked.format).toBe('raf-v2');
    expect(unlocked.tracker).toHaveLength(1);
    expect(unlocked.attachments).toHaveLength(1);
    expect(Array.from(unlocked.attachments[0]!.bytes)).toEqual(Array.from(sharedPdf));
  });

  it('decodes legacy mobile v1 encrypted JSON envelopes cleanly', async () => {
    const profile = createSampleProfile();
    const salt = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(12).fill(9);
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode('legacy-pass-1'), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const plain = enc.encode(JSON.stringify(profile));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: enc.encode('resume-autofill-encrypted/1'), tagLength: 128 },
        key,
        plain,
      ),
    );
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    const envelope = JSON.stringify({
      format: 'resume-autofill-encrypted',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) },
      cipher: { name: 'AES-GCM', iv: b64(iv), tagLength: 128 },
      data: b64(cipher),
    });

    const out = await unlockSyncArchive(enc.encode(envelope), 'legacy-pass-1');
    expect(out.format).toBe('v1-encrypted');
    expect(out.profile.resumes).toHaveLength(profile.resumes.length);
  });
});

describe('sync conflict planning and deduplicated merge', () => {
  it('plans diffs by updatedAt, deduplicates existing local files by SHA-256, and sweeps orphans on replace', async () => {
    const local = createSampleProfile();
    local.resumes[0]!.updatedAt = 2000;
    local.resumes[0]!.attachments.resumeFileId = 'local-existing';
    local.resumes[1]!.updatedAt = 1000;

    const incomingProfile = createSampleProfile();
    incomingProfile.resumes[0]!.updatedAt = 1500; // older than local
    incomingProfile.resumes[1]!.updatedAt = 3000; // newer than local
    incomingProfile.resumes[1]!.title = 'Updated EN Resume';
    incomingProfile.resumes[1]!.attachments.resumeFileId = 'remote-dup';

    const pdfBytes = new TextEncoder().encode('%PDF-1.4 identical binary');
    const storage = makeMemoryStorage([
      { id: 'local-existing', name: 'cv.pdf', type: 'application/pdf', bytes: pdfBytes },
      { id: 'local-orphan', name: 'old.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('orphan') },
    ]);

    const unlocked = await unlockSyncArchive(
      await buildRafArchive({
        profile: incomingProfile,
        mode: 'full',
        password: 'sync-password-9',
        iterations: ITERATIONS,
        attachments: [{ id: 'remote-dup', name: 'cv-copy.pdf', type: 'application/pdf', bytes: pdfBytes }],
      }),
      'sync-password-9',
    );

    const plan = planSyncMerge(local, unlocked, []);
    expect(plan.resumes.find((i) => i.resume.id === local.resumes[0]!.id)?.kind).toBe('local_newer_or_same');
    expect(plan.resumes.find((i) => i.resume.id === local.resumes[1]!.id)?.kind).toBe('incoming_newer');

    const merged = await applySyncMerge(local, unlocked, [], storage, { strategy: 'merge' });
    expect(merged.profile.resumes[0]!.updatedAt).toBe(2000);
    expect(merged.profile.resumes[1]!.title).toBe('Updated EN Resume');
    // Reused local file id via SHA-256 deduplication instead of storing a duplicate.
    expect(merged.profile.resumes[1]!.attachments.resumeFileId).toBe('local-existing');
    // Orphans are only listed; the caller deletes them after saving the merged profile.
    expect(merged.orphanFileIds).toEqual(['local-orphan']);
    expect(storage.items.has('local-orphan')).toBe(true);
  });
});

describe('offline QR encoder and zero-relay WebRTC transport', () => {
  it('encodes compact SDP tokens and renders valid SVG QR matrix', () => {
    const sampleSdp = [
      'v=0',
      'a=ice-ufrag:abcd',
      'a=ice-pwd:supersecretpassword12345',
      'a=fingerprint:sha-256 AA:BB:CC:DD',
      'a=setup:actpass',
      'a=sctp-port:5000',
      'a=candidate:1 1 udp 2122260223 192.168.1.42 51234 typ host',
    ].join('\r\n');
    const token = encodeCompactSignal({ type: 'offer', sdp: sampleSdp });
    expect(token.startsWith('RAF1:')).toBe(true);
    const decoded = decodeCompactSignal(token);
    expect(decoded.type).toBe('offer');
    expect(decoded.mdnsOnly).toBe(false);
    expect(decoded.sdp).toContain('192.168.1.42');

    const matrix = encodeQrMatrix(token);
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    // Top-left 7x7 finder outer ring must be dark
    for (let i = 0; i < 7; i++) {
      expect(matrix.modules[i]).toBe(1);
      expect(matrix.modules[i * matrix.size]).toBe(1);
    }
    const svg = renderQrSvg(token, 'Offer QR');
    expect(svg).toContain('<svg');
    expect(svg).toContain('aria-label="Offer QR"');
  });

  it('transfers encrypted `.raf` chunks over a mock WebRTC DataChannel with SHA-256 verification', async () => {
    const makeChannelPair = (): [DataChannelLike, DataChannelLike] => {
      const a: DataChannelLike = {
        readyState: 'open',
        bufferedAmount: 0,
        binaryType: 'arraybuffer',
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        send: (data) => queueMicrotask(() => b.onmessage?.({ data })),
        close: () => {
          a.readyState = 'closed';
        },
      };
      const b: DataChannelLike = {
        readyState: 'open',
        bufferedAmount: 0,
        binaryType: 'arraybuffer',
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        send: (data) => queueMicrotask(() => a.onmessage?.({ data })),
        close: () => {
          b.readyState = 'closed';
        },
      };
      return [a, b];
    };

    const [senderCh, receiverCh] = makeChannelPair();
    const offerSdp =
      'v=0\r\na=ice-ufrag:sendu\r\na=ice-pwd:sendpassword1234567890\r\na=fingerprint:sha-256 11:22\r\na=candidate:1 1 udp 1 192.168.1.10 4000 typ host\r\n';
    const answerSdp =
      'v=0\r\na=ice-ufrag:recvu\r\na=ice-pwd:recvpassword1234567890\r\na=fingerprint:sha-256 33:44\r\na=candidate:1 1 udp 1 192.168.1.20 4001 typ host\r\n';

    const senderPc: PeerConnectionLike = {
      localDescription: null,
      iceGatheringState: 'complete',
      connectionState: 'connected',
      ondatachannel: null,
      onicecandidate: null,
      onicegatheringstatechange: null,
      onconnectionstatechange: null,
      createDataChannel: () => senderCh,
      createOffer: async () => ({ type: 'offer', sdp: offerSdp }),
      createAnswer: async () => ({ type: 'answer', sdp: '' }),
      setLocalDescription: async (d) => {
        senderPc.localDescription = { type: d.type, sdp: d.sdp ?? '' };
      },
      setRemoteDescription: async () => undefined,
      close: () => undefined,
    };

    const receiverPc: PeerConnectionLike = {
      localDescription: null,
      iceGatheringState: 'complete',
      connectionState: 'connected',
      ondatachannel: null,
      onicecandidate: null,
      onicegatheringstatechange: null,
      onconnectionstatechange: null,
      createDataChannel: () => receiverCh,
      createOffer: async () => ({ type: 'offer', sdp: '' }),
      createAnswer: async () => ({ type: 'answer', sdp: answerSdp }),
      setLocalDescription: async (d) => {
        receiverPc.localDescription = { type: d.type, sdp: d.sdp ?? '' };
      },
      setRemoteDescription: async () => {
        queueMicrotask(() => receiverPc.ondatachannel?.({ channel: receiverCh }));
      },
      close: () => undefined,
    };

    const profile = createSampleProfile();
    const raf = await buildRafArchive({
      profile,
      mode: 'full',
      password: 'webrtc-pass-1',
      iterations: ITERATIONS,
      attachments: [{ id: profile.resumes[0]!.id, name: 'big.bin', type: 'application/octet-stream', bytes: new Uint8Array(40_000).fill(5) }],
    });

    const sender = await createSenderSession(() => senderPc);
    const receiver = await createReceiverSession(sender.offerToken, undefined, () => receiverPc);
    await sender.acceptAnswerAndSend(receiver.answerToken, raf);
    const received = await receiver.receivePromise;
    expect(received).toEqual(raf);

    const unlocked = await unlockSyncArchive(received, 'webrtc-pass-1');
    expect(unlocked.profile.resumes).toHaveLength(profile.resumes.length);
  });
});
