// Saving a live page's search answers (school, major, region, place) so a replay can give the same answer
// offline. Only what the page's own script asked a search endpoint, and what came back; never request headers,
// so no cookie or token is written. The file goes outside the repository: tests/shared/searchAnswers.ts takes
// the answers it needs from it by hand, after a look.
import type { BrowserContext } from '@playwright/test';

/** A path that searches or suggests, as school, major and region boxes ask. */
const SEARCHES = /search|suggest|autocomplete|lookup/i;

export function isSearchRequest(method: string, url: string, resourceType: string): boolean {
  if (resourceType !== 'xhr' && resourceType !== 'fetch') return false;
  if (method !== 'GET' && method !== 'POST') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && SEARCHES.test(parsed.pathname);
}

export interface SavedSearch {
  method: string;
  url: string;
  postData: string | null;
  status: number;
  contentType: string;
  body: string;
}

export function savedSearch(
  request: { method: string; url: string; postData: string | null },
  status: number,
  contentType: string,
  body: string,
): SavedSearch {
  return { method: request.method, url: request.url, postData: request.postData, status, contentType, body };
}

/** Keeps every search answer the context receives from now on. */
export function recordSearches(context: BrowserContext): () => SavedSearch[] {
  const saved: SavedSearch[] = [];
  context.on('response', async (response) => {
    const request = response.request();
    if (!isSearchRequest(request.method(), request.url(), request.resourceType())) return;
    try {
      const body = await response.text();
      const request_ = { method: request.method(), url: request.url(), postData: request.postData() };
      saved.push(savedSearch(request_, response.status(), response.headers()['content-type'] ?? '', body));
    } catch {
      /* a response whose body is gone (the page moved on) is simply not saved */
    }
  });
  return () => saved;
}

/**
 * A POST the site uses only to read, named on the command line (`--read-posts`). Some portals (Moka) load the
 * job, the form and its option lists by POST; with all of them blocked there is no form to test. Only paths the
 * list matches whole are let through, so every other write stays blocked.
 */
export function isListedRead(method: string, url: string, reads: RegExp | null): boolean {
  if (!reads || method !== 'POST') return false;
  try {
    return reads.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
