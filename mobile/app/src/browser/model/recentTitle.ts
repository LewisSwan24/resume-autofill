// The page title of a recent application page: written once the page loads, so the Home list reads
// 「外层示例页」 instead of a bare host. Pure; the App stores the result through updateAppState (encrypted state.enc).
import type { AppState } from '../../store/appStateStore';

const MAX_TITLE = 80;

/** Lower case, no www., no port (the shown host keeps a non-default port, the recent entry does not). */
const bare = (host: string) =>
  host
    .toLowerCase()
    .replace(/^\[([^\]]*)\](?::\d+)?$/, '$1')
    .replace(/^([^:]*):\d+$/, '$1')
    .replace(/^www\./, '');

/** Equal after removing www., or one is a subdomain of the other. */
export function sameSite(a: string, b: string): boolean {
  const x = bare(a);
  const y = bare(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/** Whitespace collapsed, trimmed, at most 80 UTF-16 units, never half a surrogate pair. */
export function cleanTitle(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  if (t.length > MAX_TITLE) {
    t = t.slice(0, MAX_TITLE);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
    t = t.trimEnd();
  }
  return t;
}

export function updateRecentTitle(state: AppState, id: string, title: string, pageHost: string): AppState {
  const entry = state.recentPages.find((p) => p.id === id);
  if (!entry || !sameSite(entry.host, pageHost)) return state;
  const clean = cleanTitle(title);
  if (!clean || clean === 'about:blank' || clean === entry.host || clean === pageHost || clean === entry.url) return state;
  if (clean === entry.title) return state;
  return { ...state, recentPages: state.recentPages.map((p) => (p === entry ? { ...p, title: clean } : p)) };
}
