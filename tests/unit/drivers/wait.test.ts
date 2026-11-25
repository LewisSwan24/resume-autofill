import { describe, expect, it } from 'vitest';
import { animationsDone, nextFrame, waitFor } from '../../../src/drivers/wait';

describe('waitFor', () => {
  it('resolves immediately when the probe already hits', async () => {
    expect(await waitFor(() => 'ready')).toBe('ready');
  });

  it('wakes on a DOM mutation well before the polling interval', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const started = Date.now();
    setTimeout(() => host.appendChild(document.createElement('span')), 5);
    const found = await waitFor(() => host.querySelector('span'), { root: host, interval: 1000, timeout: 2000 });
    expect(found).toBeInstanceOf(HTMLSpanElement);
    expect(Date.now() - started).toBeLessThan(500);
    host.remove();
  });

  it('falls back to polling for changes the observer cannot see', async () => {
    let n = 0;
    const out = await waitFor(() => (++n >= 3 ? n : null), { interval: 10, timeout: 1000 });
    expect(out).toBe(3);
  });

  it('resolves null on timeout', async () => {
    expect(await waitFor(() => false, { timeout: 60, interval: 10 })).toBeNull();
  });

  it('treats a throwing probe as not ready, and keeps 0 / empty string as hits', async () => {
    let n = 0;
    const out = await waitFor(
      () => {
        if (++n < 2) throw new Error('boom');
        return 0;
      },
      { interval: 10, timeout: 500 },
    );
    expect(out).toBe(0);
  });

  it('nextFrame resolves', async () => {
    await expect(nextFrame()).resolves.toBeUndefined();
  });
});

describe('animationsDone', () => {

  const fake = (animations: { playState: string; finished: Promise<unknown>; iterations?: number }[]) => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'getAnimations', {
      value: () => animations.map((a) => ({ ...a, effect: { getComputedTiming: () => ({ iterations: a.iterations ?? 1 }) } })),
    });
    return el;
  };

  it('waits for a slide to finish, not for a spinner that never does', async () => {
    let end!: () => void;
    const slide = new Promise<void>((r) => (end = r));
    const el = fake([{ playState: 'running', finished: slide }, { playState: 'running', finished: new Promise(() => {}), iterations: Infinity }]);
    let done = false;
    const waiting = animationsDone(el, 5000).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    end();
    await waiting;
    expect(done).toBe(true);
  });

  it('gives up at the cap, and returns at once where nothing animates', async () => {
    const started = performance.now();
    await animationsDone(fake([{ playState: 'running', finished: new Promise(() => {}) }]), 80);
    expect(performance.now() - started).toBeGreaterThanOrEqual(70);
    await animationsDone(document.createElement('div'), 5000);
  });
});
