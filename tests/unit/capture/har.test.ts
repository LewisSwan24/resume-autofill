// @vitest-environment node
// The recorder hears a tab's network as Chrome DevTools Protocol events and writes them as the HAR the replay reads.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HarRecorder, type CdpSend } from '../../../src/capture/har';
import { recordedRequests } from '../../shared/harReplay';

const T0 = 1_700_000_000;

/** A fake debugger: bodies and POST bodies by request id, and every command it was sent. */
function fakeSend(bodies: Record<string, { body: string; base64Encoded: boolean } | Error>, posts: Record<string, string> = {}) {
  const sent: string[] = [];
  const send: CdpSend = async (method, params) => {
    const id = String((params as { requestId: string }).requestId);
    sent.push(`${method} ${id}`);
    if (method === 'Network.getResponseBody') {
      const b = bodies[id];
      if (!b || b instanceof Error) throw b ?? new Error('No resource with given identifier found');
      return b;
    }
    if (method === 'Network.getRequestPostData') return { postData: posts[id] ?? '' };
    throw new Error(`unexpected ${method}`);
  };
  return { send, sent };
}

const request = (id: string, url: string, extra: Record<string, unknown> = {}) => ({
  requestId: id,
  type: 'Document',
  wallTime: T0,
  timestamp: 10,
  request: { url, method: 'GET', headers: { Accept: 'text/html' } },
  ...extra,
});
const response = (id: string, url: string, status = 200, mimeType = 'text/html', headers: Record<string, string> = {}) => ({
  requestId: id,
  type: 'Document',
  timestamp: 10.5,
  response: { url, status, statusText: 'OK', headers: { 'Content-Type': mimeType, ...headers }, mimeType, protocol: 'h2' },
});
const finished = (id: string) => ({ requestId: id, timestamp: 11, encodedDataLength: 10 });

