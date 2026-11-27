// @vitest-environment node
// The recorder drives one tab through Chrome's APIs, handed in so that this test can stand in for them.
import { describe, expect, it } from 'vitest';
import { PHONE } from '../../../src/capture/device';
import { TabRecorder, type RecorderApi } from '../../../src/capture/recorder';

type Listener = (source: { tabId?: number }, method: string, params?: object) => void;

function fakeApi() {
  const calls: string[] = [];
  const sent: { method: string; params?: object }[] = [];
  let listener: Listener | null = null;
  let detached: ((source: { tabId?: number }, reason: string) => void) | null = null;
  const api: RecorderApi = {
    async attach(tabId) {
      calls.push(`attach ${tabId}`);
    },
    async detach(tabId) {
      calls.push(`detach ${tabId}`);
    },
    async send(tabId, method, params) {
      calls.push(`send ${tabId} ${method}`);
      sent.push({ method, ...(params ? { params } : {}) });
      if (method === 'Network.getResponseBody') return { body: `body of ${(params as { requestId: string }).requestId}`, base64Encoded: false };
      return {};
    },
    onEvent(l) {
      listener = l;
      return () => {
        calls.push('unlisten');
        listener = null;
      };
    },
    onDetach(l) {
      detached = l;
      return () => {
        detached = null;
      };
    },
    async reload(tabId) {
      calls.push(`reload ${tabId}`);
    },
    async runInTop(tabId) {
      calls.push(`read storage ${tabId}`);
      return { origin: 'https://jobs.example.com', sessionStorage: { draft: '1' } } as never;
    },
    async runInFrames(tabId) {
      calls.push(`serialise ${tabId}`);
      return [
        { frameId: 4, result: { html: '<p>frame</p>', css: '', crossOriginSheets: [] } },
        { frameId: 0, result: { html: '<p>top</p>', css: '', crossOriginSheets: [] } },
        { frameId: 9, result: { html: '<p>blank</p>', css: '', crossOriginSheets: [] } },
      ] as never;
    },
    async frames() {
      return [
        { frameId: 0, parentFrameId: -1, url: 'https://jobs.example.com/apply' },
        { frameId: 4, parentFrameId: 0, url: 'https://forms.example.com/f' },
        { frameId: 9, parentFrameId: 0, url: 'about:blank' },
      ];
    },
  };
  const emit = (tabId: number, method: string, params: object) => listener?.({ tabId }, method, params);
  const cancel = (tabId: number) => detached?.({ tabId }, 'canceled_by_user');
  return { api, calls, sent, emit, cancel };
}

const load = (emit: (tabId: number, method: string, params: object) => void, tabId: number, id: string) => {
  emit(tabId, 'Network.requestWillBeSent', {
    requestId: id,
    type: 'Document',
    wallTime: 1,
    timestamp: 1,
    request: { url: `https://jobs.example.com/${id}`, method: 'GET', headers: {} },
  });
  emit(tabId, 'Network.responseReceived', {
    requestId: id,
    timestamp: 1,
    response: { url: `https://jobs.example.com/${id}`, status: 200, headers: {}, mimeType: 'text/html' },
  });
  emit(tabId, 'Network.loadingFinished', { requestId: id, timestamp: 2, encodedDataLength: 5 });
};

describe('TabRecorder', () => {
  it("reads the tab's session storage, then listens, then reloads, so the whole load is heard", async () => {
    const { api, calls } = fakeApi();
    await new TabRecorder(api, 7).start();
    expect(calls).toEqual(['read storage 7', 'attach 7', 'send 7 Network.enable', 'reload 7']);
  });

  it('on a phone, makes the tab look like one before the reload, so the site serves its phone page', async () => {
    const { api, calls, sent } = fakeApi();
    await new TabRecorder(api, 7, { device: 'mobile' }).start();
    expect(calls).toEqual([
      'read storage 7',
      'attach 7',
      'send 7 Network.enable',
      'send 7 Emulation.setDeviceMetricsOverride',
      'send 7 Emulation.setUserAgentOverride',
      'send 7 Emulation.setTouchEmulationEnabled',
      'send 7 Emulation.setEmitTouchEventsForMouse',
      'reload 7',
    ]);
    const params = (method: string) => sent.find((s) => s.method === method)!.params as Record<string, unknown>;
    // The phone a replay opens a mobile sample with (scripts/capture/device.ts), so the page lays out the same.
    expect(params('Emulation.setDeviceMetricsOverride')).toMatchObject({ width: PHONE.width, height: PHONE.height, mobile: true });
    expect(params('Emulation.setUserAgentOverride')).toMatchObject({ userAgent: PHONE.userAgent, userAgentMetadata: { mobile: true } });
    expect(params('Emulation.setTouchEmulationEnabled')).toMatchObject({ enabled: true });
    expect(params('Emulation.setEmitTouchEventsForMouse')).toMatchObject({ enabled: true, configuration: 'mobile' });
  });

  it('hears only its own tab, and hands back every frame with a web address, the top one first', async () => {
    const { api, calls, emit } = fakeApi();
    const rec = new TabRecorder(api, 7);
    await rec.start();
    load(emit, 7, 'apply');
    load(emit, 8, 'other');
    expect(rec.requests).toBe(1);
    const taken = await rec.stop();
    expect(taken.url).toBe('https://jobs.example.com/apply');
    expect(taken.har.log.entries.map((e) => e.request.url)).toEqual(['https://jobs.example.com/apply']);
    expect(taken.har.log.entries[0]!.response.content.text).toBe('body of apply');
    expect(taken.frames).toEqual([
      { url: 'https://jobs.example.com/apply', data: { html: '<p>top</p>', css: '', crossOriginSheets: [] } },
      { url: 'https://forms.example.com/f', data: { html: '<p>frame</p>', css: '', crossOriginSheets: [] } },
    ]);
    expect(taken.storage).toEqual({ origin: 'https://jobs.example.com', sessionStorage: { draft: '1' } });
    expect(calls.slice(-3)).toEqual(['serialise 7', 'unlisten', 'detach 7']);
  });

  it('says so when the banner was closed, which ends the recording', async () => {
    const { api, cancel } = fakeApi();
    const rec = new TabRecorder(api, 7);
    const ended: string[] = [];
    rec.onEnded = (reason) => ended.push(reason);
    await rec.start();
    cancel(8);
    expect(ended).toEqual([]);
    cancel(7);
    expect(ended).toEqual(['canceled_by_user']);
    await expect(rec.stop()).rejects.toThrow(/canceled_by_user/);
  });
});
