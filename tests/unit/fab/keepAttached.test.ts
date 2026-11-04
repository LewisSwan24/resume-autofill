import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepAttached } from '../../../entrypoints/fab.content/keepAttached';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('keepAttached', () => {
  let host: HTMLElement;
  let stop: () => void;

  beforeEach(() => {
    host = document.createElement('raf-fab');
    document.body.append(host);
    stop = keepAttached(host, document);
  });

  afterEach(() => {
    stop();
    host.remove();
    vi.useRealTimers();
  });

  it('puts the host back when the page removes it', async () => {
    host.remove();
    await flush();
    expect(host.isConnected).toBe(true);
    expect(host.parentElement).toBe(document.body);
  });

  it('keeps the same element, so the mounted UI and its state survive', async () => {
    const before = host;
    document.body.innerHTML = '<main>re-rendered by the page</main>';
    await flush();
    expect(document.querySelector('raf-fab')).toBe(before);
  });

  it('finds the new body when the page replaces the body itself', async () => {
    const fresh = document.createElement('body');
    document.documentElement.replaceChild(fresh, document.body);
    await flush();
    expect(host.parentElement).toBe(fresh);
  });

  it('leaves the page alone while the host is attached', async () => {
    const spy = vi.spyOn(document.body, 'append');
    document.body.append(document.createElement('div'));
    spy.mockClear();
    document.body.lastElementChild?.remove();
    await flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stops when asked', async () => {
    stop();
    host.remove();
    await flush();
    expect(host.isConnected).toBe(false);
  });

  it('gives up for a while on a page that keeps removing it, instead of fighting in a loop', async () => {
    let removals = 0;
    const fighter = new MutationObserver(() => {
      if (host.isConnected && removals < 100) {
        removals++;
        host.remove();
      }
    });
    fighter.observe(document, { childList: true, subtree: true });
    host.remove();
    for (let i = 0; i < 60; i++) await flush();
    fighter.disconnect();
    expect(removals).toBeLessThanOrEqual(25);
  });

  it('tries again after the pause', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i < 30; i++) {
      host.remove();
      await flush();
    }
    host.remove();
    await flush();
    expect(host.isConnected).toBe(false);

    vi.setSystemTime(Date.now() + 60_000);
    document.body.append(document.createElement('div'));
    await flush();
    expect(host.isConnected).toBe(true);
  });
});
