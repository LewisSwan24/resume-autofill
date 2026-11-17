// Zero-relay local LAN WebRTC DataChannel transport (`iceServers: []`) for `.raf` encrypted streams.
import { sha256Hex } from './raf';

export const WEBRTC_CHUNK_BYTES = 16 * 1024;
export const WEBRTC_MAX_BYTES = 100 * 1024 * 1024;
const SIGNAL_PREFIX = 'RAF1:';

export interface CompactSignalPayload {
  t: 'o' | 'a';
  u: string;
  p: string;
  f: string;
  s?: 'actpass' | 'active' | 'passive';
  m: number;
  c: string[];
}

export interface DecodedSignal {
  type: 'offer' | 'answer';
  sdp: string;
  mdnsOnly: boolean;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const std = text.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Compress a browser DataChannel SDP into a compact QR-friendly token, keeping host ICE & DTLS params. */
export function encodeCompactSignal(desc: { type: 'offer' | 'answer'; sdp: string }): string {
  const lines = desc.sdp.split(/\r?\n/);
  let u = '';
  let p = '';
  let f = '';
  let s: CompactSignalPayload['s'];
  let m = 5000;
  const c: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('a=ice-ufrag:')) u = line.slice('a=ice-ufrag:'.length);
    else if (line.startsWith('a=ice-pwd:')) p = line.slice('a=ice-pwd:'.length);
    else if (line.startsWith('a=fingerprint:')) f = line.slice('a=fingerprint:'.length);
    else if (line.startsWith('a=setup:')) {
      const v = line.slice('a=setup:'.length);
      if (v === 'actpass' || v === 'active' || v === 'passive') s = v;
    } else if (line.startsWith('a=sctp-port:')) {
      const parsed = Number(line.slice('a=sctp-port:'.length));
      if (Number.isFinite(parsed) && parsed > 0) m = parsed;
    } else if (line.startsWith('a=candidate:')) {
      const cand = line.slice('a=candidate:'.length);
      if (cand.includes(' typ host')) c.push(cand);
    }
  }

  if (!u || !p || !f) {
    // Fallback: encode full SDP when non-standard lines appear.
    return `${SIGNAL_PREFIX}RAW:${toBase64Url(enc.encode(JSON.stringify(desc)))}`;
  }

  const compact: CompactSignalPayload = {
    t: desc.type === 'offer' ? 'o' : 'a',
    u,
    p,
    f,
    ...(s ? { s } : {}),
    m,
    c: c.slice(0, 4),
  };
  return `${SIGNAL_PREFIX}${toBase64Url(enc.encode(JSON.stringify(compact)))}`;
}

/** Reconstruct full WebRTC SDP from a compact signal token (also accepts raw JSON). */
export function decodeCompactSignal(token: string): DecodedSignal {
  const trimmed = token.trim();
  if (trimmed.startsWith(`${SIGNAL_PREFIX}RAW:`)) {
    const raw = JSON.parse(dec.decode(fromBase64Url(trimmed.slice(`${SIGNAL_PREFIX}RAW:`.length)))) as {
      type: 'offer' | 'answer';
      sdp: string;
    };
    const mdnsOnly = !hasDirectIpv4HostCandidate(raw.sdp);
    return { type: raw.type, sdp: raw.sdp, mdnsOnly };
  }

  if (trimmed.startsWith(SIGNAL_PREFIX)) {
    const p = JSON.parse(dec.decode(fromBase64Url(trimmed.slice(SIGNAL_PREFIX.length)))) as CompactSignalPayload;
    const type: 'offer' | 'answer' = p.t === 'o' ? 'offer' : 'answer';
    const setup = p.s ?? (type === 'offer' ? 'actpass' : 'active');
    const sdpLines = [
      'v=0',
      'o=- 0 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      `a=ice-ufrag:${p.u}`,
      `a=ice-pwd:${p.p}`,
      'a=ice-options:trickle',
      `a=fingerprint:${p.f}`,
      `a=setup:${setup}`,
      'a=mid:0',
      `a=sctp-port:${p.m}`,
      'a=max-message-size:262144',
      ...p.c.map((cand) => `a=candidate:${cand}`),
      'a=end-of-candidates',
    ];
    const sdp = `${sdpLines.join('\r\n')}\r\n`;
    return { type, sdp, mdnsOnly: !hasDirectIpv4HostCandidate(sdp) };
  }

  const fallback = JSON.parse(trimmed) as { type: 'offer' | 'answer'; sdp: string };
  if ((fallback.type !== 'offer' && fallback.type !== 'answer') || typeof fallback.sdp !== 'string') {
    throw new Error('Invalid signaling payload');
  }
  return { type: fallback.type, sdp: fallback.sdp, mdnsOnly: !hasDirectIpv4HostCandidate(fallback.sdp) };
}

