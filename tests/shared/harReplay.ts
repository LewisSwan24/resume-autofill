// Replaying a capture: the page's document and every request it makes are answered from its own HAR, and
// nothing else. Playwright's own HAR router needs the url, method and POST body to match exactly. Two kinds
// of request never do, and both left hash-routed apps (Moka) with no form at all:
//
// - A field that changes on every visit: a cache-busting timestamp or a nonce.
// - A value the page read from an answer the recording does not hold. Moka reads its cluster name with a
//   synchronous XHR to /api/env, which neither Moka capture recorded; without it the page falls back to its
//   default cluster and asks for its form component under that name, so the lookup misses and no form draws.
//
// For those, and only those, a request is answered with the one recorded entry that matches it on every other
// field. When none does, or more than one could, it stays unanswered and the recording aborts it as before.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';

export interface RecordedRequest {
  method: string;
  url: string;
  postData: string | null;
  /** What the recording answered: status and body. Only read to tell whether two candidates differ. */
  answer?: string | undefined;
}

/** True when a request asks for the document a page address names. The part after # never reaches the server. */
export function sameDocument(requestUrl: string, pageUrl: string): boolean {
  try {
    const a = new URL(requestUrl);
    const b = new URL(pageUrl);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return false;
  }
}

const EPOCH = /^\d{10}(\d{3})?$/;
// Keys that change on every visit. Short names count only when the value looks like a Unix time.
const VOLATILE: Record<string, (value: unknown) => boolean> = {
  _: (v) => EPOCH.test(String(v)),
  _t: (v) => EPOCH.test(String(v)),
  t: (v) => EPOCH.test(String(v)),
  ts: (v) => EPOCH.test(String(v)),
  timestamp: (v) => EPOCH.test(String(v)),
  nonce: () => true,
  rand: () => true,
  random: () => true,
  // ByteDance's anti-crawler signature (Feishu recruiting): recomputed for every request.
  _signature: () => true,
};

// Values a page took from an answer no recording holds, per lookup. Kept as narrow as one path.
const UNRECORDED_INPUTS: { host: RegExp; pathname: string; keys: string[] }[] = [
  { host: /(^|\.)mokahr\.com$/, pathname: '/api/material-platform/meta-info/project', keys: ['cluster'] },
];

function setAside(url: URL): (key: string, value: unknown) => boolean {
  const rule = UNRECORDED_INPUTS.find((r) => r.host.test(url.host) && r.pathname === url.pathname);
  return (key, value) => Boolean(VOLATILE[key]?.(value)) || Boolean(rule?.keys.includes(key));
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

const FORM = /^[^=&]+=[^&]*(&[^=&]+=[^&]*)*$/;

/** What a request asks for once the fields it may differ in are set aside, or null when it cannot be read. */
function stableKey(request: RecordedRequest): string | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const ignore = setAside(url);
  const query = [...url.searchParams].filter(([k, v]) => !ignore(k, v)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let body: unknown = request.postData ?? '';
  const text = request.postData ?? '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = { json: Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([k, v]) => !ignore(k, v))) };
    }
  } catch {
    if (FORM.test(text)) {
      body = { form: [...new URLSearchParams(text)].filter(([k, v]) => !ignore(k, v)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) };
    }
  }
  return canonical([request.method, url.origin, url.pathname, query, body]);
}

// The HAR router's own rule: a POST matches on its body, unless either side has none.
const exactly = (a: RecordedRequest, b: RecordedRequest): boolean =>
  a.method === b.method && a.url === b.url && (a.method !== 'POST' || !a.postData || !b.postData || a.postData === b.postData);

/**
 * The recorded request to answer this one with, when the recording has no exact match and the entries that match
 * on every field not set aside are one, or several that were all answered alike (a status asked for again with a
 * new random number). Null leaves the request to the recording as it is.
 */
export function stableTwin(request: RecordedRequest, recorded: RecordedRequest[]): RecordedRequest | null {
  if (recorded.some((r) => exactly(r, request))) return null;
  const key = stableKey(request);
  if (key === null) return null;
  const fits = recorded.filter((r) => r.method === request.method && stableKey(r) === key);
  const distinct = new Map(fits.map((r) => [`${r.url}\n${r.postData ?? ''}`, r]));
  const twins = [...distinct.values()];
  if (twins.length === 1) return twins[0]!;
  const alike = twins.every((t) => t.answer !== undefined && t.answer === twins[0]!.answer);
  return twins.length > 1 && alike ? twins[0]! : null;
}

interface HarFile {
  log: {
    entries: {
      request: { method: string; url: string; postData?: { text?: string; _file?: string } };
      response?: { status?: number; content?: { text?: string; _file?: string } };
    }[];
  };
}

/**
 * Every request a HAR recorded, POST bodies read from their attached files. The answer is the status and the body,
 * or the body's attached file, which is named after its own content.
 */
export function recordedRequests(harPath: string): RecordedRequest[] {
  const har = JSON.parse(readFileSync(harPath, 'utf8')) as HarFile;
  return har.log.entries.map(({ request, response }) => {
    const post = request.postData;
    const postData = post?._file ? readFileSync(path.join(path.dirname(harPath), post._file), 'utf8') : post?.text || null;
    const body = response?.content?._file ?? response?.content?.text ?? '';
    return { method: request.method, url: request.url, postData, answer: `${response?.status ?? 0} ${body}` };
  });
}

/**
 * Answers the context's requests from the HAR. Anything not in it is aborted, so the page cannot reach the site.
 * Register stubs and saved search answers after this, so they are asked first.
 */
export async function replayFromHar(context: BrowserContext, harPath: string, url: RegExp = /^https?:\/\//): Promise<void> {
  await context.routeFromHAR(harPath, { notFound: 'abort', url });
  const recorded = recordedRequests(harPath);
  await context.route(url, (route) => {
    const request = route.request();
    const twin = stableTwin({ method: request.method(), url: request.url(), postData: request.postData() }, recorded);
    if (!twin) return route.fallback();
    return route.fallback({ url: twin.url, ...(twin.postData !== null ? { postData: twin.postData } : {}) });
  });
}
