// Home's paste box: turn what was pasted (a link, or share text holding one) into a checked http(s) URL, the host
// to show, and a title when the share text had one. Pure, so the rules are tested on their own.

import { recentKey } from '../store/recentPages';

export type PasteError = 'empty' | 'no_link' | 'unsupported_scheme' | 'invalid' | 'too_long';
export type ParsedLink =
  | { ok: true; url: string; host: string; title?: string; insecure: boolean }
  | { ok: false; code: PasteError };

const MAX_INPUT = 4096;
const MAX_URL = 2048;
const MAX_TITLE = 80;

const LINK = /https?:\/\/[^\s<>"'，。；、！？）】」』《》]+/i;
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const fail = (code: PasteError): ParsedLink => ({ ok: false, code });

export function cleanTitle(text: string): string | undefined {
  const cleaned = text
    .replace(/[【】[\]「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s:：\-–—|]+$/, '')
    .trim();
  if (!cleaned) return undefined;
  // The stored title is limited in UTF-16 units (string length), so count those, and never split an emoji.
  let title = '';
  for (const char of cleaned) {
    if (title.length + char.length > MAX_TITLE) break;
    title += char;
  }
  return title.trim() || undefined;
}

export function parseApplicationLink(input: string): ParsedLink {
  const text = input.trim();
  if (!text) return fail('empty');
  if (text.length > MAX_INPUT) return fail('too_long');

  let candidate: string;
  let title: string | undefined;
  const match = LINK.exec(text);
  if (match) {
    candidate = match[0];
    title = cleanTitle(text.slice(0, match.index));
  } else if (!/\s/.test(text) && BARE_DOMAIN.test(text)) {
    candidate = `https://${text}`;
  } else if (SCHEME.test(text)) {
    // "https://" with nothing usable after it is a broken link, not a foreign scheme.
    return fail(/^https?:/i.test(text) ? 'invalid' : 'unsupported_scheme');
  } else {
    return fail('no_link');
  }

  return checkCandidate(candidate, title);
}

/** One found http(s) candidate → a checked link (trailing punctuation off, credentials dropped, size checked). */
function checkCandidate(raw: string, title: string | undefined): ParsedLink {
  const candidate = raw.replace(/[.,;:!?)]+$/, '');
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail('invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('unsupported_scheme');
  if (!url.hostname.includes('.')) return fail('invalid');
  url.username = '';
  url.password = '';
  if (url.href.length > MAX_URL) return fail('too_long');

  const host = url.hostname.replace(/^www\./i, '');
  const parsed: ParsedLink = { ok: true, url: url.href, host, insecure: url.protocol === 'http:' };
  if (title) parsed.title = title;
  return parsed;
}

export type FoundParsedLink = Extract<ParsedLink, { ok: true }>;

/**
 * Every http(s) link in a shared or copied text, in text order. Only http(s):// is found, so
 * javascript:, file:, content: and app schemes are never links. Duplicates by recentKey (the URL without its
 * fragment) are dropped; each link's title is the text before it on the same line, back to the previous link.
 */
export function parseApplicationLinks(text: string, max = 20): FoundParsedLink[] {
  const found: FoundParsedLink[] = [];
  const seen = new Set<string>();
  const all = new RegExp(LINK.source, 'gi');
  let from = 0;
  for (let match = all.exec(text); match && found.length < max; match = all.exec(text)) {
    const lineStart = text.lastIndexOf('\n', match.index - 1) + 1;
    const before = text.slice(Math.max(from, lineStart), match.index);
    from = match.index + match[0].length;
    const parsed = checkCandidate(match[0], cleanTitle(before));
    if (!parsed.ok) continue;
    const key = recentKey(parsed.url);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(parsed);
  }
  return found;
}
