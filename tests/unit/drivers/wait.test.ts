import { describe, expect, it } from 'vitest';
import { nextFrame, waitFor } from '../../../src/drivers/wait';

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
