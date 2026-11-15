// What the native IncomingIntent plugin hands over (a link, shared text, a launcher shortcut), checked before the
// app acts on it. Anything malformed is dropped: another app chose these bytes.
import type { IncomingIntentPlugin } from '../native/incomingIntent';

export type IncomingLinkEvent =
  | { kind: 'view'; url: string }
  | { kind: 'text'; text: string; subject?: string; cut: boolean }
  | { kind: 'paste' }
  | { kind: 'demo' }
  /** `from: 'reminder'`: a deadline notification's 打开网申页面, whose page closes back to 网申. */
  | { kind: 'application'; recordId: string; open: 'detail' | 'page'; from?: 'reminder' }
  | { kind: 'refused'; reason: 'scheme' | 'too_long' };

const MAX_URL = 4096;
const MAX_TEXT_CODE_POINTS = 8192;
const MAX_SUBJECT = 200;
const RECORD_ID = /^[A-Za-z0-9-]{1,64}$/;
/** Control and format characters (bidi overrides, zero-width marks...) never belong in a title. */
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

function codePoints(text: string, limit: number): number {
  let n = 0;
  for (const _ of text) {
    n += 1;
    if (n > limit) break;
  }
  return n;
}

function cleanSubject(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(CONTROL, '').trim();
  if (!cleaned) return undefined;
  let out = '';
  for (const char of cleaned) {
    if (out.length + char.length > MAX_SUBJECT) break;
    out += char;
  }
  return out;
}

/** The plugin's take() result → an event, or null for {state:'none'} and anything malformed. Never throws. */
export function parseIncomingIntent(raw: unknown): IncomingLinkEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.state !== 'ready') return null;
  switch (r.kind) {
    case 'view':
      return typeof r.url === 'string' && r.url.length > 0 && r.url.length <= MAX_URL ? { kind: 'view', url: r.url } : null;
    case 'text': {
      if (typeof r.text !== 'string' || typeof r.cut !== 'boolean') return null;
      if (codePoints(r.text, MAX_TEXT_CODE_POINTS) > MAX_TEXT_CODE_POINTS) return null;
      const subject = cleanSubject(r.subject);
      return subject === undefined ? { kind: 'text', text: r.text, cut: r.cut } : { kind: 'text', text: r.text, subject, cut: r.cut };
    }
    case 'paste':
      return { kind: 'paste' };
    case 'demo':
      return { kind: 'demo' };
    case 'application':
      if (typeof r.recordId !== 'string' || !RECORD_ID.test(r.recordId)) return null;
      if (r.open !== 'detail' && r.open !== 'page') return null;
      return r.from === 'reminder'
        ? { kind: 'application', recordId: r.recordId, open: r.open, from: 'reminder' }
        : { kind: 'application', recordId: r.recordId, open: r.open };
    case 'refused':
      return r.reason === 'scheme' || r.reason === 'too_long' ? { kind: 'refused', reason: r.reason } : null;
    default:
      return null;
  }
}

export interface IncomingLinkSource {
  subscribe(handler: (e: IncomingLinkEvent) => void): () => void;
}

/**
 * Takes the waiting item once the listener is in place (a cold start's link is already waiting), then again after
 * every event. One take() at a time: events during a take fold into one more take after it. Same pump as
 * resumeImport/incoming.ts createNativeIncomingSource, for the other plugin.
 */
export function createIncomingLinkSource(plugin: IncomingIntentPlugin): IncomingLinkSource {
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
            const event = parseIncomingIntent(raw);
            if (event) handler(event);
          } while (again && active);
        } finally {
          busy = false;
        }
      };

      plugin.addListener('incomingIntent', () => void pump()).then(
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
