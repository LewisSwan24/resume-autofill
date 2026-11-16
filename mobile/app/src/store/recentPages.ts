// Legacy (AppState v1): recent application pages, newest first, one entry per link, at most RECENT_PAGES_MAX.
// Version 2 keeps application records instead (tracker/model/records.ts); these helpers stay for the v1 shape only
// until their removal is agreed. recentKey is still the record key.
import { RECENT_PAGES_MAX } from './appStateStore';
import type { AppStateV1 as AppState, RecentPage } from './appStateMigrate';

/** The link without its #fragment: two hash routes of one page count as the same page. */
export function recentKey(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * The same link (ignoring #fragment) already listed moves to the top with `addedAt = now`, keeps its id and takes a
 * new title only when one is given; otherwise a new entry goes on top. The oldest drop off past the cap.
 */
export function addRecentPage(
  state: AppState,
  page: { url: string; host: string; title?: string },
  now: number,
  newId: () => string = randomId,
): AppState {
  const key = recentKey(page.url);
  const existing = state.recentPages.find((p) => recentKey(p.url) === key);
  const title = page.title ?? existing?.title;
  const entry: RecentPage = {
    id: existing?.id ?? newId(),
    url: page.url,
    host: page.host,
    ...(title !== undefined ? { title } : {}),
    addedAt: now,
  };
  const rest = state.recentPages.filter((p) => p !== existing);
  return { ...state, recentPages: [entry, ...rest].slice(0, RECENT_PAGES_MAX) };
}

export function removeRecentPage(state: AppState, id: string): AppState {
  return { ...state, recentPages: state.recentPages.filter((p) => p.id !== id) };
}

export function clearRecentPages(state: AppState): AppState {
  return { ...state, recentPages: [] };
}

/**
 * Put back a list saved before a remove or clear (undo). Links added since stay on top; an old entry for a link that
 * was added again since is left out, so no link is listed twice.
 */
export function restoreRecentPages(state: AppState, pages: readonly RecentPage[]): AppState {
  const before = new Set(pages.map((p) => p.id));
  const added = state.recentPages.filter((p) => !before.has(p.id));
  const addedKeys = new Set(added.map((p) => recentKey(p.url)));
  const restored = pages.filter((p) => !addedKeys.has(recentKey(p.url)));
  return { ...state, recentPages: [...added, ...restored].slice(0, RECENT_PAGES_MAX) };
}
