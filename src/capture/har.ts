// Writes what the recorder hears of a tab's network, as Chrome DevTools Protocol events, as the HAR the replay reads.
// Only the Network domain is listened to: a page can notice Runtime being turned on, never Network.
//
// A body is asked for as soon as its request finishes, before Chrome lets it go. A request still open when recording
// stops (a stream, a long poll) has no answer to replay and is left out. One that failed is kept with status -1, as
// Playwright writes it, so a replay aborts it rather than leave the page waiting.
import type { HarEntry, HarFile, HarPair } from './sanitize';

export type CdpSend = (method: string, params?: object) => Promise<unknown>;

type Headers = Record<string, string>;

interface CdpResponse {
  url: string;
  status: number;
  statusText?: string;
  headers: Headers;
  mimeType?: string;
  protocol?: string;
}

interface WillBeSent {
  requestId: string;
  type?: string;
  wallTime: number;
  timestamp: number;
  request: { url: string; method: string; headers: Headers; postData?: string; hasPostData?: boolean };
  redirectResponse?: CdpResponse;
}

/** A HAR entry with the fields a HAR file has besides what the sanitiser reads. */
export interface RecordedEntry extends HarEntry {
  startedDateTime: string;
  time: number;
  _resourceType: string;
  request: HarEntry['request'] & { httpVersion: string; headersSize: number; bodySize: number };
  response: HarEntry['response'] & { statusText: string; httpVersion: string; headersSize: number; bodySize: number; redirectURL: string };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
}

interface Open {
  entry: RecordedEntry;
  /** Seconds on Chrome's monotonic clock when the request went out. */
  sentAt: number;
  postData?: Promise<string | undefined>;
  body?: Promise<void>;
  done: boolean;
}

const RECORDED = /^https?:/i;

function pairs(headers: Headers | undefined): HarPair[] {
  // Chrome joins repeated headers with a newline.
  return Object.entries(headers ?? {}).flatMap(([name, value]) => String(value).split('\n').map((v) => ({ name, value: v })));
}

function header(headers: Headers, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

function query(url: string): HarPair[] {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

export class HarRecorder {
  /** Addresses whose answer Chrome no longer held when asked for it: replayed with an empty body. */
  readonly unreadBodies: string[] = [];
  private readonly order: Open[] = [];
  private readonly open = new Map<string, Open>();

  constructor(private readonly send: CdpSend) {}

  /** One event from chrome.debugger.onEvent. Others than the Network ones below are ignored. */
  event(method: string, params: unknown): void {
    switch (method) {
      case 'Network.requestWillBeSent':
        return this.willBeSent(params as WillBeSent);
      case 'Network.responseReceived': {
        const p = params as { requestId: string; response: CdpResponse; timestamp: number };
        const open = this.open.get(p.requestId);
        if (open) this.respond(open, p.response, p.timestamp);
        return;
      }
      case 'Network.loadingFinished': {
        const p = params as { requestId: string; timestamp: number; encodedDataLength?: number };
        const open = this.open.get(p.requestId);
        if (!open) return;
        open.entry.response.content.size = p.encodedDataLength ?? 0;
        open.entry.response.bodySize = p.encodedDataLength ?? -1;
        open.entry.time = Math.max(0, (p.timestamp - open.sentAt) * 1000);
        open.body = this.readBody(p.requestId, open.entry);
        open.done = true;
        this.open.delete(p.requestId);
        return;
      }
      case 'Network.loadingFailed': {
        const p = params as { requestId: string; timestamp: number };
        const open = this.open.get(p.requestId);
        if (!open) return;
        open.entry.response.status = -1;
        open.entry.response.statusText = '';
        open.entry.time = Math.max(0, (p.timestamp - open.sentAt) * 1000);
        open.done = true;
        this.open.delete(p.requestId);
        return;
      }
    }
  }

  /** The HAR so far, once every body asked for has come back. */
  async har(): Promise<HarFile & { log: { version: string; creator: { name: string; version: string }; entries: RecordedEntry[] } }> {
    const done = this.order.filter((o) => o.done);
    await Promise.all(done.map((o) => o.body));
    for (const o of done) {
      const text = o.postData ? await o.postData : undefined;
      if (text !== undefined) o.entry.request.postData = { ...o.entry.request.postData, text };
    }
    return { log: { version: '1.2', creator: { name: 'resume-autofill recorder', version: '1' }, entries: done.map((o) => o.entry) } };
  }

  private willBeSent(p: WillBeSent): void {
    const previous = this.open.get(p.requestId);
    if (previous && p.redirectResponse) {
      // The same id goes on to the address it was sent to.
      this.respond(previous, p.redirectResponse, p.timestamp);
      previous.entry.response.redirectURL = p.request.url;
      previous.done = true;
      this.open.delete(p.requestId);
    }
    if (!RECORDED.test(p.request.url)) return;
    const { request } = p;
    const contentType = header(request.headers, 'content-type');
    const entry: RecordedEntry = {
      startedDateTime: new Date(p.wallTime * 1000).toISOString(),
      time: 0,
      _resourceType: (p.type ?? 'other').toLowerCase(),
      request: {
        method: request.method,
        url: request.url,
        httpVersion: '',
        headers: pairs(request.headers),
        cookies: [],
        queryString: query(request.url),
        headersSize: -1,
        bodySize: request.postData?.length ?? 0,
        ...(request.hasPostData || request.postData !== undefined
          ? { postData: { mimeType: contentType ?? '', ...(request.postData !== undefined ? { text: request.postData } : {}) } }
          : {}),
      },
      response: {
        status: 0,
        statusText: '',
        httpVersion: '',
        headers: [],
        cookies: [],
        content: { mimeType: '', size: 0 },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
    };
    const open: Open = { entry, sentAt: p.timestamp, done: false };
    if (request.hasPostData && request.postData === undefined) open.postData = this.readPostData(p.requestId);
    this.open.set(p.requestId, open);
    this.order.push(open);
  }

  private respond(open: Open, response: CdpResponse, at: number): void {
    const { entry } = open;
    entry.response.status = response.status;
    entry.response.statusText = response.statusText ?? '';
    entry.response.headers = pairs(response.headers);
    entry.response.httpVersion = response.protocol ?? '';
    entry.request.httpVersion = response.protocol ?? '';
    entry.response.content = { mimeType: response.mimeType ?? '', size: 0 };
    entry.timings.wait = Math.max(0, (at - open.sentAt) * 1000);
  }

  private async readBody(requestId: string, entry: RecordedEntry): Promise<void> {
    try {
      const { body, base64Encoded } = (await this.send('Network.getResponseBody', { requestId })) as { body: string; base64Encoded: boolean };
      entry.response.content.text = body;
      if (base64Encoded) entry.response.content.encoding = 'base64';
    } catch {
      // A redirect, a 204, or a body Chrome has already let go of.
      if (entry.response.status >= 200 && entry.response.status !== 204 && entry.response.status < 300) this.unreadBodies.push(entry.request.url);
    }
  }

  private async readPostData(requestId: string): Promise<string | undefined> {
    try {
      return ((await this.send('Network.getRequestPostData', { requestId })) as { postData: string }).postData;
    } catch {
      return undefined;
    }
  }
}