describe('HarRecorder', () => {
  it('writes a page load as an entry the replay knows for a document, its body inline', async () => {
    const { send } = fakeSend({ '1': { body: '<p>hi</p>', base64Encoded: false } });
    const rec = new HarRecorder(send);
    rec.event('Network.requestWillBeSent', request('1', 'https://jobs.example.com/apply?a=1'));
    rec.event('Network.responseReceived', response('1', 'https://jobs.example.com/apply?a=1', 200, 'text/html', { 'X-One': 'a\nb' }));
    rec.event('Network.loadingFinished', finished('1'));
    const har = await rec.har();
    expect(har.log.version).toBe('1.2');
    const [entry] = har.log.entries;
    expect(entry).toMatchObject({
      _resourceType: 'document',
      startedDateTime: new Date(T0 * 1000).toISOString(),
      request: { method: 'GET', url: 'https://jobs.example.com/apply?a=1', queryString: [{ name: 'a', value: '1' }], httpVersion: 'h2' },
      response: { status: 200, content: { mimeType: 'text/html', text: '<p>hi</p>' }, redirectURL: '' },
    });
    expect(entry!.request.headers).toEqual([{ name: 'Accept', value: 'text/html' }]);
    expect(entry!.response.headers).toEqual(
      expect.arrayContaining([
        { name: 'X-One', value: 'a' },
        { name: 'X-One', value: 'b' },
      ]),
    );
  });

  it('ends a redirected request at its redirect and starts the next one', async () => {
    const { send } = fakeSend({ '7': { body: 'ok', base64Encoded: false } });
    const rec = new HarRecorder(send);
    rec.event('Network.requestWillBeSent', request('7', 'https://a.example.com/'));
    rec.event(
      'Network.requestWillBeSent',
      request('7', 'https://b.example.com/', {
        redirectResponse: { url: 'https://a.example.com/', status: 302, statusText: 'Found', headers: { Location: 'https://b.example.com/' }, mimeType: '' },
      }),
    );
    rec.event('Network.responseReceived', response('7', 'https://b.example.com/'));
    rec.event('Network.loadingFinished', finished('7'));
    const entries = (await rec.har()).log.entries;
    expect(entries.map((e) => [e.request.url, e.response.status, e.response.redirectURL])).toEqual([
      ['https://a.example.com/', 302, 'https://b.example.com/'],
      ['https://b.example.com/', 200, ''],
    ]);
    expect(entries[1]!.response.content.text).toBe('ok');
  });

  it('asks for a POST body Chrome left out, and keeps one it sent', async () => {
    const { send, sent } = fakeSend({ p: { body: '{}', base64Encoded: false }, q: { body: '{}', base64Encoded: false } }, { p: 'a=1&b=2' });
    const rec = new HarRecorder(send);
    const post = (id: string, extra: Record<string, unknown>) =>
      rec.event('Network.requestWillBeSent', {
        ...request(id, `https://x.example.com/${id}`),
        type: 'XHR',
        request: { url: `https://x.example.com/${id}`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, ...extra },
      });
    post('p', { hasPostData: true });
    post('q', { hasPostData: true, postData: 'c=3' });
    for (const id of ['p', 'q']) {
      rec.event('Network.responseReceived', response(id, `https://x.example.com/${id}`, 200, 'application/json'));
      rec.event('Network.loadingFinished', finished(id));
    }
    const entries = (await rec.har()).log.entries;
    expect(entries.map((e) => e.request.postData)).toEqual([
      { mimeType: 'application/x-www-form-urlencoded', text: 'a=1&b=2' },
      { mimeType: 'application/x-www-form-urlencoded', text: 'c=3' },
    ]);
    expect(sent.filter((s) => s.startsWith('Network.getRequestPostData'))).toEqual(['Network.getRequestPostData p']);
  });

  it('keeps a binary body as base64, and counts a body Chrome no longer holds', async () => {
    const { send } = fakeSend({ img: { body: 'iVBORw0K', base64Encoded: true }, gone: new Error('No data found') });
    const rec = new HarRecorder(send);
    for (const id of ['img', 'gone']) {
      rec.event('Network.requestWillBeSent', { ...request(id, `https://x.example.com/${id}`), type: 'Image' });
      rec.event('Network.responseReceived', response(id, `https://x.example.com/${id}`, 200, 'image/png'));
      rec.event('Network.loadingFinished', finished(id));
    }
    const har = await rec.har();
    expect(har.log.entries.map((e) => e.response.content)).toEqual([
      { mimeType: 'image/png', size: 10, text: 'iVBORw0K', encoding: 'base64' },
      { mimeType: 'image/png', size: 10 },
    ]);
    expect(rec.unreadBodies).toEqual(['https://x.example.com/gone']);
  });

  it('writes a request that failed as the replay knows one, and skips what never went to the network', async () => {
    const { send } = fakeSend({});
    const rec = new HarRecorder(send);
    rec.event('Network.requestWillBeSent', { ...request('f', 'https://ads.example.com/tag.js'), type: 'Script' });
    rec.event('Network.loadingFailed', { requestId: 'f', timestamp: 12, errorText: 'net::ERR_BLOCKED_BY_CLIENT', type: 'Script' });
    rec.event('Network.requestWillBeSent', request('d', 'data:text/plain,hi'));
    rec.event('Network.requestWillBeSent', request('e', 'chrome-extension://abc/x.js'));
    const har = await rec.har();
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]!.response.status).toBe(-1);

    const dir = mkdtempSync(path.join(tmpdir(), 'har-'));
    writeFileSync(path.join(dir, 'page.har'), JSON.stringify(har));
    expect(recordedRequests(path.join(dir, 'page.har'))).toEqual([expect.objectContaining({ url: 'https://ads.example.com/tag.js', failed: true })]);
  });

  it('leaves out a request still open when recording stops', async () => {
    const { send } = fakeSend({});
    const rec = new HarRecorder(send);
    rec.event('Network.requestWillBeSent', { ...request('s', 'https://x.example.com/stream'), type: 'EventSource' });
    rec.event('Network.responseReceived', response('s', 'https://x.example.com/stream', 200, 'text/event-stream'));
    expect((await rec.har()).log.entries).toEqual([]);
  });
});
