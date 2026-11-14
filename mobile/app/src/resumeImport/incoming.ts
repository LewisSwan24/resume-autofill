// Files that other apps hand to this one ("open with" and "share"): the native IncomingFile plugin's payload checked
// again on this side, and a source the import flow subscribes to. Nothing here logs or stores what arrives.
import { DOCX_MIME, IMPORT_MAX_BYTES, PDF_MIME, type ImportFile } from './types';

export type IncomingEvent =
  | { kind: 'reading'; name: string }
  | { kind: 'file'; file: ImportFile } // source 'view' | 'send'
  | { kind: 'error'; reason: 'too_large' | 'wrong_type' | 'unreadable' | 'empty' };

export interface IncomingFileSource {
  /** Calls handler for the pending item now (cold start) and for every later one. Returns unsubscribe. */
  subscribe(handler: (event: IncomingEvent) => void): () => void;
}

/** The native plugin as registered with Capacitor's registerPlugin('IncomingFile'). */
export interface IncomingFilePlugin {
  take(): Promise<unknown>;
  addListener(event: 'incomingFile', listener: (data: unknown) => void): Promise<{ remove: () => Promise<void> }>;
}

const MAX_NAME = 128;
const ERROR_REASONS = ['too_large', 'wrong_type', 'unreadable', 'empty'] as const;
type IncomingError = (typeof ERROR_REASONS)[number];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const fail = (reason: IncomingError): IncomingEvent => ({ kind: 'error', reason });

/** Same cleaning as the native side, applied again here. */
export function cleanFileName(name: unknown): string {
  if (typeof name !== 'string') return '';
  const last = name.split(/[/\\]/).pop() ?? '';
  const visible = last.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return Array.from(visible).slice(0, MAX_NAME).join('').trim();
}

/** The type the file is taken as: PDF or .docx by what the sender said, or by its name when it said nothing useful. */
function typeOf(mimeType: unknown, name: string): string | null {
  if (mimeType !== undefined && typeof mimeType !== 'string') return null;
  const type = (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === PDF_MIME || type === DOCX_MIME) return type;
  if (type !== '' && type !== 'application/octet-stream') return null;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return PDF_MIME;
  if (lower.endsWith('.docx')) return DOCX_MIME;
  return null;
}

function decode(data: string): Uint8Array | null {
  if (!BASE64.test(data)) return null;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseReady(raw: Record<string, unknown>): IncomingEvent {
  const source = raw.source;
  if (source !== 'view' && source !== 'send') return fail('unreadable');
  const name = cleanFileName(raw.name);
  const mimeType = typeOf(raw.mimeType, name);
  if (!mimeType) return fail('wrong_type');
  const data = raw.data;
  if (typeof data !== 'string') return fail('unreadable');
  // Checked on the text, so an oversized payload is never decoded.
  if (Math.floor(data.length / 4) * 3 > IMPORT_MAX_BYTES) return fail('too_large');
  if (typeof raw.size === 'number' && raw.size > IMPORT_MAX_BYTES) return fail('too_large');
  const bytes = decode(data);
  if (!bytes) return fail('unreadable');
  if (bytes.length > IMPORT_MAX_BYTES) return fail('too_large');
  if (bytes.length === 0) return fail('empty');
  return { kind: 'file', file: { name, mimeType, bytes, source } };
}

/** Validates what take() returned. Null when nothing is pending. Never throws. */
export function parseNativeIncoming(raw: unknown): IncomingEvent | null {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('unreadable');
    const payload = raw as Record<string, unknown>;
    switch (payload.state) {
      case 'none':
        return null;
      case 'reading':
        return { kind: 'reading', name: cleanFileName(payload.name) };
      case 'error':
        return fail(ERROR_REASONS.find((r) => r === payload.reason) ?? 'unreadable');
      case 'ready':
        return parseReady(payload);
      default:
        return fail('unreadable');
    }
  } catch {
    return fail('unreadable');
  }
}

/**
 * Takes the pending item once the listener is in place (a cold start's file is already waiting), then again after
 * every event. One take() at a time: events during a take fold into one more take after it.
 */
export function createNativeIncomingSource(plugin: IncomingFilePlugin): IncomingFileSource {
  return {
    subscribe(handler) {
      let active = true;
      let busy = false;
      let again = false;
      let listener: { remove: () => Promise<void> } | null = null;

      const pump = async (): Promise<void> => {
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        try {
          do {
            again = false;
            let raw: unknown;
            try {
              raw = await plugin.take();
            } catch {
              continue;
            }
            if (!active) return;
            const event = parseNativeIncoming(raw);
            if (event) handler(event);
          } while (again && active);
        } finally {
          busy = false;
        }
      };

      plugin.addListener('incomingFile', () => void pump()).then(
        (handle) => {
          if (!active) {
            void handle.remove();
            return;
          }
          listener = handle;
          void pump();
        },
        () => {
          if (active) void pump();
        },
      );

      return () => {
        active = false;
        if (listener) void listener.remove();
        listener = null;
      };
    },
  };
}
