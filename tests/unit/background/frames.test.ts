import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FrameTimeoutError, NOTHING_TO_FILL, collectFrameReports, frameSaysAlive, listFrameIds, watchFrame, withTimeout } from '../../../src/background/frames';
import type { FillReport } from '../../../src/engine/types';
import { emptyCounts } from '../../../src/fill/report';

const rep = (url: string): FillReport => ({ url, startedAt: 1, finishedAt: 2, fields: [], counts: emptyCounts() });

describe('listFrameIds', () => {
  it('puts the top frame first, sorts the rest and drops frames that failed to load', async () => {
    const ids = await listFrameIds(1, async () => [
      { frameId: 5 },
      { frameId: 2, errorOccurred: true },
      { frameId: 0 },
      { frameId: 3 },
      { frameId: 3 },
    ]);
    expect(ids).toEqual([0, 3, 5]);
  });

  it('falls back to the top frame when the frame list is unavailable', async () => {
    expect(await listFrameIds(1, async () => undefined)).toEqual([0]);
    expect(await listFrameIds(1, async () => null)).toEqual([0]);
    expect(await listFrameIds(1, async () => Promise.reject(new Error('no tab')))).toEqual([0]);
  });

  it('reads webNavigation.getAllFrames by default', async () => {
    const spy = vi
      .spyOn(fakeBrowser.webNavigation, 'getAllFrames')
      .mockResolvedValue([{ frameId: 1 }, { frameId: 0 }] as never);
    expect(await listFrameIds(42)).toEqual([0, 1]);
    expect(spy).toHaveBeenCalledWith({ tabId: 42 });
    spy.mockRestore();
  });
});

describe('collectFrameReports', () => {
  it('asks frames one after another in the given order', async () => {
    const log: string[] = [];
    const send = async (frameId: number) => {
      log.push(`start ${frameId}`);
      await new Promise((r) => setTimeout(r, frameId === 0 ? 20 : 1));
      log.push(`end ${frameId}`);
      return rep(`f${frameId}`);
    };
    const parts = await collectFrameReports([0, 2, 5], send);
    expect(log).toEqual(['start 0', 'end 0', 'start 2', 'end 2', 'start 5', 'end 5']);
    expect(parts.map((p) => p.frameId)).toEqual([0, 2, 5]);
  });

  it('skips frames that reject (no content script) or answer garbage, and reports why', async () => {
    const skipped: number[] = [];
    const parts = await collectFrameReports(
      [0, 1, 2, 3],
      async (frameId) => {
        if (frameId === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (frameId === 2) return undefined;
        return rep(`f${frameId}`);
      },
      { onSkip: (id) => skipped.push(id) },
    );
    expect(parts.map((p) => p.frameId)).toEqual([0, 3]);
    expect(skipped).toEqual([1, 2]);
  });

  it('survives a synchronous throw inside send', async () => {
    const parts = await collectFrameReports([0, 1], (frameId) => {
      if (frameId === 0) throw new Error('boom');
      return Promise.resolve(rep('ok'));
    });
    expect(parts.map((p) => p.frameId)).toEqual([1]);
  });

  describe('timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives up on a silent frame after the per-frame timeout and continues', async () => {
      const skipped: unknown[] = [];
      const pending = collectFrameReports(
        [0, 1],
        (frameId) => (frameId === 0 ? new Promise(() => undefined) : Promise.resolve(rep('f1'))),
        { onSkip: (_id, reason) => skipped.push(reason) },
      );
      await vi.advanceTimersByTimeAsync(29_999);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const parts = await pending;
      expect(parts.map((p) => p.frameId)).toEqual([1]);
      expect(skipped[0]).toBeInstanceOf(FrameTimeoutError);
    });

    it('keeps waiting while a slow frame says it is still filling, and gives up once it falls silent', async () => {
      const touches = new Map<number, () => void>();
      let done: (r: FillReport) => void = () => undefined;
      const skipped: unknown[] = [];
      const pending = collectFrameReports(
        [0, 1],
        (frameId) => (frameId === 0 ? new Promise<FillReport>((resolve) => (done = resolve)) : new Promise(() => undefined)),
        {
          onSkip: (_id, reason) => skipped.push(reason),
          alive: (frameId, touch) => {
            touches.set(frameId, touch);
            return () => touches.delete(frameId);
          },
        },
      );
      for (let s = 0; s < 4; s++) {
        await vi.advanceTimersByTimeAsync(20_000);
        touches.get(0)!();
      }
      done(rep('slow'));
      await vi.advanceTimersByTimeAsync(0);
      expect(touches.has(0)).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      const parts = await pending;
      expect(parts.map((p) => p.frameId)).toEqual([0]);
      expect(skipped[0]).toBeInstanceOf(FrameTimeoutError);
      expect(touches.size).toBe(0);
    });
  });
});

describe('collectFrameReports with prepare', () => {
  it('skips frames whose prepare resolves null (send is never called) and hands the prepared value to send', async () => {
    const sent: [number, string][] = [];
    const skipped: [number, unknown][] = [];
    const parts = await collectFrameReports<string>(
      [0, 1, 2],
      async (frameId, prepared) => {
        sent.push([frameId, prepared]);
        return rep(`f${frameId}`);
      },
      {
        prepare: async (frameId) => (frameId === 1 ? null : `needs-${frameId}`),
        onSkip: (id, reason) => skipped.push([id, reason]),
      },
    );
    expect(sent).toEqual([[0, 'needs-0'], [2, 'needs-2']]);
    expect(parts.map((p) => p.frameId)).toEqual([0, 2]);
    expect(skipped).toEqual([[1, NOTHING_TO_FILL]]);
  });

  it('skips frames whose prepare rejects or times out, with its own budget', async () => {
    const skipped: number[] = [];
    const parts = await collectFrameReports<number>(
      [0, 1, 2],
      async (frameId) => rep(`f${frameId}`),
      {
        prepareTimeoutMs: 15,
        timeoutMs: 1000,
        prepare: (frameId) =>
          frameId === 0 ? Promise.reject(new Error('no receiver')) : frameId === 1 ? new Promise(() => undefined) : Promise.resolve(1),
        onSkip: (id) => skipped.push(id),
      },
    );
    expect(parts.map((p) => p.frameId)).toEqual([2]);
    expect(skipped).toEqual([0, 1]);
  });
});

describe('withTimeout', () => {
  it('passes the value through and clears its timer', async () => {
    vi.useFakeTimers();
    try {
      await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('watchFrame', () => {
  it('hears only its own tab and frame, and nothing once stopped', () => {
    const touch = vi.fn();
    const stop = watchFrame(3, 1, touch);
    frameSaysAlive(3, 1);
    frameSaysAlive(3, 0);
    frameSaysAlive(4, 1);
    expect(touch).toHaveBeenCalledTimes(1);
    stop();
    frameSaysAlive(3, 1);
    expect(touch).toHaveBeenCalledTimes(1);
  });
});
