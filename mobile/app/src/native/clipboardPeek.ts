// Contract of the native ClipboardPeek plugin (ClipboardPeekPlugin.java). hint() looks only at the clip's description
// (no Android 13 toast); readText() reads the text and is called only when the rules in clipboard/clipboardOffer.ts
// allow it. createFakeClipboard() is the stand-in for unit tests.
import { registerPlugin } from '@capacitor/core';

export interface ClipHint {
  focused: boolean;            // the activity window has focus right now
  hasText: boolean;            // text/plain, text/html or text/uri-list
  stamp: number | null;        // ClipDescription.getTimestamp()
  likelyUrl: 'yes' | 'no' | 'unknown';   // API 31+: classification complete → confidence(TYPE_URL) ≥ 0.5; else unknown
  sensitive: boolean;          // extras android.content.extra.IS_SENSITIVE
}

export interface ClipboardPeekPlugin {
  hint(): Promise<ClipHint>;                        // never reads the content; no Android 13 toast
  readText(): Promise<{ text: string | null }>;     // null when not focused, no text or sensitive; cut to 4096 chars
  addListener(event: 'focus', listener: () => void): Promise<{ remove(): Promise<void> }>;
}

export const CLIPBOARD_METHODS = ['hint', 'readText'] as const;
export const CLIPBOARD_EVENTS = ['focus'] as const;

/** Longest text readText() hands over, in UTF-16 units (Java String length). */
export const CLIPBOARD_MAX_TEXT = 4096;

/** The real plugin (only on a phone). */
export function createNativeClipboardPeek(): ClipboardPeekPlugin {
  return registerPlugin<ClipboardPeekPlugin>('ClipboardPeek');
}

// ---------------------------------------------------------------- fake for tests

type ClipInit = Partial<ClipHint> & { text?: string | null };

export type FakeClipboard = ClipboardPeekPlugin & {
  /** Change the clip or the focus; fields left out keep their value. */
  set(next: ClipInit): void;
  /** Fire the focus event, like MainActivity.onWindowFocusChanged(true). */
  focus(): void;
  reads: number;
  hints: number;
  calls: { method: string; args: unknown }[];
};

export function createFakeClipboard(init: ClipInit = {}): FakeClipboard {
  const listeners = new Set<() => void>();
  let text: string | null = init.text ?? null;
  let hint: ClipHint = {
    focused: true,
    hasText: text !== null,
    stamp: null,
    likelyUrl: 'unknown',
    sensitive: false,
  };
  const apply = (next: ClipInit) => {
    const { text: nextText, ...rest } = next;
    if (nextText !== undefined) {
      text = nextText;
      if (rest.hasText === undefined) rest.hasText = nextText !== null;
    }
    hint = { ...hint, ...rest };
  };
  apply(init);

  const fake: FakeClipboard = {
    reads: 0,
    hints: 0,
    calls: [],
    async hint() {
      fake.hints += 1;
      fake.calls.push({ method: 'hint', args: undefined });
      return { ...hint };
    },
    async readText() {
      fake.reads += 1;
      fake.calls.push({ method: 'readText', args: undefined });
      if (!hint.focused || !hint.hasText || hint.sensitive || text === null) return { text: null };
      return { text: text.slice(0, CLIPBOARD_MAX_TEXT) };
    },
    async addListener(_event, listener) {
      listeners.add(listener);
      return { remove: async () => void listeners.delete(listener) };
    },
    set: apply,
    focus() {
      for (const listener of [...listeners]) listener();
    },
  };
  return fake;
}