function hasDirectIpv4HostCandidate(sdp: string): boolean {
  return sdp.split(/\r?\n/).some((line) => {
    if (!line.startsWith('a=candidate:') || !line.includes(' typ host')) return false;
    return !line.includes('.local ') && /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line);
  });
}

export interface DataChannelLike {
  readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold?: number;
  binaryType: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string | ArrayBuffer | ArrayBufferView }) => void) | null;
  onbufferedamountlow?: (() => void) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(): void;
}

export interface PeerConnectionLike {
  localDescription: { type: 'offer' | 'answer'; sdp: string } | null;
  iceGatheringState: string;
  connectionState: string;
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel(label: string, opts?: { ordered?: boolean }): DataChannelLike;
  createOffer(): Promise<{ type: 'offer' | 'answer'; sdp?: string }>;
  createAnswer(): Promise<{ type: 'offer' | 'answer'; sdp?: string }>;
  setLocalDescription(desc: { type: 'offer' | 'answer'; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: 'offer' | 'answer'; sdp?: string }): Promise<void>;
  close(): void;
}

export type PeerFactory = (config: RTCConfiguration) => PeerConnectionLike;

const defaultPeerFactory: PeerFactory = (config) => {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('RTCPeerConnection is unavailable in this environment');
  }
  return new RTCPeerConnection(config) as unknown as PeerConnectionLike;
};

async function waitIceComplete(pc: PeerConnectionLike, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const prev = pc.onicegatheringstatechange;
    pc.onicegatheringstatechange = () => {
      prev?.();
      if (pc.iceGatheringState === 'complete') finish();
    };
    const prevCand = pc.onicecandidate;
    pc.onicecandidate = (ev) => {
      prevCand?.(ev);
      if (!ev.candidate) finish();
    };
  });
}

export interface RafWireMeta {
  kind: 'raf-meta';
  totalBytes: number;
  sha256: string;
  chunkCount: number;
}

export interface RafWireAck {
  kind: 'raf-ack';
  ok: boolean;
  sha256: string;
}

/** Stream already-encrypted `.raf` bytes over an open DataChannel with integrity verification. */
export async function sendRafOverChannel(
  channel: DataChannelLike,
  rafBytes: Uint8Array,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (rafBytes.byteLength > WEBRTC_MAX_BYTES) {
    throw new Error('Payload exceeds WebRTC sync max size');
  }
  const sha256 = await sha256Hex(rafBytes);
  const chunkCount = Math.ceil(rafBytes.byteLength / WEBRTC_CHUNK_BYTES);
  const meta: RafWireMeta = { kind: 'raf-meta', totalBytes: rafBytes.byteLength, sha256, chunkCount };

  const ackPromise = new Promise<void>((resolve, reject) => {
    const prevMsg = channel.onmessage;
    channel.onmessage = (ev) => {
      prevMsg?.(ev);
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as RafWireAck;
        if (msg.kind === 'raf-ack') {
          if (msg.ok && msg.sha256 === sha256) resolve();
          else reject(new Error('Receiver reported SHA-256 mismatch'));
        }
      } catch {
        /* ignore unrelated */
      }
    };
    const prevErr = channel.onerror;
    channel.onerror = (err) => {
      prevErr?.(err);
      reject(new Error('DataChannel error during transfer'));
    };
  });

  channel.send(JSON.stringify(meta));
  let offset = 0;
  while (offset < rafBytes.byteLength) {
    if (channel.bufferedAmount > 256 * 1024) {
      await new Promise<void>((resolve) => {
        channel.bufferedAmountLowThreshold = 64 * 1024;
        if (channel.bufferedAmount <= 64 * 1024) {
          resolve();
          return;
        }
        channel.onbufferedamountlow = () => {
          channel.onbufferedamountlow = null;
          resolve();
        };
        setTimeout(resolve, 40);
      });
    }
    const end = Math.min(offset + WEBRTC_CHUNK_BYTES, rafBytes.byteLength);
    channel.send(rafBytes.slice(offset, end));
    offset = end;
    onProgress?.(offset, rafBytes.byteLength);
  }

  await ackPromise;
}

