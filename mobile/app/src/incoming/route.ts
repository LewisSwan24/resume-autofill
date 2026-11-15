// Where an incoming link goes and whether it may run now or must wait. Pure.
import { DEMO_ORIGIN } from '../browser/model/constants';
import { cleanTitle, parseApplicationLink, parseApplicationLinks, type ParsedLink } from '../home/pasteLink';
import type { IncomingLinkEvent } from './events';

/** A checked http(s) link ready to open. */
export interface FoundLink {
  url: string;
  host: string;
  title?: string;
  insecure: boolean;
}

export type SayKey = 'm.in.noLink' | 'm.in.tooLong' | 'm.paste.err.unsupported_scheme' | 'm.paste.err.invalid' | 'm.paste.err.too_long';

export type IncomingRoute =
  | { do: 'open'; link: FoundLink; source: 'view' | 'share' }
  | { do: 'choose'; links: FoundLink[]; more: number }
  | { do: 'demo' }
  | { do: 'paste' }
  | { do: 'application'; recordId: string; open: 'detail' | 'page'; from?: 'reminder' }
  | { do: 'missing' }
  | { do: 'say'; key: SayKey };

export interface BusyState {
  ready: boolean;
  importOpen: boolean;
  runActive: boolean;
  onboarding: boolean;
}

/** The choice sheet lists at most this many links. */
export const CHOOSE_MAX = 10;

export function toFoundLink(parsed: Extract<ParsedLink, { ok: true }>): FoundLink {
  const link: FoundLink = { url: parsed.url, host: parsed.host, insecure: parsed.insecure };
  if (parsed.title) link.title = parsed.title;
  return link;
}

function isDemo(url: string): boolean {
  try {
    return new URL(url).origin === DEMO_ORIGIN;
  } catch {
    return false;
  }
}

function errorKey(code: Extract<ParsedLink, { ok: false }>['code']): SayKey {
  if (code === 'unsupported_scheme') return 'm.paste.err.unsupported_scheme';
  if (code === 'too_long') return 'm.paste.err.too_long';
  return 'm.paste.err.invalid';
}

export function routeIncoming(e: IncomingLinkEvent, ctx: { recordIds: ReadonlySet<string> }): IncomingRoute {
  switch (e.kind) {
    case 'view': {
      if (isDemo(e.url)) return { do: 'demo' };
      // A VIEW is the URL itself: never dig an http link out of some other scheme's text.
      if (!/^https?:\/\//i.test(e.url.trim())) {
        return { do: 'say', key: /^https?:/i.test(e.url.trim()) ? 'm.paste.err.invalid' : 'm.paste.err.unsupported_scheme' };
      }
      const parsed = parseApplicationLink(e.url);
      if (!parsed.ok) return { do: 'say', key: errorKey(parsed.code) };
      const { title: _ignored, ...link } = toFoundLink(parsed);
      return { do: 'open', link, source: 'view' };
    }
    case 'text': {
      const links = parseApplicationLinks(e.text).map(toFoundLink);
      if (links.length === 0) return { do: 'say', key: e.cut ? 'm.in.tooLong' : 'm.in.noLink' };
      if (links.length === 1) {
        const link = links[0]!;
        const title = link.title ?? (e.subject ? cleanTitle(e.subject) : undefined);
        return { do: 'open', link: title ? { ...link, title } : link, source: 'share' };
      }
      return { do: 'choose', links: links.slice(0, CHOOSE_MAX), more: Math.max(0, links.length - CHOOSE_MAX) };
    }
    case 'paste':
      return { do: 'paste' };
    case 'demo':
      return { do: 'demo' };
    case 'application':
      if (!ctx.recordIds.has(e.recordId)) return { do: 'missing' };
      return e.from ? { do: 'application', recordId: e.recordId, open: e.open, from: e.from } : { do: 'application', recordId: e.recordId, open: e.open };
    case 'refused':
      return { do: 'say', key: e.reason === 'too_long' ? 'm.paste.err.too_long' : 'm.paste.err.unsupported_scheme' };
  }
}

type Column = 'page' | 'choose' | 'paste' | 'detail' | 'say';

function columnOf(route: IncomingRoute): Column {
  switch (route.do) {
    case 'open':
    case 'demo':
      return 'page';
    case 'application':
      return route.open === 'page' ? 'page' : 'detail';
    case 'choose':
      return 'choose';
    case 'paste':
      return 'paste';
    case 'missing':
    case 'say':
      return 'say';
  }
}

/** Table 3.5. 'drop' is the onboarding "ignored" cells (the caller says m.in.finishOnboarding). */
export function whenToRun(route: IncomingRoute, busy: BusyState): 'now' | 'wait' | 'drop' {
  const column = columnOf(route);
  if (!busy.ready) return 'wait';
  if (busy.onboarding && (column === 'paste' || column === 'detail')) return 'drop';
  if (busy.importOpen) return column === 'say' ? 'now' : 'wait';
  if (busy.runActive) return column === 'page' || column === 'choose' ? 'wait' : 'now';
  return 'now';
}

/** The toast said once when a page open has to wait, else null. */
export function waitingMessage(route: IncomingRoute, busy: BusyState): 'm.in.waiting' | 'm.in.waitingFill' | null {
  if (!busy.ready || columnOf(route) !== 'page' || whenToRun(route, busy) !== 'wait') return null;
  if (busy.importOpen) return 'm.in.waiting';
  if (busy.runActive) return 'm.in.waitingFill';
  return null;
}
