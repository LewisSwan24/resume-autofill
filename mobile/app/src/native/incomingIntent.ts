// Contract of the native IncomingIntent plugin (IncomingIntentPlugin.java): links, shared text and launcher shortcuts
// handed to the app by other apps. One item at a time, kept in memory only; take() empties the slot. Files go through
// IncomingFile instead (resumeImport/incoming.ts). createFakeIncomingIntent() is the stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

export interface IncomingIntentPlugin {
  /** {state:'none'} or {state:'ready', kind, ...}; the slot is empty afterwards. */
  take(): Promise<unknown>;
  addListener(event: 'incomingIntent', listener: () => void): Promise<{ remove(): Promise<void> }>;
}

export const INCOMING_INTENT_METHODS = ['take'] as const;
export const INCOMING_INTENT_EVENTS = ['incomingIntent'] as const;
// payloads: {state:'ready', kind:'view', url}
//           {state:'ready', kind:'text', text, subject?, cut}
//           {state:'ready', kind:'paste'} | {state:'ready', kind:'demo'}
//           {state:'ready', kind:'application', recordId, open:'detail'|'page', from?:'reminder'}
//           {state:'ready', kind:'refused', reason:'scheme'|'too_long'}

/** The real plugin (only on a phone). */
export function createNativeIncomingIntent(): IncomingIntentPlugin {
  return registerPlugin<IncomingIntentPlugin>('IncomingIntent');
}

// ---------------------------------------------------------------- fake for tests

export type FakeIncomingIntent = IncomingIntentPlugin & {
  /** Put a payload in the slot (newest wins) and fire incomingIntent, like the native side. */
  deliver(payload: unknown): void;
  /** Number of take() calls. */
  takes: number;
  calls: { method: string; args: unknown }[];
};

export function createFakeIncomingIntent(): FakeIncomingIntent {
  const listeners = new Set<() => void>();
  let slot: unknown = null;
  const fake: FakeIncomingIntent = {
    takes: 0,
    calls: [],
    async take() {
      fake.takes += 1;
      fake.calls.push({ method: 'take', args: undefined });
      const payload = slot ?? { state: 'none' };
      slot = null;
      return payload;
    },
    async addListener(_event, listener) {
      listeners.add(listener);
      return { remove: async () => void listeners.delete(listener) };
    },
    deliver(payload) {
      slot = payload;
      for (const listener of [...listeners]) listener();
    },
  };
  return fake;
}