/** Assemble incoming chunks from a DataChannel into verified `.raf` bytes. */
export function attachRafReceiver(
  channel: DataChannelLike,
  onProgress?: (receivedBytes: number, totalBytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  channel.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    let expectedMeta: RafWireMeta | null = null;
    let buffer: Uint8Array<ArrayBuffer> | null = null;
    let offset = 0;

    channel.onmessage = async (ev) => {
      try {
        if (typeof ev.data === 'string') {
          const msg = JSON.parse(ev.data) as RafWireMeta;
          if (msg.kind === 'raf-meta') {
            if (msg.totalBytes <= 0 || msg.totalBytes > WEBRTC_MAX_BYTES) {
              throw new Error('Incoming `.raf` exceeds safety limit');
            }
            expectedMeta = msg;
            buffer = new Uint8Array(msg.totalBytes);
            offset = 0;
            onProgress?.(0, msg.totalBytes);
          }
          return;
        }

        if (!expectedMeta || !buffer) {
          throw new Error('Received binary chunk before metadata');
        }
        const part =
          ev.data instanceof ArrayBuffer
            ? new Uint8Array(ev.data)
            : new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
        if (offset + part.byteLength > buffer.byteLength) {
          throw new Error('Incoming transfer overflowed announced length');
        }
        buffer.set(part, offset);
        offset += part.byteLength;
        onProgress?.(offset, buffer.byteLength);

        if (offset === buffer.byteLength) {
          const actualHash = await sha256Hex(buffer);
          const ok = actualHash === expectedMeta.sha256;
          channel.send(JSON.stringify({ kind: 'raf-ack', ok, sha256: actualHash } satisfies RafWireAck));
          if (!ok) {
            reject(new Error('SHA-256 verification failed over WebRTC'));
          } else {
            resolve(buffer);
          }
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    channel.onerror = () => reject(new Error('WebRTC DataChannel failed'));
  });
}

/** Initiator helper (zero STUN/TURN, `iceServers: []`): generates Offer token and sends encrypted `.raf` bytes on connect. */
export async function createSenderSession(factory: PeerFactory = defaultPeerFactory): Promise<{
  offerToken: string;
  mdnsOnly: boolean;
  acceptAnswerAndSend: (
    answerToken: string,
    rafBytes: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
    timeoutMs?: number,
  ) => Promise<void>;
  close: () => void;
}> {
  const pc = factory({ iceServers: [] });
  const channel = pc.createDataChannel('raf-sync', { ordered: true });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);
  const local = pc.localDescription;
  if (!local?.sdp) {
    pc.close();
    throw new Error('Failed to gather local SDP offer');
  }
  const offerToken = encodeCompactSignal(local);
  const mdnsOnly = !hasDirectIpv4HostCandidate(local.sdp);

  const acceptAnswerAndSend = async (
    answerToken: string,
    rafBytes: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
    timeoutMs = 15_000,
  ) => {
    const remote = decodeCompactSignal(answerToken);
    if (remote.type !== 'answer') throw new Error('Expected an answer token');
    const opened = new Promise<void>((resolve, reject) => {
      if (channel.readyState === 'open') {
        resolve();
        return;
      }
      const timer = setTimeout(() => reject(new Error('WebRTC connection timed out (mDNS or firewall); export `.raf` file instead')), timeoutMs);
      channel.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      channel.onerror = () => {
        clearTimeout(timer);
        reject(new Error('WebRTC DataChannel failed to open'));
      };
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: remote.sdp });
    await opened;
    await sendRafOverChannel(channel, rafBytes, onProgress);
  };

  return {
    offerToken,
    mdnsOnly,
    acceptAnswerAndSend,
    close: () => {
      try {
        channel.close();
      } catch {
        /* ignore */
      }
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Receiver helper (zero STUN/TURN, `iceServers: []`): consumes Offer token, yields Answer token + incoming `.raf` promise. */
export async function createReceiverSession(
  offerToken: string,
  onProgress?: (received: number, total: number) => void,
  factory: PeerFactory = defaultPeerFactory,
): Promise<{
  answerToken: string;
  mdnsOnly: boolean;
  receivePromise: Promise<Uint8Array<ArrayBuffer>>;
  close: () => void;
}> {
  const remote = decodeCompactSignal(offerToken);
  if (remote.type !== 'offer') throw new Error('Expected an offer token');

  const pc = factory({ iceServers: [] });
  const receivePromise = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    pc.ondatachannel = (ev) => {
      attachRafReceiver(ev.channel, onProgress).then(resolve, reject);
    };
  });

  await pc.setRemoteDescription({ type: 'offer', sdp: remote.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);
  const local = pc.localDescription;
  if (!local?.sdp) {
    pc.close();
    throw new Error('Failed to generate local SDP answer');
  }

  return {
    answerToken: encodeCompactSignal(local),
    mdnsOnly: !hasDirectIpv4HostCandidate(local.sdp),
    receivePromise,
    close: () => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    },
  };
}
