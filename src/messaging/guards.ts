// Sender / payload guards. Every listener must call these before acting on a message.
import { browser } from 'wxt/browser';
import { MESSAGE_TYPES, type Message } from './protocol';

export type Sender = {
  id?: string;
  url?: string;
  tab?: unknown;
};

const KNOWN_TYPES: ReadonlySet<string> = new Set(MESSAGE_TYPES);

/** Message came from this extension (any of its contexts). */
export function isFromExtension(sender: Sender | undefined | null): boolean {
  return !!sender && typeof sender.id === 'string' && sender.id === browser.runtime.id;
}

/** Message came from one of this extension's content scripts (same id and attached to a tab). */
export function isFromContentScript(sender: Sender | undefined | null): boolean {
  return isFromExtension(sender) && sender?.tab != null;
}

/** Message came from an extension page (side panel, options, popup): the sender url lives in our origin. */
export function isFromExtensionPage(sender: Sender | undefined | null): boolean {
  if (!isFromExtension(sender)) return false;
  const url = sender?.url;
  if (typeof url !== 'string') return false;
  const base = browser.runtime.getURL('');
  return url.startsWith(base);
}

/** Structural check: an object whose `type` is one of the known message types. */
export function isValidMessage(x: unknown): x is Message {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const type = (x as { type?: unknown }).type;
  return typeof type === 'string' && KNOWN_TYPES.has(type);
}
