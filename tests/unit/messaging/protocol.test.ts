import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FillReport } from '../../../src/engine/types';
import { createSampleProfile } from '../../../src/schema';
import {
  sendToBackground,
  sendToFrame,
  type BgBroadcast,
  type BgToFrame,
  type ContentToBg,
  type Message,
  type UiToBg,
} from '../../../src/messaging';

const emptyReport: FillReport = {
  url: 'https://jobs.example.com/apply',
  startedAt: 1,
  finishedAt: 2,
  fields: [],
  counts: { filled: 0, needs_review: 0, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
};

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('sendToBackground', () => {
  it('delivers the message to runtime listeners and returns their response', async () => {
    const received: unknown[] = [];
    browser.runtime.onMessage.addListener(((msg: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
      received.push(msg);
      sendResponse({ ok: true });
      return true;
    }) as never);

    const res = await sendToBackground({ type: 'fill:request' });

    expect(received).toEqual([{ type: 'fill:request' }]);
    expect(res).toEqual({ ok: true });
  });

  it('forwards fire-and-forget payloads untouched', async () => {
    const spy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
    const msg: ContentToBg = { type: 'scan:result', count: 12, url: 'https://x.test/' };
    await sendToBackground(msg);
    expect(spy).toHaveBeenCalledWith(msg);
  });

  it('accepts the ui:* messages with an empty payload', async () => {
    const spy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined as never);
    await sendToBackground({ type: 'ui:openOptions' });
    await sendToBackground({ type: 'ui:openSidePanel' });
    expect(spy.mock.calls.map((c) => (c[0] as unknown as Message).type)).toEqual(['ui:openOptions', 'ui:openSidePanel']);
  });
});

describe('sendToFrame', () => {
  it('targets one frame of one tab and returns the response', async () => {
    const spy = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(emptyReport as never);
    const msg: BgToFrame = {
      type: 'frame:fill',
      runId: 'run-1',
      resume: createSampleProfile().resumes[0]!,
      files: { f1: { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AA==' } },
    };

    const res = await sendToFrame(3, 5, msg);

    expect(spy).toHaveBeenCalledWith(3, msg, { frameId: 5 });
    expect(res).toEqual(emptyReport);
  });
});

describe('type-level contract', () => {
  it('compiles with the documented message shapes', () => {
    const toBg: UiToBg[] = [
      { type: 'fill:request' },
      { type: 'field:focus', frameId: 0, fieldId: 'c1' },
      { type: 'field:focus', tabId: 2, frameId: 0, fieldId: 'c1' },
      { type: 'field:apply', tabId: 2, frameId: 0, fieldId: 'c1', optionLabel: 'Male' },
      { type: 'ui:openOptions' },
      { type: 'ui:openSidePanel' },
    ];
    const broadcast: BgBroadcast[] = [{ type: 'report:updated', tabId: 1, report: emptyReport }];
    const toFrame: BgToFrame[] = [
      { type: 'scan:total', total: 4 },
      { type: 'frame:focus', fieldId: 'c1' },
      { type: 'frame:apply', fieldId: 'c1', text: 'hi' },
    ];
    expect(toBg.length + broadcast.length + toFrame.length).toBe(10);
  });
});

